package com.flowforge.scheduler;

import com.flowforge.core.DependencyEdge;
import com.flowforge.core.InvalidDagException;
import com.flowforge.core.TaskGraph;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
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

        // Run multiple iterations to exercise different thread scheduling interleavings
        for (int i = 0; i < 20; i++) {
            CountDownLatch a1Started = new CountDownLatch(1);
            CountDownLatch bStarted = new CountDownLatch(1);
            CountDownLatch releaseBoth = new CountDownLatch(1);
            AtomicBoolean a2Invoked = new AtomicBoolean(false);

            TaskRegistry registry = new TaskRegistry()
                .register("A1", id -> {
                    a1Started.countDown();
                    if (!releaseBoth.await(5, TimeUnit.SECONDS)) {
                        throw new TimeoutException("Timed out waiting for releaseBoth in A1");
                    }
                })
                .register("A2", id -> a2Invoked.set(true))
                .register("B", id -> {
                    bStarted.countDown();
                    if (!releaseBoth.await(5, TimeUnit.SECONDS)) {
                        throw new TimeoutException("Timed out waiting for releaseBoth in B");
                    }
                    throw new RuntimeException("Simulated failure in task B");
                });

            try (WorkflowScheduler scheduler = new WorkflowScheduler(4)) {
                ExecutorService testExecutor = Executors.newSingleThreadExecutor();
                try {
                    Future<WorkflowExecutionResult> future = testExecutor.submit(() -> scheduler.execute(graph, registry));

                    // Deterministically wait until both root tasks A1 and B are actively running concurrently
                    assertThat(a1Started.await(5, TimeUnit.SECONDS))
                        .as("Task A1 must start running on iteration %d", i)
                        .isTrue();
                    assertThat(bStarted.await(5, TimeUnit.SECONDS))
                        .as("Task B must start running on iteration %d", i)
                        .isTrue();

                    // Release both tasks simultaneously to race A1 completion against B failure
                    releaseBoth.countDown();

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
}
