package com.flowforge.execution.scheduler;

import com.flowforge.dag.engine.DagEngine;
import com.flowforge.dag.model.Task;
import com.flowforge.dag.model.WorkflowDag;
import com.flowforge.execution.state.TaskState;
import com.flowforge.execution.state.TaskStateMachine;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Phase-1 single-node in-memory workflow scheduler for FlowForge.
 * Coordinates task execution, enforces state transitions via TaskStateMachine,
 * and handles dependency unlocking via DagEngine upon task completion.
 */
public class Scheduler {

    private final WorkflowDag dag;
    private final DagEngine dagEngine;
    private final TaskStateMachine stateMachine;
    private final TaskExecutor executor;
    private final Map<String, TaskState> taskStates;

    public Scheduler(WorkflowDag dag, DagEngine dagEngine, TaskStateMachine stateMachine, TaskExecutor executor) {
        if (dag == null) {
            throw new IllegalArgumentException("WorkflowDag must not be null.");
        }
        if (dagEngine == null) {
            throw new IllegalArgumentException("DagEngine must not be null.");
        }
        if (stateMachine == null) {
            throw new IllegalArgumentException("TaskStateMachine must not be null.");
        }
        if (executor == null) {
            throw new IllegalArgumentException("TaskExecutor must not be null.");
        }

        // Validate that the graph is acyclic before scheduling
        dagEngine.validate(dag);

        this.dag = dag;
        this.dagEngine = dagEngine;
        this.stateMachine = stateMachine;
        this.executor = executor;
        this.taskStates = new LinkedHashMap<>();

        // Initialize state for all tasks
        for (String taskId : dag.getTasks().keySet()) {
            taskStates.put(taskId, TaskState.PENDING);
        }

        // Transition 0-indegree tasks from PENDING -> READY via TaskStateMachine
        Set<Task> initialReadyTasks = dag.getInitialReadyTasks();
        for (Task task : initialReadyTasks) {
            TaskState readyState = stateMachine.transition(TaskState.PENDING, TaskState.READY);
            taskStates.put(task.getId(), readyState);
        }
    }

    /**
     * Finds all tasks currently in READY state, transitions them READY -> RUNNING using TaskStateMachine,
     * and dispatches them to TaskExecutor.
     */
    public void scheduleReadyTasks() {
        // Collect snapshot of READY tasks to avoid concurrent modification during iteration
        List<Task> readyTasks = new ArrayList<>();
        for (Map.Entry<String, TaskState> entry : taskStates.entrySet()) {
            if (entry.getValue() == TaskState.READY) {
                readyTasks.add(dag.getTask(entry.getKey()));
            }
        }

        for (Task task : readyTasks) {
            String taskId = task.getId();
            TaskState currentState = taskStates.get(taskId);

            // Enforce state machine transition READY -> RUNNING
            TaskState runningState = stateMachine.transition(currentState, TaskState.RUNNING);
            taskStates.put(taskId, runningState);

            // Dispatch task to executor
            TaskExecutionResult result = executor.execute(task);
            if (result != null) {
                onTaskCompleted(taskId, result);
            }
        }
    }

    /**
     * Handles completion of a task execution attempt.
     *
     * @param taskId the ID of the completed task
     * @param result the execution outcome (SUCCESS or FAILURE)
     * @throws IllegalStateException if the task is not currently in RUNNING state
     */
    public void onTaskCompleted(String taskId, TaskExecutionResult result) {
        if (taskId == null || !dag.hasTask(taskId)) {
            throw new IllegalArgumentException("Task ID not found in DAG: " + taskId);
        }
        if (result == null) {
            throw new IllegalArgumentException("TaskExecutionResult must not be null.");
        }

        TaskState currentState = taskStates.get(taskId);
        if (currentState != TaskState.RUNNING) {
            throw new IllegalStateException(
                    String.format("Cannot complete task '%s': expected RUNNING state, but current state is %s",
                            taskId, currentState));
        }

        if (result == TaskExecutionResult.SUCCESS) {
            // Transition RUNNING -> SUCCESS
            TaskState successState = stateMachine.transition(currentState, TaskState.SUCCESS);
            taskStates.put(taskId, successState);

            // Perform dependency unlocking for dependent tasks
            unlockDependents(taskId);
        } else if (result == TaskExecutionResult.FAILURE) {
            // Transition RUNNING -> FAILED
            TaskState failedState = stateMachine.transition(currentState, TaskState.FAILED);
            taskStates.put(taskId, failedState);
        }
    }

    /**
     * Inspects outgoing dependent tasks and unlocks any whose prerequisites are now completely SUCCESS.
     */
    private void unlockDependents(String completedTaskId) {
        Set<String> completedTaskIds = getCompletedTaskIds();
        Set<String> outgoingNeighbors = dag.getOutgoingNeighbors(completedTaskId);

        for (String dependentId : outgoingNeighbors) {
            TaskState currentState = taskStates.get(dependentId);
            if (currentState == TaskState.PENDING) {
                // Use DagEngine to check if all prerequisites are satisfied
                if (dagEngine.isTaskReady(dag, dependentId, completedTaskIds)) {
                    TaskState readyState = stateMachine.transition(TaskState.PENDING, TaskState.READY);
                    taskStates.put(dependentId, readyState);
                }
            }
        }
    }

    private Set<String> getCompletedTaskIds() {
        return taskStates.entrySet().stream()
                .filter(e -> e.getValue() == TaskState.SUCCESS)
                .map(Map.Entry::getKey)
                .collect(Collectors.toSet());
    }

    public TaskState getTaskState(String taskId) {
        if (!dag.hasTask(taskId)) {
            throw new IllegalArgumentException("Task ID not found in DAG: " + taskId);
        }
        return taskStates.get(taskId);
    }

    public Map<String, TaskState> getTaskStates() {
        return Collections.unmodifiableMap(taskStates);
    }

    public boolean isWorkflowComplete() {
        return taskStates.values().stream()
                .allMatch(state -> state == TaskState.SUCCESS ||
                                   state == TaskState.FAILED ||
                                   state == TaskState.DEAD_LETTER ||
                                   state == TaskState.CANCELLED);
    }

    public boolean isWorkflowSuccessful() {
        return taskStates.values().stream()
                .allMatch(state -> state == TaskState.SUCCESS);
    }
}
