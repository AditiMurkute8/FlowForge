package com.flowforge.scheduler;

import com.flowforge.core.DependencyEdge;
import com.flowforge.core.InvalidDagException;
import com.flowforge.core.TaskGraph;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WorkflowSchedulerTest {

    @Test
    @DisplayName("1. Single-task workflow executes to completion")
    void singleTaskWorkflow() {
        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());
        AtomicBoolean executed = new AtomicBoolean(false);

        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> executed.set(true));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(result.state()).isEqualTo(WorkflowRunState.COMPLETED);
            assertThat(executed.get()).isTrue();

            TaskExecutionResult taskResult = result.taskResults().get("task-1");
            assertThat(taskResult).isNotNull();
            assertThat(taskResult.state()).isEqualTo(TaskState.COMPLETED);
            assertThat(taskResult.getError()).isEmpty();
            assertThat(taskResult.getStartedAt()).isPresent();
            assertThat(taskResult.getCompletedAt()).isPresent();
        }
    }

    @Test
    @DisplayName("2. Linear dependency chain executes strictly in topological order")
    void linearDependencyChain() {
        // fetch -> clean -> store
        TaskGraph graph = TaskGraph.of(
            List.of("fetch", "clean", "store"),
            List.of(
                new DependencyEdge("fetch", "clean"),
                new DependencyEdge("clean", "store")
            )
        );

        Queue<String> executionOrder = new ConcurrentLinkedQueue<>();
        TaskRegistry registry = new TaskRegistry()
            .register("fetch", executionOrder::add)
            .register("clean", executionOrder::add)
            .register("store", executionOrder::add);

        try (WorkflowScheduler scheduler = new WorkflowScheduler(3)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(result.state()).isEqualTo(WorkflowRunState.COMPLETED);
            assertThat(executionOrder).containsExactly("fetch", "clean", "store");

            assertThat(result.taskResults().get("fetch").state()).isEqualTo(TaskState.COMPLETED);
            assertThat(result.taskResults().get("clean").state()).isEqualTo(TaskState.COMPLETED);
            assertThat(result.taskResults().get("store").state()).isEqualTo(TaskState.COMPLETED);
        }
    }

    @Test
    @DisplayName("3. Concurrent independent tasks run in parallel using latch synchronization")
    void concurrentIndependentTasks() throws Exception {
        TaskGraph graph = TaskGraph.of(List.of("task-A", "task-B"), List.of());

        CountDownLatch bothRunningLatch = new CountDownLatch(2);
        CountDownLatch releaseLatch = new CountDownLatch(1);

        TaskRegistry registry = new TaskRegistry()
            .register("task-A", id -> {
                bothRunningLatch.countDown();
                boolean released = releaseLatch.await(5, TimeUnit.SECONDS);
                if (!released) {
                    throw new TimeoutException("Timed out waiting for release latch");
                }
            })
            .register("task-B", id -> {
                bothRunningLatch.countDown();
                boolean released = releaseLatch.await(5, TimeUnit.SECONDS);
                if (!released) {
                    throw new TimeoutException("Timed out waiting for release latch");
                }
            });

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            ExecutorService testExecutor = Executors.newSingleThreadExecutor();
            try {
                Future<WorkflowExecutionResult> future = testExecutor.submit(() -> scheduler.execute(graph, registry));

                // Await proof that both task-A and task-B are running concurrently on separate threads
                boolean bothStarted = bothRunningLatch.await(5, TimeUnit.SECONDS);
                assertThat(bothStarted).as("Both tasks must be running simultaneously").isTrue();

                // Release tasks to finish
                releaseLatch.countDown();

                WorkflowExecutionResult result = future.get(5, TimeUnit.SECONDS);
                assertThat(result.isSuccessful()).isTrue();
                assertThat(result.taskResults().get("task-A").state()).isEqualTo(TaskState.COMPLETED);
                assertThat(result.taskResults().get("task-B").state()).isEqualTo(TaskState.COMPLETED);
            } finally {
                testExecutor.shutdownNow();
            }
        }
    }

    @Test
    @DisplayName("4. Diamond DAG: final dependent starts only after both parallel branches complete")
    void diamondDagWaitsForAllPrerequisites() {
        // A -> B, A -> C, B -> D, C -> D
        TaskGraph graph = TaskGraph.of(
            List.of("A", "B", "C", "D"),
            List.of(
                new DependencyEdge("A", "B"),
                new DependencyEdge("A", "C"),
                new DependencyEdge("B", "D"),
                new DependencyEdge("C", "D")
            )
        );

        Set<String> completedTasks = ConcurrentHashMap.newKeySet();
        AtomicBoolean dPrerequisitesMet = new AtomicBoolean(false);

        TaskRegistry registry = new TaskRegistry()
            .register("A", id -> completedTasks.add(id))
            .register("B", id -> {
                completedTasks.add(id);
            })
            .register("C", id -> {
                completedTasks.add(id);
            })
            .register("D", id -> {
                if (completedTasks.contains("B") && completedTasks.contains("C") && completedTasks.contains("A")) {
                    dPrerequisitesMet.set(true);
                }
                completedTasks.add(id);
            });

        try (WorkflowScheduler scheduler = new WorkflowScheduler(4)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(dPrerequisitesMet.get()).as("Task D must see B and C completed").isTrue();
            assertThat(result.taskResults().get("D").state()).isEqualTo(TaskState.COMPLETED);
        }
    }

    @Test
    @DisplayName("5. Task failure captures exception and marks workflow as FAILED")
    void taskFailureCapturesException() {
        TaskGraph graph = TaskGraph.of(List.of("failing-task"), List.of());

        TaskRegistry registry = new TaskRegistry()
            .register("failing-task", id -> {
                throw new IllegalStateException("Simulated database failure");
            });

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isFalse();
            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);

            TaskExecutionResult taskResult = result.taskResults().get("failing-task");
            assertThat(taskResult).isNotNull();
            assertThat(taskResult.state()).isEqualTo(TaskState.FAILED);
            assertThat(taskResult.getError()).isPresent();
            assertThat(taskResult.getError().get())
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Simulated database failure");
        }
    }

    @Test
    @DisplayName("6. Failed prerequisite cancels downstream dependents without invoking their actions")
    void failedPrerequisiteCancelsDependents() {
        // A -> B -> C (A fails, so B and C must be cancelled and never run)
        TaskGraph graph = TaskGraph.of(
            List.of("A", "B", "C"),
            List.of(
                new DependencyEdge("A", "B"),
                new DependencyEdge("B", "C")
            )
        );

        AtomicBoolean bInvoked = new AtomicBoolean(false);
        AtomicBoolean cInvoked = new AtomicBoolean(false);

        TaskRegistry registry = new TaskRegistry()
            .register("A", id -> {
                throw new RuntimeException("A failed");
            })
            .register("B", id -> bInvoked.set(true))
            .register("C", id -> cInvoked.set(true));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(3)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isFalse();
            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);

            assertThat(result.taskResults().get("A").state()).isEqualTo(TaskState.FAILED);
            assertThat(result.taskResults().get("B").state()).isEqualTo(TaskState.CANCELLED);
            assertThat(result.taskResults().get("C").state()).isEqualTo(TaskState.CANCELLED);

            assertThat(bInvoked.get()).as("Dependent B must not be invoked").isFalse();
            assertThat(cInvoked.get()).as("Dependent C must not be invoked").isFalse();
        }
    }

    @Test
    @DisplayName("7. Fail-fast cancels other pending tasks that have not started")
    void failFastCancelsOtherPendingTasks() throws Exception {
        // Single concurrency executor: task-1 starts and fails immediately.
        // task-2 is independent but queued in PENDING. It must be cancelled by fail-fast.
        TaskGraph graph = TaskGraph.of(List.of("task-1", "task-2"), List.of());

        AtomicBoolean task2Invoked = new AtomicBoolean(false);

        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> {
                throw new RuntimeException("Task 1 fatal failure");
            })
            .register("task-2", id -> task2Invoked.set(true));

        // Use concurrency of 1 to ensure task-2 is pending when task-1 fails
        try (WorkflowScheduler scheduler = new WorkflowScheduler(1)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);
            assertThat(result.taskResults().get("task-1").state()).isEqualTo(TaskState.FAILED);
            assertThat(result.taskResults().get("task-2").state()).isEqualTo(TaskState.CANCELLED);
            assertThat(task2Invoked.get()).as("Pending task-2 must be cancelled without execution").isFalse();
        }
    }

    @Test
    @DisplayName("8. Invalid cyclic DAG is rejected before any action executes")
    void invalidCyclicDagRejectedBeforeExecution() {
        TaskGraph graph = TaskGraph.of(
            List.of("A", "B"),
            List.of(
                new DependencyEdge("A", "B"),
                new DependencyEdge("B", "A")
            )
        );

        AtomicBoolean actionInvoked = new AtomicBoolean(false);
        TaskRegistry registry = new TaskRegistry()
            .register("A", id -> actionInvoked.set(true))
            .register("B", id -> actionInvoked.set(true));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            assertThatThrownBy(() -> scheduler.execute(graph, registry))
                .isInstanceOf(InvalidDagException.class)
                .hasMessageContaining("Cyclic dependency");

            assertThat(actionInvoked.get()).as("No action should run on invalid DAG").isFalse();
        }
    }

    @Test
    @DisplayName("9. Missing task action is rejected before any action executes")
    void missingTaskActionRejectedBeforeExecution() {
        TaskGraph graph = TaskGraph.of(List.of("task-1", "task-2"), List.of());

        AtomicBoolean task1Invoked = new AtomicBoolean(false);
        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> task1Invoked.set(true));
        // task-2 is deliberately not registered

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            assertThatThrownBy(() -> scheduler.execute(graph, registry))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Missing task action(s) for task(s): task-2");

            assertThat(task1Invoked.get()).as("No action should run when registry validation fails").isFalse();
        }
    }

    @Test
    @DisplayName("10. Empty graph completes successfully")
    void emptyGraphCompletesSuccessfully() {
        TaskGraph graph = TaskGraph.empty();
        TaskRegistry registry = new TaskRegistry();

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(result.state()).isEqualTo(WorkflowRunState.COMPLETED);
            assertThat(result.taskResults()).isEmpty();
            assertThat(result.startedAt()).isNotNull();
            assertThat(result.completedAt()).isNotNull();
        }
    }

    @Test
    @DisplayName("11. Every task action executes at most once under concurrent completion")
    void everyTaskExecutesAtMostOnceUnderConcurrentCompletion() {
        // Fan-in: 6 parallel tasks converge on a single target task
        List<String> taskIds = List.of("T1", "T2", "T3", "T4", "T5", "T6", "target");
        List<DependencyEdge> edges = List.of(
            new DependencyEdge("T1", "target"),
            new DependencyEdge("T2", "target"),
            new DependencyEdge("T3", "target"),
            new DependencyEdge("T4", "target"),
            new DependencyEdge("T5", "target"),
            new DependencyEdge("T6", "target")
        );
        TaskGraph graph = TaskGraph.of(taskIds, edges);

        Map<String, AtomicInteger> invocationCounts = new ConcurrentHashMap<>();
        for (String id : taskIds) {
            invocationCounts.put(id, new AtomicInteger(0));
        }

        TaskRegistry registry = new TaskRegistry();
        for (String id : taskIds) {
            registry.register(id, taskId -> invocationCounts.get(taskId).incrementAndGet());
        }

        try (WorkflowScheduler scheduler = new WorkflowScheduler(8)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            for (String id : taskIds) {
                assertThat(invocationCounts.get(id).get())
                    .as("Task %s must be executed exactly once", id)
                    .isEqualTo(1);
            }
        }
    }

    @Test
    @DisplayName("12. Executor shutdown and clean lifecycle behavior")
    void executorShutdownAndCleanLifecycle() {
        WorkflowScheduler scheduler = new WorkflowScheduler(2);
        assertThat(scheduler.isClosed()).isFalse();

        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());
        TaskRegistry registry = new TaskRegistry().register("task-1", id -> {});

        WorkflowExecutionResult result = scheduler.execute(graph, registry);
        assertThat(result.isSuccessful()).isTrue();

        // Close the scheduler
        scheduler.close();
        assertThat(scheduler.isClosed()).isTrue();

        // Repeated close is idempotent and does not error
        scheduler.close();
        assertThat(scheduler.isClosed()).isTrue();

        // Subsequent execute on closed scheduler must fail fast
        assertThatThrownBy(() -> scheduler.execute(graph, registry))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Scheduler is closed");
    }

    @Test
    @DisplayName("13. Deterministic race: branch becomes ready concurrently with failure on another branch")
    void concurrentBranchReadyAndFailureRace() throws Exception {
        // Graph structure:
        // Branch 1: A1 -> A2
        // Branch 2: B (fails)
        TaskGraph graph = TaskGraph.of(
            List.of("A1", "A2", "B"),
            List.of(new DependencyEdge("A1", "A2"))
        );

        // Run multiple iterations to exercise thread scheduling interleavings
        for (int i = 0; i < 20; i++) {
            CountDownLatch a1Started = new CountDownLatch(1);
            CountDownLatch bStarted = new CountDownLatch(1);
            CountDownLatch bFailed = new CountDownLatch(1);
            AtomicBoolean a2Invoked = new AtomicBoolean(false);

            TaskRegistry registry = new TaskRegistry()
                .register("A1", id -> {
                    a1Started.countDown();
                    if (!bStarted.await(5, TimeUnit.SECONDS)) {
                        throw new TimeoutException("Timed out waiting for B to start in A1");
                    }
                    if (!bFailed.await(5, TimeUnit.SECONDS)) {
                        throw new TimeoutException("Timed out waiting for B to fail in A1");
                    }
                })
                .register("A2", id -> a2Invoked.set(true))
                .register("B", id -> {
                    bStarted.countDown();
                    if (!a1Started.await(5, TimeUnit.SECONDS)) {
                        throw new TimeoutException("Timed out waiting for A1 to start in B");
                    }
                    throw new RuntimeException("Simulated failure in task B");
                });

            TaskExecutionListener listener = new TaskExecutionListener() {
                @Override
                public void onTaskFailed(String taskId, int attemptCount, Instant startedAt, Instant completedAt, Long durationMs, Throwable error) {
                    if ("B".equals(taskId)) {
                        bFailed.countDown();
                    }
                }
            };

            try (WorkflowScheduler scheduler = new WorkflowScheduler(4)) {
                ExecutorService testExecutor = Executors.newSingleThreadExecutor();
                try {
                    Future<WorkflowExecutionResult> future = testExecutor.submit(() -> scheduler.execute(graph, registry, listener));

                    // Deterministically wait until both root tasks A1 and B are actively running concurrently
                    assertThat(a1Started.await(5, TimeUnit.SECONDS))
                        .as("Task A1 must start running on iteration %d", i)
                        .isTrue();
                    assertThat(bStarted.await(5, TimeUnit.SECONDS))
                        .as("Task B must start running on iteration %d", i)
                        .isTrue();

                    WorkflowExecutionResult result = future.get(5, TimeUnit.SECONDS);

                    assertThat(result.isSuccessful()).isFalse();
                    assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);

                    // A1 completed naturally
                    TaskExecutionResult a1Result = result.taskResults().get("A1");
                    assertThat(a1Result.state()).isEqualTo(TaskState.COMPLETED);
                    assertThat(a1Result.getError()).isEmpty();

                    // B failed and captured its exception
                    TaskExecutionResult bResult = result.taskResults().get("B");
                    assertThat(bResult.state()).isEqualTo(TaskState.FAILED);
                    assertThat(bResult.getError()).isPresent();
                    assertThat(bResult.getError().get())
                        .isInstanceOf(RuntimeException.class)
                        .hasMessage("Simulated failure in task B");

                    // A2 was made ready by A1 completion concurrently with B failure,
                    // but fail-fast must cancel it and its action must NEVER execute.
                    TaskExecutionResult a2Result = result.taskResults().get("A2");
                    assertThat(a2Result.state()).isEqualTo(TaskState.CANCELLED);
                    assertThat(a2Invoked.get()).as("Task A2 action must not execute on iteration %d", i).isFalse();
                    assertThat(a2Result.getStartedAt()).as("Cancelled task A2 must have no startedAt").isEmpty();
                    assertThat(a2Result.getCompletedAt()).as("Cancelled task A2 must have completedAt").isPresent();
                } finally {
                    testExecutor.shutdownNow();
                }
            }
        }
    }

    @Test
    @DisplayName("14. Task with retry policy succeeding on first attempt records 1 attempt and no delay")
    void firstAttemptSuccessWithRetryPolicy() {
        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());
        AtomicInteger runCount = new AtomicInteger(0);

        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> runCount.incrementAndGet(), RetryPolicy.fixed(3, Duration.ofMillis(50)));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(result.state()).isEqualTo(WorkflowRunState.COMPLETED);
            assertThat(runCount.get()).isEqualTo(1);

            TaskExecutionResult taskResult = result.taskResults().get("task-1");
            assertThat(taskResult.state()).isEqualTo(TaskState.COMPLETED);
            assertThat(taskResult.getAttemptCount()).isEqualTo(1);
            assertThat(taskResult.getAttemptErrors()).isEmpty();
            assertThat(taskResult.getError()).isEmpty();
            assertThat(taskResult.getStartedAt()).isPresent();
            assertThat(taskResult.getCompletedAt()).isPresent();
        }
    }

    @Test
    @DisplayName("15. Transient failure followed by success on retry completes workflow successfully")
    void transientFailureFollowedBySuccess() {
        TaskGraph graph = TaskGraph.of(List.of("flaky-task"), List.of());
        AtomicInteger attempts = new AtomicInteger(0);

        TaskRegistry registry = new TaskRegistry()
            .register("flaky-task", id -> {
                int current = attempts.incrementAndGet();
                if (current < 3) {
                    throw new IllegalStateException("Transient failure on attempt " + current);
                }
            }, RetryPolicy.fixed(4, Duration.ofMillis(10)));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(result.state()).isEqualTo(WorkflowRunState.COMPLETED);
            assertThat(attempts.get()).isEqualTo(3);

            TaskExecutionResult taskResult = result.taskResults().get("flaky-task");
            assertThat(taskResult.state()).isEqualTo(TaskState.COMPLETED);
            assertThat(taskResult.getAttemptCount()).isEqualTo(3);
            assertThat(taskResult.getAttemptErrors()).hasSize(2);
            assertThat(taskResult.getAttemptErrors().get(0)).hasMessage("Transient failure on attempt 1");
            assertThat(taskResult.getAttemptErrors().get(1)).hasMessage("Transient failure on attempt 2");
            assertThat(taskResult.getError()).isEmpty();
        }
    }

    @Test
    @DisplayName("16. Exhausting all retry attempts triggers terminal failure, records last error, and cancels dependents")
    void retryExhaustionTriggersTerminalFailure() {
        TaskGraph graph = TaskGraph.of(
            List.of("failing-task", "dependent-task"),
            List.of(new DependencyEdge("failing-task", "dependent-task"))
        );

        AtomicInteger attempts = new AtomicInteger(0);
        AtomicBoolean dependentRan = new AtomicBoolean(false);

        TaskRegistry registry = new TaskRegistry()
            .register("failing-task", id -> {
                int current = attempts.incrementAndGet();
                throw new RuntimeException("Persistent failure on attempt " + current);
            }, RetryPolicy.fixed(3, Duration.ofMillis(10)))
            .register("dependent-task", id -> dependentRan.set(true));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isFalse();
            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);
            assertThat(attempts.get()).isEqualTo(3);

            TaskExecutionResult failingResult = result.taskResults().get("failing-task");
            assertThat(failingResult.state()).isEqualTo(TaskState.FAILED);
            assertThat(failingResult.getAttemptCount()).isEqualTo(3);
            assertThat(failingResult.getAttemptErrors()).hasSize(3);
            assertThat(failingResult.getError()).isPresent();
            assertThat(failingResult.getError().get())
                .isInstanceOf(RuntimeException.class)
                .hasMessage("Persistent failure on attempt 3");

            TaskExecutionResult depResult = result.taskResults().get("dependent-task");
            assertThat(depResult.state()).isEqualTo(TaskState.CANCELLED);
            assertThat(depResult.getAttemptCount()).isEqualTo(0);
            assertThat(dependentRan.get()).isFalse();
        }
    }

    @Test
    @DisplayName("17. Non-retryable exception fails immediately on first attempt without retrying")
    void nonRetryableExceptionFailsImmediately() {
        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());
        AtomicInteger attempts = new AtomicInteger(0);

        // Retry only IOException, but task throws IllegalArgumentException
        RetryPolicy policy = RetryPolicy.fixed(5, Duration.ofMillis(10))
            .withPredicate(t -> t instanceof IOException);

        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> {
                attempts.incrementAndGet();
                throw new IllegalArgumentException("Non-retryable argument error");
            }, policy);

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isFalse();
            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);
            assertThat(attempts.get()).isEqualTo(1);

            TaskExecutionResult taskResult = result.taskResults().get("task-1");
            assertThat(taskResult.state()).isEqualTo(TaskState.FAILED);
            assertThat(taskResult.getAttemptCount()).isEqualTo(1);
            assertThat(taskResult.getAttemptErrors()).hasSize(1);
            assertThat(taskResult.getError().get())
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Non-retryable argument error");
        }
    }

    @Test
    @DisplayName("18. Dependents remain blocked while upstream prerequisite is retrying in backoff")
    void dependentsBlockedDuringRetries() throws Exception {
        TaskGraph graph = TaskGraph.of(
            List.of("parent", "child"),
            List.of(new DependencyEdge("parent", "child"))
        );

        AtomicInteger parentAttempts = new AtomicInteger(0);
        AtomicBoolean childStartedBeforeParentSuccess = new AtomicBoolean(false);
        AtomicBoolean parentSucceeded = new AtomicBoolean(false);

        TaskRegistry registry = new TaskRegistry()
            .register("parent", id -> {
                int current = parentAttempts.incrementAndGet();
                if (current == 1) {
                    throw new RuntimeException("First attempt fails");
                }
                parentSucceeded.set(true);
            }, RetryPolicy.fixed(2, Duration.ofMillis(50)))
            .register("child", id -> {
                if (!parentSucceeded.get()) {
                    childStartedBeforeParentSuccess.set(true);
                }
            });

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(parentAttempts.get()).isEqualTo(2);
            assertThat(childStartedBeforeParentSuccess.get()).isFalse();
            assertThat(result.taskResults().get("parent").state()).isEqualTo(TaskState.COMPLETED);
            assertThat(result.taskResults().get("child").state()).isEqualTo(TaskState.COMPLETED);
        }
    }

    @Test
    @DisplayName("19. Terminal failure on concurrent branch cancels another task waiting in retry backoff")
    void concurrentTerminalFailureCancelsWaitingRetry() throws Exception {
        // Branch 1: A (fails attempt 1 and enters backoff)
        // Branch 2: B (fails terminally, triggering fail-fast)
        TaskGraph graph = TaskGraph.of(List.of("A", "B"), List.of());

        CountDownLatch aAttempt1Done = new CountDownLatch(1);
        AtomicInteger aAttempts = new AtomicInteger(0);

        TaskRegistry registry = new TaskRegistry()
            .register("A", id -> {
                aAttempts.incrementAndGet();
                aAttempt1Done.countDown();
                throw new RuntimeException("A attempt 1 fails");
            }, RetryPolicy.fixed(3, Duration.ofMillis(300)))
            .register("B", id -> {
                // Wait until A has failed attempt 1 and entered backoff
                boolean aFailed = aAttempt1Done.await(5, TimeUnit.SECONDS);
                if (!aFailed) {
                    throw new TimeoutException("Timed out waiting for A to fail attempt 1");
                }
                throw new RuntimeException("B fatal failure");
            });

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isFalse();
            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);

            // B failed terminally
            assertThat(result.taskResults().get("B").state()).isEqualTo(TaskState.FAILED);

            // A had 1 attempt, was waiting in backoff, and was cancelled by fail-fast!
            TaskExecutionResult aResult = result.taskResults().get("A");
            assertThat(aResult.state()).isEqualTo(TaskState.CANCELLED);
            assertThat(aAttempts.get()).as("A must not execute attempt 2 after cancellation").isEqualTo(1);
        }
    }

    @Test
    @DisplayName("20. Closing scheduler while retries are waiting cancels timers cleanly")
    void schedulerCloseWhileRetryWaitingCancelsCleanly() throws Exception {
        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());
        CountDownLatch attempt1Started = new CountDownLatch(1);

        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> {
                attempt1Started.countDown();
                throw new RuntimeException("Attempt fails and enters long backoff");
            }, RetryPolicy.fixed(3, Duration.ofSeconds(10)));

        WorkflowScheduler scheduler = new WorkflowScheduler(2);
        ExecutorService testExecutor = Executors.newSingleThreadExecutor();
        try {
            Future<WorkflowExecutionResult> future = testExecutor.submit(() -> scheduler.execute(graph, registry));

            assertThat(attempt1Started.await(5, TimeUnit.SECONDS)).isTrue();

            // Give a small moment for attempt 1 to complete and schedule the 10s retry
            Thread.sleep(50);

            // Close scheduler while retry timer is pending
            scheduler.close();
            assertThat(scheduler.isClosed()).isTrue();

            WorkflowExecutionResult result = future.get(5, TimeUnit.SECONDS);
            assertThat(result.isSuccessful()).isFalse();
            assertThat(result.state()).isEqualTo(WorkflowRunState.FAILED);
            assertThat(result.taskResults().get("task-1").state()).isEqualTo(TaskState.CANCELLED);
        } finally {
            testExecutor.shutdownNow();
            scheduler.close();
        }
    }

    @Test
    @DisplayName("21. No duplicate execution after timer expiration and cancellation races")
    void noDuplicateExecutionAfterTimerExpiry() {
        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());
        AtomicInteger count = new AtomicInteger(0);

        TaskRegistry registry = new TaskRegistry()
            .register("task-1", id -> {
                if (count.incrementAndGet() < 2) {
                    throw new RuntimeException("retry once");
                }
            }, RetryPolicy.fixed(2, Duration.ofMillis(5)));

        try (WorkflowScheduler scheduler = new WorkflowScheduler(2)) {
            WorkflowExecutionResult result = scheduler.execute(graph, registry);

            assertThat(result.isSuccessful()).isTrue();
            assertThat(count.get()).as("Action must be executed exactly 2 times (attempt 1 and attempt 2)").isEqualTo(2);
            assertThat(result.taskResults().get("task-1").getAttemptCount()).isEqualTo(2);
        }
    }
}
