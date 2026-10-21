package com.flowforge.scheduler;

import java.time.Duration;
import java.time.Instant;

/**
 * Listener interface for observing task execution lifecycle events in WorkflowScheduler.
 */
public interface TaskExecutionListener {

    /**
     * Called when a task execution attempt begins.
     *
     * @param taskId the task ID
     * @param attemptCount the 1-based attempt number that started
     * @param startedAt the timestamp when the attempt started
     */
    default void onTaskStarted(String taskId, int attemptCount, Instant startedAt) {}

    /**
     * Called when a task completes successfully.
     *
     * @param taskId the task ID
     * @param attemptCount the attempt number that succeeded
     * @param startedAt the timestamp when initial task execution started
     * @param completedAt the timestamp when the task completed
     * @param durationMs total duration in milliseconds
     */
    default void onTaskCompleted(String taskId, int attemptCount, Instant startedAt, Instant completedAt, Long durationMs) {}

    /**
     * Called when a task fails terminally (non-retryable or attempts exhausted).
     *
     * @param taskId the task ID
     * @param attemptCount total attempts made
     * @param startedAt the timestamp when initial task execution started
     * @param completedAt the timestamp when the task failed terminally
     * @param durationMs total duration in milliseconds
     * @param error the terminal failure exception
     */
    default void onTaskFailed(String taskId, int attemptCount, Instant startedAt, Instant completedAt, Long durationMs, Throwable error) {}

    /**
     * Called when a task attempt fails but will be retried after a backoff delay.
     *
     * @param taskId the task ID
     * @param attemptCount the attempt number that just failed
     * @param error the transient failure exception
     * @param nextDelay the computed delay before the next attempt
     */
    default void onTaskRetrying(String taskId, int attemptCount, Throwable error, Duration nextDelay) {}

    /**
     * Called when a task is cancelled before starting (e.g. prerequisite failure or workflow-level cancellation).
     *
     * @param taskId the task ID
     * @param completedAt the cancellation timestamp
     */
    default void onTaskCancelled(String taskId, Instant completedAt) {}
}
