package com.flowforge.execution.scheduler;

import com.flowforge.dag.engine.DagEngine;
import com.flowforge.dag.model.Task;
import com.flowforge.dag.model.WorkflowDag;
import com.flowforge.execution.state.TaskState;
import com.flowforge.execution.state.TaskStateMachine;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;

class SchedulerTest {

    private DagEngine dagEngine;
    private TaskStateMachine stateMachine;
    private TestTaskExecutor testExecutor;

    /**
     * In-memory test double for TaskExecutor.
     */
    static class TestTaskExecutor implements TaskExecutor {
        private final Map<String, TaskExecutionResult> outcomes = new HashMap<>();
        private final List<Task> executedTasks = new ArrayList<>();
        private boolean autoComplete = true;

        public void setOutcome(String taskId, TaskExecutionResult result) {
            outcomes.put(taskId, result);
        }

        public void setAutoComplete(boolean autoComplete) {
            this.autoComplete = autoComplete;
        }

        @Override
        public TaskExecutionResult execute(Task task) {
            executedTasks.add(task);
            return autoComplete ? outcomes.getOrDefault(task.getId(), TaskExecutionResult.SUCCESS) : null;
        }

        public List<Task> getExecutedTasks() {
            return executedTasks;
        }
    }

    @BeforeEach
    void setUp() {
        dagEngine = new DagEngine();
        stateMachine = new TaskStateMachine();
        testExecutor = new TestTaskExecutor();
    }

    @Test
    @DisplayName("1. Single task workflow transition: READY -> RUNNING -> SUCCESS")
    void testSingleTaskExecution() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A", "Single Task")
                .build();

        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.READY);

        scheduler.scheduleReadyTasks();

        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.isWorkflowComplete()).isTrue();
        assertThat(scheduler.isWorkflowSuccessful()).isTrue();
        assertThat(testExecutor.getExecutedTasks()).extracting(Task::getId).containsExactly("A");
    }

    @Test
    @DisplayName("2. Linear workflow A -> B -> C dependency unlocking step by step")
    void testLinearWorkflowDependencyUnlocking() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addDependency("A", "B")
                .addDependency("B", "C")
                .build();

        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);

        // Initial state
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.READY);
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.PENDING);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.PENDING);

        // Step 1: Schedule A
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.READY);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.PENDING);

        // Step 2: Schedule B
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.READY);

        // Step 3: Schedule C
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.isWorkflowComplete()).isTrue();
        assertThat(scheduler.isWorkflowSuccessful()).isTrue();

        assertThat(testExecutor.getExecutedTasks()).extracting(Task::getId).containsExactly("A", "B", "C");
    }

    @Test
    @DisplayName("3. Parallel workflow: completing A makes both B and C READY")
    void testParallelWorkflowDependencyUnlocking() {
        //     A
        //    / \
        //   B   C
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addDependency("A", "B")
                .addDependency("A", "C")
                .build();

        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);

        // Schedule A
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.READY);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.READY);

        // Schedule B and C in parallel pass
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.isWorkflowComplete()).isTrue();
    }

    @Test
    @DisplayName("4. Diamond workflow: D unlocks ONLY after both B AND C complete")
    void testDiamondWorkflowDependencyUnlocking() {
        //     A
        //    / \
        //   B   C
        //    \ /
        //     D
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addTask("D")
                .addDependency("A", "B")
                .addDependency("A", "C")
                .addDependency("B", "D")
                .addDependency("C", "D")
                .build();

        // Control execution manually (disable auto-complete)
        testExecutor.setAutoComplete(false);
        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);

        // Start A
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.RUNNING);

        // Complete A -> unlocks B and C
        scheduler.onTaskCompleted("A", TaskExecutionResult.SUCCESS);
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.READY);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.READY);
        assertThat(scheduler.getTaskState("D")).isEqualTo(TaskState.PENDING);

        // Start B and C
        scheduler.scheduleReadyTasks();
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.RUNNING);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.RUNNING);

        // Complete ONLY B -> D must STILL be PENDING because C is not SUCCESS yet
        scheduler.onTaskCompleted("B", TaskExecutionResult.SUCCESS);
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.getTaskState("D")).isEqualTo(TaskState.PENDING);

        // Complete C -> NOW D becomes READY
        scheduler.onTaskCompleted("C", TaskExecutionResult.SUCCESS);
        assertThat(scheduler.getTaskState("C")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.getTaskState("D")).isEqualTo(TaskState.READY);

        // Start D and complete D
        scheduler.scheduleReadyTasks();
        scheduler.onTaskCompleted("D", TaskExecutionResult.SUCCESS);
        assertThat(scheduler.getTaskState("D")).isEqualTo(TaskState.SUCCESS);
        assertThat(scheduler.isWorkflowComplete()).isTrue();
    }

    @Test
    @DisplayName("5. Failure transition: RUNNING -> FAILED without retry logic")
    void testTaskFailureHandling() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addDependency("A", "B")
                .build();

        testExecutor.setOutcome("A", TaskExecutionResult.FAILURE);
        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);

        scheduler.scheduleReadyTasks();

        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.FAILED);
        // Dependent task B must remain PENDING
        assertThat(scheduler.getTaskState("B")).isEqualTo(TaskState.PENDING);
        assertThat(scheduler.isWorkflowComplete()).isFalse();
        assertThat(scheduler.isWorkflowSuccessful()).isFalse();
    }

    @Test
    @DisplayName("6. Invalid completion: completing a non-RUNNING task throws IllegalStateException")
    void testInvalidTaskCompletionThrowsException() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .build();

        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);
        // A is currently READY, not RUNNING
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.READY);

        assertThatThrownBy(() -> scheduler.onTaskCompleted("A", TaskExecutionResult.SUCCESS))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("expected RUNNING state, but current state is READY");
    }

    @Test
    @DisplayName("7. State machine enforcement: state transitions are strictly validated")
    void testStateMachineEnforcement() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .build();

        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);
        // Initial state MUST be READY (via stateMachine transition from PENDING)
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.READY);

        scheduler.scheduleReadyTasks();
        // After execution, state MUST be SUCCESS
        assertThat(scheduler.getTaskState("A")).isEqualTo(TaskState.SUCCESS);
    }

    @Test
    @DisplayName("8. TaskExecutor receives exact task instance")
    void testTaskExecutorReceivesExpectedTask() {
        Task taskA = new Task("A", "Task Alpha");
        WorkflowDag dag = WorkflowDag.builder()
                .addTask(taskA)
                .build();

        Scheduler scheduler = new Scheduler(dag, dagEngine, stateMachine, testExecutor);
        scheduler.scheduleReadyTasks();

        assertThat(testExecutor.getExecutedTasks()).containsExactly(taskA);
    }
}
