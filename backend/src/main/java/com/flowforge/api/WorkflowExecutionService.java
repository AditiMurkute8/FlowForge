package com.flowforge.api;

import com.flowforge.api.dto.*;
import com.flowforge.config.SchedulerProperties;
import com.flowforge.core.*;
import com.flowforge.scheduler.*;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Service managing workflow execution concurrency, task dispatching, timeout watchdog, and permit lifecycle.
 */
@Service
public class WorkflowExecutionService {

    private static final Logger log = LoggerFactory.getLogger(WorkflowExecutionService.class);

    public static final int MAX_TASKS_LIMIT = 50;
    public static final int MAX_EDGES_LIMIT = 100;
    public static final int MAX_CONCURRENCY = 4;

    private final SchedulerProperties properties;
    private final TaskActionResolver taskActionResolver;
    private final Semaphore workflowSemaphore;
    private final ThreadPoolExecutor workflowDispatcherExecutor;
    private final ThreadPoolExecutor permitReaperExecutor;
    private final AtomicBoolean isShutdown = new AtomicBoolean(false);
    private volatile long reaperStepTimeoutMs = 5000L;

    public WorkflowExecutionService(SchedulerProperties properties, TaskActionResolver taskActionResolver) {
        this.properties = properties;
        this.taskActionResolver = taskActionResolver;
        this.workflowSemaphore = new Semaphore(properties.getMaxConcurrentWorkflows());
        this.workflowDispatcherExecutor = new ThreadPoolExecutor(
            properties.getMaxConcurrentWorkflows(),
            properties.getMaxConcurrentWorkflows(),
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(properties.getMaxConcurrentWorkflows()),
            new ThreadFactory() {
                private final AtomicInteger counter = new AtomicInteger(1);

                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "flowforge-dispatch-" + counter.getAndIncrement());
                    t.setDaemon(true);
                    return t;
                }
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
        this.permitReaperExecutor = new ThreadPoolExecutor(
            properties.getMaxConcurrentWorkflows(),
            properties.getMaxConcurrentWorkflows(),
            60L,
            TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(properties.getMaxConcurrentWorkflows()),
            new ThreadFactory() {
                private final AtomicInteger counter = new AtomicInteger(1);

                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "flowforge-permit-reaper-" + counter.getAndIncrement());
                    t.setDaemon(true);
                    return t;
                }
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
        this.permitReaperExecutor.allowCoreThreadTimeOut(true);
    }

    public Semaphore getSemaphore() {
        return workflowSemaphore;
    }

    public ResponseEntity<?> executeWorkflow(ExecuteWorkflowRequest request) {
        return executeWorkflow(request, properties.getExecutionTimeoutSeconds(), TimeUnit.SECONDS, null);
    }

