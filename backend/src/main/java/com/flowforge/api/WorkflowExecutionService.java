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

        AtomicBoolean permitHandled = new AtomicBoolean(false);
        CompletableFuture<WorkflowExecutionResult> executionFuture = new CompletableFuture<>();

        int concurrency = clampConcurrency(request.concurrency());

        // 3. Dispatch to Bounded Dispatcher Pool
        try {
            workflowDispatcherExecutor.execute(() -> {
                // Ownership transferred to this background runnable
                WorkflowScheduler scheduler = null;
                try {
                    scheduler = new WorkflowScheduler(concurrency);
                    TaskRegistry registry = taskActionResolver.resolveRegistry(request.tasks());
                    TaskGraph graph = buildTaskGraph(request.tasks(), request.edges());

                    WorkflowExecutionResult result = scheduler.execute(graph, registry);
                    executionFuture.complete(result);
                } catch (Throwable t) {
                    log.error("Workflow execution failed", t);
                    executionFuture.completeExceptionally(t);
                } finally {
                    // Exception-proof cleanup and permit disposition
                    try {
                        if (scheduler != null) {
                            scheduler.close();
                        }
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

                        if (canRelease) {
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
                        } else {
                            // QUARANTINE: Worker threads failed to terminate or termination check threw exception
                            permitHandled.set(true);
                            log.error("CRITICAL: Workflow worker threads failed to terminate within deadline or check failed. Capacity permit quarantined.");
                        }
                    }
                }
            });
        } catch (RejectedExecutionException e) {
            // Submission rejected before execution began (e.g. pool shutdown)
            if (permitHandled.compareAndSet(false, true)) {
                workflowSemaphore.release();
            }
            log.warn("Workflow submission rejected by dispatcher pool", e);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiErrorResponse(
                    503,
                    "Service Unavailable",
                    "Workflow execution dispatcher is currently unavailable",
                    Instant.now(),
                    Collections.emptyList()
                ));
        }

        // 4. HTTP Thread Synchronous Wait with Deadline
        try {
            WorkflowExecutionResult result = executionFuture.get(timeout, unit);
            return ResponseEntity.ok(toResponseDto(result));
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

    @PreDestroy
    public void shutdown() {
        workflowDispatcherExecutor.shutdown();
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
