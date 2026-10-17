package com.flowforge.scheduler;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * Immutable record capturing the execution result of an individual task.
 *
 * @param taskId the task ID
 * @param state the final execution state of the task
 * @param error the exception thrown during execution, or null if successful/cancelled
 * @param startedAt the timestamp when task execution started, or null if cancelled before starting
 * @param completedAt the timestamp when task reached its final state
 */
public record TaskExecutionResult(
    String taskId,
    TaskState state,
    Throwable error,
    Instant startedAt,
    Instant completedAt
) {

    public TaskExecutionResult {
        Objects.requireNonNull(taskId, "taskId must not be null");
        Objects.requireNonNull(state, "state must not be null");
    }

    public Optional<Throwable> getError() {
        return Optional.ofNullable(error);
    }

    public Optional<Instant> getStartedAt() {
        return Optional.ofNullable(startedAt);
    }

    public Optional<Instant> getCompletedAt() {
        return Optional.ofNullable(completedAt);
    }

    public boolean isSuccess() {
        return state == TaskState.COMPLETED;
    }
}
