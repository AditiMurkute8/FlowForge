package com.flowforge.scheduler;

import com.flowforge.core.DagEngine;
import com.flowforge.core.DagValidationResult;
import com.flowforge.core.DependencyEdge;
import com.flowforge.core.InvalidDagException;
import com.flowforge.core.TaskGraph;

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
    private final int maxConcurrency;
    private final AtomicBoolean closed = new AtomicBoolean(false);

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
    }

    /**
     * Creates a scheduler with default concurrency based on available CPU cores.
     */
    public WorkflowScheduler() {
        this(Math.max(2, Runtime.getRuntime().availableProcessors()));
    }

    /**
     * Executes the given task graph using actions from the registry.
     * Blocks synchronously until all tasks in the workflow have finished.
     *
     * @param graph the task graph to execute
     * @param registry the registry containing executable actions for tasks
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
        return context.run(executor);
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
            executor.shutdown();
            try {
                if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                    executor.shutdownNow();
                }
            } catch (InterruptedException e) {
                executor.shutdownNow();
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

        WorkflowExecutionContext(TaskGraph graph, TaskRegistry registry, Instant startedAt) {
            this.graph = graph;
            this.registry = registry;
            this.startedAt = startedAt;

            // Initialize task contexts
            for (String taskId : graph.taskIds()) {
                taskContexts.put(taskId, new TaskContext(taskId, registry.get(taskId)));
            }

            // Wire dependencies and prerequisite counts
            for (DependencyEdge edge : graph.edges()) {
                TaskContext source = taskContexts.get(edge.source());
                TaskContext target = taskContexts.get(edge.target());
                source.dependents.add(edge.target());
                target.remainingPrerequisites++;
            }
        }

        WorkflowExecutionResult run(ExecutorService executor) {
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
                        executor.submit(() -> executeTask(tc, executor));
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

        private void executeTask(TaskContext tc, ExecutorService executor) {
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
                tc.startedAt = Instant.now();
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
                tc.completedAt = Instant.now();

                if (taskError != null) {
                    // Task failed
                    tc.state = TaskState.FAILED;
                    tc.error = taskError;
                    hasFailure = true;

                    // Fail-fast: cancel all tasks still in PENDING
                    cancelPendingTasksLocked();
                } else {
                    // Task completed successfully
                    tc.state = TaskState.COMPLETED;

                    if (!hasFailure) {
                        // Sort dependents deterministically
                        List<String> sortedDeps = new ArrayList<>(tc.dependents);
                        Collections.sort(sortedDeps);

                        for (String depId : sortedDeps) {
                            TaskContext depCtx = taskContexts.get(depId);
                            depCtx.remainingPrerequisites--;
                            if (depCtx.remainingPrerequisites == 0 && depCtx.state == TaskState.PENDING) {
                                try {
                                    executor.submit(() -> executeTask(depCtx, executor));
                                } catch (RejectedExecutionException e) {
                                    handleRejectionLocked(depCtx, e);
                                    break;
                                }
                            }
                        }
                    }
                }

                checkCompletionLocked();
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
        final List<String> dependents = new ArrayList<>();
        int remainingPrerequisites = 0;
        TaskState state = TaskState.PENDING;
        Instant startedAt;
        Instant completedAt;
        Throwable error;

        TaskContext(String taskId, TaskAction action) {
            this.taskId = taskId;
            this.action = action;
        }

        TaskExecutionResult toResult() {
            return new TaskExecutionResult(taskId, state, error, startedAt, completedAt);
        }
    }
}
