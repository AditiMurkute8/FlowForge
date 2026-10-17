package com.flowforge.scheduler;

import com.flowforge.core.DagEngine;
import com.flowforge.core.DagValidationResult;
import com.flowforge.core.DependencyEdge;
import com.flowforge.core.InvalidDagException;
import com.flowforge.core.TaskGraph;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-process DAG workflow scheduler.
 * Validates DAG and task actions before execution, coordinates prerequisite completion,
 * executes ready tasks concurrently using a bounded thread pool, and enforces fail-fast semantics.
 */
public final class WorkflowScheduler implements AutoCloseable {

    private final ExecutorService executor;
    private final ScheduledExecutorService retryScheduler;
    private final int maxConcurrency;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private final Set<WorkflowExecutionContext> activeContexts = Collections.newSetFromMap(new ConcurrentHashMap<>());

    /**
     * Creates a scheduler with the specified maximum concurrency.
     *
     * @param maxConcurrency maximum number of worker threads, must be positive
     */
    public WorkflowScheduler(int maxConcurrency) {
        if (maxConcurrency <= 0) {
            throw new IllegalArgumentException("maxConcurrency must be positive: " + maxConcurrency);
        }
        this.maxConcurrency = maxConcurrency;
        this.executor = Executors.newFixedThreadPool(maxConcurrency, new ThreadFactory() {
            private final AtomicInteger counter = new AtomicInteger(1);

            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "flowforge-worker-" + counter.getAndIncrement());
                t.setDaemon(true);
                return t;
            }
        });
        this.retryScheduler = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
            private final AtomicInteger counter = new AtomicInteger(1);

            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "flowforge-retry-timer-" + counter.getAndIncrement());
                t.setDaemon(true);
                return t;
            }
        });
    }

    /**
     * Creates a scheduler with default concurrency based on available CPU cores.
     */
    public WorkflowScheduler() {
        this(Math.max(2, Runtime.getRuntime().availableProcessors()));
    }

    /**
     * Executes the given task graph using actions and retry policies from the registry.
     * Blocks synchronously until all tasks in the workflow have finished.
     *
     * @param graph the task graph to execute
     * @param registry the registry containing executable actions and retry policies for tasks
     * @return the workflow execution result
     * @throws InvalidDagException if the DAG contains cycles, duplicate task IDs, duplicate edges, or missing references
     * @throws IllegalStateException if the scheduler is closed or if any task is missing a registered action
     */
    public WorkflowExecutionResult execute(TaskGraph graph, TaskRegistry registry) {
        Objects.requireNonNull(graph, "graph must not be null");
        Objects.requireNonNull(registry, "registry must not be null");

        if (closed.get()) {
            throw new IllegalStateException("Scheduler is closed");
        }

        // 1. Validate complete DAG before executing any task
        DagValidationResult validation = DagEngine.validate(graph);
        if (!validation.isValid()) {
            throw new InvalidDagException(
                "Cannot schedule invalid DAG: " + String.join("; ", validation.errors()),
                validation
            );
        }

        // 2. Validate that every task in the graph has a registered action
        registry.validateAllTasksRegistered(graph.taskIds());

        Instant startedAt = Instant.now();

        // 3. Handle empty graph immediately
        if (graph.taskIds().isEmpty()) {
            return new WorkflowExecutionResult(
                WorkflowRunState.COMPLETED,
                Map.of(),
                startedAt,
                Instant.now()
            );
        }

        // 4. Run the workflow execution
        WorkflowExecutionContext context = new WorkflowExecutionContext(graph, registry, startedAt);
        activeContexts.add(context);
        try {
            return context.run(executor, retryScheduler);
        } finally {
            activeContexts.remove(context);
        }
    }

    /**
     * Returns true if the scheduler has been closed.
     */
    public boolean isClosed() {
        return closed.get();
    }

    /**
     * Returns the configured maximum concurrency.
     */
    public int getMaxConcurrency() {
        return maxConcurrency;
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            for (WorkflowExecutionContext context : activeContexts) {
                context.cancel();
            }
            executor.shutdown();
            retryScheduler.shutdown();
            try {
                boolean terminated = executor.awaitTermination(5, TimeUnit.SECONDS);
                terminated = retryScheduler.awaitTermination(5, TimeUnit.SECONDS) && terminated;
                if (!terminated) {
                    executor.shutdownNow();
                    retryScheduler.shutdownNow();
                }
            } catch (InterruptedException e) {
                executor.shutdownNow();
                retryScheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * Internal state coordinator for a single workflow execution.
     */
    private static final class WorkflowExecutionContext {
        private final TaskGraph graph;
        private final TaskRegistry registry;
        private final Instant startedAt;
        private final Map<String, TaskContext> taskContexts = new LinkedHashMap<>();
        private final Object lock = new Object();
        private final CountDownLatch completionLatch = new CountDownLatch(1);

        private boolean hasFailure = false;
        private int activeRunningTasks = 0;

        void cancel() {
            synchronized (lock) {
                hasFailure = true;
                cancelPendingTasksLocked();
                checkCompletionLocked();
            }
        }

        WorkflowExecutionContext(TaskGraph graph, TaskRegistry registry, Instant startedAt) {
            this.graph = graph;
            this.registry = registry;
            this.startedAt = startedAt;

            // Initialize task contexts with registered actions and retry policies
            for (String taskId : graph.taskIds()) {
                taskContexts.put(taskId, new TaskContext(taskId, registry.get(taskId), registry.getRetryPolicy(taskId)));
            }

            // Wire dependencies and prerequisite counts
            for (DependencyEdge edge : graph.edges()) {
                TaskContext source = taskContexts.get(edge.source());
                TaskContext target = taskContexts.get(edge.target());
                source.dependents.add(edge.target());
                target.remainingPrerequisites++;
            }
        }

        WorkflowExecutionResult run(ExecutorService executor, ScheduledExecutorService retryScheduler) {
            synchronized (lock) {
                // Find all tasks with zero prerequisites
                List<TaskContext> initialReady = new ArrayList<>();
                for (TaskContext tc : taskContexts.values()) {
                    if (tc.remainingPrerequisites == 0) {
                        initialReady.add(tc);
                    }
                }

                // Sort initial tasks deterministically by task ID
                initialReady.sort(Comparator.comparing(a -> a.taskId));

                // Dispatch initial ready tasks to worker pool
                for (TaskContext tc : initialReady) {
                    try {
                        executor.submit(() -> executeTask(tc, executor, retryScheduler));
                    } catch (RejectedExecutionException e) {
                        handleRejectionLocked(tc, e);
                        checkCompletionLocked();
                        break;
                    }
                }
            }

            // Await complete workflow completion
            try {
                completionLatch.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("Workflow execution was interrupted", e);
            }

            // Build final immutable results
            Map<String, TaskExecutionResult> results = new LinkedHashMap<>();
            synchronized (lock) {
                for (Map.Entry<String, TaskContext> entry : taskContexts.entrySet()) {
                    results.put(entry.getKey(), entry.getValue().toResult());
                }
                WorkflowRunState finalState = hasFailure ? WorkflowRunState.FAILED : WorkflowRunState.COMPLETED;
                return new WorkflowExecutionResult(finalState, results, startedAt, Instant.now());
            }
        }

        private void executeTask(TaskContext tc, ExecutorService executor, ScheduledExecutorService retryScheduler) {
            synchronized (lock) {
                if (hasFailure || tc.state != TaskState.PENDING) {
                    if (tc.state == TaskState.PENDING) {
                        tc.state = TaskState.CANCELLED;
                        tc.completedAt = Instant.now();
                        checkCompletionLocked();
                    }
                    return;
                }
                tc.state = TaskState.RUNNING;
                if (tc.startedAt == null) {
                    tc.startedAt = Instant.now();
                }
                tc.attemptCount++;
                activeRunningTasks++;
            }

            Throwable taskError = null;
            try {
                tc.action.execute(tc.taskId);
            } catch (Throwable t) {
                taskError = t;
            }

            synchronized (lock) {
                activeRunningTasks--;

                if (taskError == null) {
                    // Task attempt completed successfully
                    tc.state = TaskState.COMPLETED;
                    tc.completedAt = Instant.now();
                    tc.error = null;

                    if (!hasFailure) {
                        // Sort dependents deterministically
                        List<String> sortedDeps = new ArrayList<>(tc.dependents);
                        Collections.sort(sortedDeps);

                        for (String depId : sortedDeps) {
                            TaskContext depCtx = taskContexts.get(depId);
                            depCtx.remainingPrerequisites--;
                            if (depCtx.remainingPrerequisites == 0 && depCtx.state == TaskState.PENDING) {
                                try {
                                    executor.submit(() -> executeTask(depCtx, executor, retryScheduler));
                                } catch (RejectedExecutionException e) {
                                    handleRejectionLocked(depCtx, e);
                                    break;
                                }
                            }
                        }
                    }
                    checkCompletionLocked();
                } else {
                    tc.attemptErrors.add(taskError);
                    tc.error = taskError;

                    boolean canRetry = !hasFailure
                        && tc.attemptCount < tc.retryPolicy.maxAttempts()
                        && tc.retryPolicy.isRetryable(taskError);

                    if (canRetry) {
                        tc.state = TaskState.PENDING;
                        Duration delay = tc.retryPolicy.computeDelay(tc.attemptCount);

                        if (delay.isZero() || delay.isNegative()) {
                            try {
                                executor.submit(() -> executeTask(tc, executor, retryScheduler));
                            } catch (RejectedExecutionException e) {
                                handleRejectionLocked(tc, e);
                                checkCompletionLocked();
                            }
                        } else {
                            try {
                                tc.scheduledRetry = retryScheduler.schedule(() -> {
                                    synchronized (lock) {
                                        tc.scheduledRetry = null;
                                        if (!hasFailure && tc.state == TaskState.PENDING) {
                                            try {
                                                executor.submit(() -> executeTask(tc, executor, retryScheduler));
                                            } catch (RejectedExecutionException e) {
                                                handleRejectionLocked(tc, e);
                                                checkCompletionLocked();
                                            }
                                        } else {
                                            checkCompletionLocked();
                                        }
                                    }
                                }, delay.toMillis(), TimeUnit.MILLISECONDS);
                            } catch (RejectedExecutionException e) {
                                handleRejectionLocked(tc, e);
                                checkCompletionLocked();
                            }
                        }
                    } else {
                        // Terminal failure: exhausted attempts or non-retryable error
                        tc.state = TaskState.FAILED;
                        tc.completedAt = Instant.now();
                        hasFailure = true;

                        // Fail-fast: cancel all tasks still in PENDING and cancel scheduled retries
                        cancelPendingTasksLocked();
                        checkCompletionLocked();
                    }
                }
            }
        }

        private void handleRejectionLocked(TaskContext tc, RejectedExecutionException e) {
            tc.state = TaskState.FAILED;
            tc.error = e;
            tc.completedAt = Instant.now();
            hasFailure = true;
            cancelPendingTasksLocked();
        }

        private void cancelPendingTasksLocked() {
            for (TaskContext other : taskContexts.values()) {
                if (other.scheduledRetry != null) {
                    other.scheduledRetry.cancel(false);
                    other.scheduledRetry = null;
                }
                if (other.state == TaskState.PENDING) {
                    other.state = TaskState.CANCELLED;
                    other.completedAt = Instant.now();
                }
            }
        }

        private void checkCompletionLocked() {
            boolean anyPending = false;
            for (TaskContext ctx : taskContexts.values()) {
                if (ctx.state == TaskState.PENDING) {
                    anyPending = true;
                    break;
                }
            }

            if (!anyPending && activeRunningTasks == 0) {
                completionLatch.countDown();
            }
        }
    }

    /**
     * Mutable state for a single task during execution, protected by WorkflowExecutionContext monitor lock.
     */
    private static final class TaskContext {
        final String taskId;
        final TaskAction action;
        final RetryPolicy retryPolicy;
        final List<String> dependents = new ArrayList<>();
        int remainingPrerequisites = 0;
        TaskState state = TaskState.PENDING;
        Instant startedAt;
        Instant completedAt;
        Throwable error;
        int attemptCount = 0;
        final List<Throwable> attemptErrors = new ArrayList<>();
        ScheduledFuture<?> scheduledRetry;

        TaskContext(String taskId, TaskAction action, RetryPolicy retryPolicy) {
            this.taskId = taskId;
            this.action = action;
            this.retryPolicy = retryPolicy != null ? retryPolicy : RetryPolicy.none();
        }

        TaskExecutionResult toResult() {
            return new TaskExecutionResult(
                taskId,
                state,
                error,
                startedAt,
                completedAt,
                attemptCount,
                attemptErrors
            );
        }
    }
}
