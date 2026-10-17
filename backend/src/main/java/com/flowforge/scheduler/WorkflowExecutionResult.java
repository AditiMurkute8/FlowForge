package com.flowforge.scheduler;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;

/**
 * Immutable record capturing the overall execution result of a workflow run.
 *
 * @param state the final state of the workflow run
 * @param taskResults map of task ID to individual task execution results
 * @param startedAt the timestamp when the workflow run started
 * @param completedAt the timestamp when the workflow run completed
 */
public record WorkflowExecutionResult(
    WorkflowRunState state,
    Map<String, TaskExecutionResult> taskResults,
    Instant startedAt,
    Instant completedAt
) {

    public WorkflowExecutionResult {
        Objects.requireNonNull(state, "state must not be null");
        Objects.requireNonNull(taskResults, "taskResults must not be null");
        Objects.requireNonNull(startedAt, "startedAt must not be null");
        Objects.requireNonNull(completedAt, "completedAt must not be null");
        taskResults = Map.copyOf(taskResults);
    }

    public boolean isSuccessful() {
        return state == WorkflowRunState.COMPLETED;
    }
}