    public ResponseEntity<?> executeWorkflow(ExecuteWorkflowRequest request, long timeout, TimeUnit unit, Runnable onPermitReleased) {
        // 1. Syntactic and structural validation before admission
        validateRequest(request);

        // 2. Admission Gate
        boolean acquired = workflowSemaphore.tryAcquire();
        if (!acquired) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "5")
                .body(new ApiErrorResponse(
                    429,
                    "Too Many Requests",
                    "Server workflow execution capacity is exhausted (max " + properties.getMaxConcurrentWorkflows() + " concurrent workflows). Please retry shortly.",
                    Instant.now(),
                    Collections.emptyList()
                ));
        }

        TaskRegistry registry = taskActionResolver.resolveRegistry(request.tasks());
        TaskGraph graph = buildTaskGraph(request.tasks(), request.edges());

        try {
            WorkflowExecutionResult result = executeGraphUnderPermit(
                graph,
                registry,
                clampConcurrency(request.concurrency()),
                timeout,
                unit,
                null,
                onPermitReleased
            );
            return ResponseEntity.ok(toResponseDto(result));
        } catch (RejectedExecutionException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiErrorResponse(
                    503,
                    "Service Unavailable",
                    "Workflow execution dispatcher is currently unavailable",
                    Instant.now(),
                    Collections.emptyList()
                ));
        } catch (TimeoutException e) {
            return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT)
                .body(new ApiErrorResponse(
                    504,
                    "Gateway Timeout",
                    "Workflow execution exceeded maximum synchronous limit of " + timeout + " " + unit.name().toLowerCase(),
                    Instant.now(),
                    Collections.emptyList()
                ));
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            if (cause instanceof InvalidDagException ide) {
                List<String> details = ide.getValidationResult() != null ? ide.getValidationResult().errors() : Collections.emptyList();
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ApiErrorResponse(400, "Bad Request", ide.getMessage(), Instant.now(), details));
            }
            if (cause instanceof IllegalArgumentException iae) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ApiErrorResponse(400, "Bad Request", iae.getMessage(), Instant.now(), Collections.emptyList()));
            }
            log.error("Internal error executing workflow request", cause);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiErrorResponse(
                    500,
                    "Internal Server Error",
                    "An unexpected internal error occurred while executing the workflow",
                    Instant.now(),
                    Collections.emptyList()
                ));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("HTTP request thread interrupted while waiting for workflow", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiErrorResponse(
                    500,
                    "Internal Server Error",
                    "Workflow execution wait was interrupted",
                    Instant.now(),
                    Collections.emptyList()
                ));
        }
    }

    enum DispatchState {
        QUEUED,
        RUNNING,
        CANCELLED_IN_QUEUE
    }

    void releasePermitSafely(AtomicBoolean permitHandled, Runnable onPermitReleased) {
        if (permitHandled.compareAndSet(false, true)) {
            workflowSemaphore.release();
            if (onPermitReleased != null) {
                try {
                    onPermitReleased.run();
                } catch (Throwable callbackError) {
                    log.error("Exception in onPermitReleased callback", callbackError);
                }
            }
        }
    }

    void reclaimPermitWhenTerminated(WorkflowScheduler scheduler, AtomicBoolean permitHandled, Runnable onPermitReleased) {
        boolean terminated = false;
        try {
            terminated = (scheduler == null || isSchedulerTerminated(scheduler));
        } catch (Throwable t) {
            log.warn("Exception during scheduler termination check in reclaimPermitWhenTerminated; quarantining permit", t);
            terminated = false;
        }

        if (terminated) {
            releasePermitSafely(permitHandled, onPermitReleased);
            return;
        }

        if (isShutdown()) {
            boolean termOnShutdown = false;
            try {
                termOnShutdown = isSchedulerTerminated(scheduler);
            } catch (Throwable ignored) {
                termOnShutdown = false;
            }
            if (termOnShutdown) {
                releasePermitSafely(permitHandled, onPermitReleased);
            } else {
                log.warn("Application is shutting down. Worker is still executing; permit remains safely quarantined until process termination.");
            }
            return;
        }

        try {
            permitReaperExecutor.submit(() -> runReaperLoop(scheduler, permitHandled, onPermitReleased));
        } catch (RejectedExecutionException e) {
            log.warn("Permit reaper submission rejected; checking termination status", e);
            if (isSchedulerTerminated(scheduler)) {
                releasePermitSafely(permitHandled, onPermitReleased);
            } else if (isShutdown()) {
                log.warn("Application is shutting down and permit reaper submission was rejected. Worker is still executing; permit remains quarantined until process termination.");
            } else {
                log.warn("Permit reaper pool rejected submission during normal operation; launching asynchronous fallback reaper thread.");
                Thread fallback = new Thread(
                    () -> runReaperLoop(scheduler, permitHandled, onPermitReleased),
                    "flowforge-permit-reaper-fallback"
                );
                fallback.setDaemon(true);
                fallback.start();
            }
        }
    }

    void runReaperLoop(WorkflowScheduler scheduler, AtomicBoolean permitHandled, Runnable onPermitReleased) {
        long totalWaitedMs = 0;
        while (!permitHandled.get()) {
            long stepMs = getReaperStepTimeoutMs();
            try {
                boolean terminated = scheduler.awaitTermination(stepMs, TimeUnit.MILLISECONDS);
                if (terminated || isSchedulerTerminated(scheduler)) {
                    releasePermitSafely(permitHandled, onPermitReleased);
                    log.info("Quarantined capacity permit successfully reclaimed after delayed worker termination (waited ~{}ms).", totalWaitedMs);
                    break;
                }
                totalWaitedMs += stepMs;
                if (totalWaitedMs % 30000 < stepMs) {
                    log.warn("Worker still executing after delayed termination check (waited ~{}s); capacity permit remains quarantined.", totalWaitedMs / 1000);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                if (isSchedulerTerminated(scheduler)) {
                    releasePermitSafely(permitHandled, onPermitReleased);
                    log.info("Quarantined capacity permit successfully reclaimed on reaper interruption.");
                    break;
                }
                if (isShutdown()) {
                    log.warn("Permit reaper interrupted during service shutdown. Worker remained active; permit remains quarantined.");
                    break;
                }
                log.warn("Permit reaper received transient interruption while worker is still alive; continuing reclamation.");
                Thread.interrupted();
            } catch (Throwable t) {
                if (t instanceof VirtualMachineError) {
                    throw (VirtualMachineError) t;
                }
                log.error("Unexpected error in permit reclamation loop; re-checking termination status", t);
                if (isSchedulerTerminated(scheduler)) {
                    releasePermitSafely(permitHandled, onPermitReleased);
                    break;
                }
                try {
                    Thread.sleep(Math.min(stepMs, 1000L));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    if (isShutdown()) {
                        break;
                    }
                    Thread.interrupted();
                }
            }
        }
    }

    /**
     * Executes a validated TaskGraph using the caller-acquired workflow permit.
     * Dispatches execution to the bounded dispatcher pool, monitors watchdog timeout,
     * and guarantees exception-proof permit cleanup or quarantine upon worker thread termination.
     *
     * @param graph validated task graph
     * @param registry registered executable task actions and retry policies
     * @param concurrency maximum parallel task worker threads
     * @param timeout maximum execution duration
     * @param unit timeout time unit
     * @param listener optional listener for observing task execution lifecycle events
     * @param onPermitReleased optional callback invoked when permit is successfully released
     * @return final workflow execution result
     */
    public WorkflowExecutionResult executeGraphUnderPermit(
        TaskGraph graph,
        TaskRegistry registry,
        int concurrency,
        long timeout,
        TimeUnit unit,
        TaskExecutionListener listener,
        Runnable onPermitReleased
    ) throws TimeoutException, ExecutionException, InterruptedException {
        AtomicBoolean permitHandled = new AtomicBoolean(false);
        CompletableFuture<WorkflowExecutionResult> executionFuture = new CompletableFuture<>();
        AtomicReference<WorkflowScheduler> schedulerRef = new AtomicReference<>();
        AtomicReference<DispatchState> dispatchState = new AtomicReference<>(DispatchState.QUEUED);

        Future<?> dispatchFuture = null;
        try {
            dispatchFuture = workflowDispatcherExecutor.submit(() -> {
                if (!dispatchState.compareAndSet(DispatchState.QUEUED, DispatchState.RUNNING)) {
                    // Cancelled while queued; caller already safely handled permit release
                    return;
                }
                WorkflowScheduler scheduler = null;
                WorkflowExecutionResult result = null;
                Throwable executionError = null;
                try {
                    scheduler = new WorkflowScheduler(concurrency);
                    schedulerRef.set(scheduler);
                    result = scheduler.execute(graph, registry, listener);
                } catch (Throwable t) {
                    log.error("Workflow execution failed", t);
                    executionError = t;
                } finally {
                    try {
                        closeScheduler(scheduler);
                    } catch (Throwable closeError) {
                        log.error("Exception during scheduler.close()", closeError);
                    } finally {
                        boolean canRelease = false;
                        try {
                            canRelease = isSchedulerTerminated(scheduler);
                        } catch (Throwable termError) {
                            log.error("Exception during scheduler termination check; quarantining permit", termError);
                            canRelease = false;
                        }

                        try {
                            if (canRelease) {
                                releasePermitSafely(permitHandled, onPermitReleased);
                            } else {
                                // Preserves capacity bound while worker is still running.
                                // Asynchronously reclaim permit once the scheduler actually terminates.
                                reclaimPermitWhenTerminated(scheduler, permitHandled, onPermitReleased);
                            }
                        } catch (Throwable releaseError) {
                            log.error("Exception during permit release/reclaim", releaseError);
                        }

                        if (executionError != null) {
                            executionFuture.completeExceptionally(executionError);
                        } else {
                            executionFuture.complete(result);
                        }
                    }
                }
            });
        } catch (RejectedExecutionException e) {
            releasePermitSafely(permitHandled, onPermitReleased);
            log.warn("Workflow submission rejected by dispatcher pool", e);
            throw e;
        }

        try {
            return executionFuture.get(timeout, unit);
        } catch (TimeoutException | InterruptedException e) {
            executionFuture.cancel(true);
            WorkflowScheduler s = schedulerRef.get();
            if (s != null) {
                s.cancel();
            }
            if (dispatchFuture != null) {
                dispatchFuture.cancel(true);
            }
            if (dispatchState.compareAndSet(DispatchState.QUEUED, DispatchState.CANCELLED_IN_QUEUE)) {
                // Task was cancelled before dispatcher thread started running.
                // The dispatcher runnable will abort at the entry CAS.
                // Safe to release permit immediately as no worker or scheduler was ever started.
                releasePermitSafely(permitHandled, onPermitReleased);
            }
            throw e;
        }
    }

    public void validateRequest(ExecuteWorkflowRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Request payload must not be null");
        }
        if (request.tasks() == null) {
            throw new IllegalArgumentException("tasks list must not be null");
        }
        if (request.edges() == null) {
            throw new IllegalArgumentException("edges list must not be null");
        }
        if (request.tasks().size() > MAX_TASKS_LIMIT) {
            throw new IllegalArgumentException("Task count exceeds limit of " + MAX_TASKS_LIMIT + ": " + request.tasks().size());
        }
        if (request.edges().size() > MAX_EDGES_LIMIT) {
            throw new IllegalArgumentException("Edge count exceeds limit of " + MAX_EDGES_LIMIT + ": " + request.edges().size());
        }

        Set<String> seenTaskIds = new HashSet<>();
        for (TaskDefinitionDto task : request.tasks()) {
            taskActionResolver.validateTaskDefinition(task);
            String id = task.id().trim();
            if (!seenTaskIds.add(id)) {
                throw new IllegalArgumentException("Duplicate task ID detected: " + id);
            }
        }

        Set<DependencyEdge> seenEdges = new HashSet<>();
        for (EdgeDto edge : request.edges()) {
            if (edge == null) {
                throw new IllegalArgumentException("Dependency edge must not be null");
            }
            if (edge.source() == null || edge.source().isBlank()) {
                throw new IllegalArgumentException("Edge source task ID must not be blank");
            }
            if (edge.target() == null || edge.target().isBlank()) {
                throw new IllegalArgumentException("Edge target task ID must not be blank");
            }
            String src = edge.source().trim();
            String tgt = edge.target().trim();
            if (!seenTaskIds.contains(src) || !seenTaskIds.contains(tgt)) {
                throw new IllegalArgumentException("Edge references unknown task: " + src + " -> " + tgt);
            }
            if (!seenEdges.add(new DependencyEdge(src, tgt))) {
                throw new IllegalArgumentException("Duplicate dependency edge detected: " + src + " -> " + tgt);
            }
        }

        // Validate graph topology before scheduling
        TaskGraph graph = buildTaskGraph(request.tasks(), request.edges());
        DagValidationResult validation = DagEngine.validate(graph);
        if (!validation.isValid()) {
            throw new InvalidDagException("Cannot schedule invalid DAG: " + String.join("; ", validation.errors()), validation);
        }
    }

    public TaskGraph buildTaskGraph(List<TaskDefinitionDto> tasks, List<EdgeDto> edges) {
        List<String> taskIds = new ArrayList<>();
        if (tasks != null) {
            for (TaskDefinitionDto task : tasks) {
                taskIds.add(task.id().trim());
            }
        }

        List<DependencyEdge> dependencyEdges = new ArrayList<>();
        if (edges != null) {
            for (EdgeDto edge : edges) {
                dependencyEdges.add(new DependencyEdge(edge.source().trim(), edge.target().trim()));
            }
        }

        return TaskGraph.of(taskIds, dependencyEdges);
    }

    public int clampConcurrency(Integer requested) {
        if (requested == null || requested <= 0) {
            return MAX_CONCURRENCY;
        }
        return Math.min(MAX_CONCURRENCY, Math.max(1, requested));
    }

    boolean isSchedulerTerminated(WorkflowScheduler scheduler) {
        return scheduler == null || scheduler.isTerminated();
    }

    void closeScheduler(WorkflowScheduler scheduler) {
        if (scheduler != null) {
            scheduler.close();
        }
    }

    public ExecuteWorkflowResponse toResponseDto(WorkflowExecutionResult result) {
        Instant startedAt = result.startedAt();
        Instant completedAt = result.completedAt();
        Long durationMs = startedAt != null && completedAt != null
            ? Duration.between(startedAt, completedAt).toMillis()
            : null;

        Map<String, TaskExecutionResponseDto> taskResults = new LinkedHashMap<>();
        for (Map.Entry<String, TaskExecutionResult> entry : result.taskResults().entrySet()) {
            TaskExecutionResult task = entry.getValue();
            Instant tStart = task.startedAt();
            Instant tEnd = task.completedAt();
            Long tDuration = tStart != null && tEnd != null
                ? Duration.between(tStart, tEnd).toMillis()
                : null;

            taskResults.put(entry.getKey(), new TaskExecutionResponseDto(
                task.taskId(),
                task.state(),
                tStart,
                tEnd,
                tDuration,
                task.attemptCount(),
                TaskErrorSanitizer.sanitize(task.error()),
                TaskErrorSanitizer.sanitizeAll(task.attemptErrors())
            ));
        }

        return new ExecuteWorkflowResponse(
            result.state(),
            startedAt,
            completedAt,
            durationMs,
            taskResults
        );
    }

    public boolean isShutdown() {
        return isShutdown.get();
    }

    long getReaperStepTimeoutMs() {
        return reaperStepTimeoutMs;
    }

    void setReaperStepTimeoutMs(long ms) {
        this.reaperStepTimeoutMs = ms;
    }

    ThreadPoolExecutor getPermitReaperExecutor() {
        return permitReaperExecutor;
    }

    @PreDestroy
    public void shutdown() {
        if (isShutdown.compareAndSet(false, true)) {
            workflowDispatcherExecutor.shutdown();
            permitReaperExecutor.shutdownNow();
            try {
                if (!workflowDispatcherExecutor.awaitTermination(2, TimeUnit.SECONDS)) {
                    workflowDispatcherExecutor.shutdownNow();
                }
            } catch (InterruptedException e) {
                workflowDispatcherExecutor.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }
}
