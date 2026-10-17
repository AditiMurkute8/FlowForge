package com.flowforge.scheduler;

import java.time.Instant;
import java.util.List;
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
 * @param attemptCount the total number of execution attempts that actually began
 * @param attemptErrors chronological list of exceptions captured across all attempts
 */
public record TaskExecutionResult(
    String taskId,
    TaskState state,
    Throwable error,
    Instant startedAt,
    Instant completedAt,
    int attemptCount,
    List<Throwable> attemptErrors
) {

    public TaskExecutionResult {
        Objects.requireNonNull(taskId, "taskId must not be null");
        Objects.requireNonNull(state, "state must not be null");
        if (attemptCount < 0) {
            throw new IllegalArgumentException("attemptCount must not be negative: " + attemptCount);
        }
        attemptErrors = attemptErrors == null ? List.of() : List.copyOf(attemptErrors);
    }

    /**
     * Backward-compatible 5-argument constructor assuming 1 attempt (or 0 if cancelled).
     */
    public TaskExecutionResult(
        String taskId,
        TaskState state,
        Throwable error,
        Instant startedAt,
        Instant completedAt
    ) {
        this(
            taskId,
            state,
            error,
            startedAt,
            completedAt,
            state == TaskState.CANCELLED ? 0 : 1,
            error != null ? List.of(error) : List.of()
        );
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

    public int getAttemptCount() {
        return attemptCount;
    }

    public List<Throwable> getAttemptErrors() {
        return attemptErrors;
    }

    public boolean isSuccess() {
        return state == TaskState.COMPLETED;
    }
}
