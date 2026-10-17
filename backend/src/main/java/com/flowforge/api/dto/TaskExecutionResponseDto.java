package com.flowforge.api.dto;

import com.flowforge.scheduler.TaskState;

import java.time.Instant;
import java.util.List;

/**
 * Sanitized execution outcome and timing for a single task.
 *
 * @param taskId the task ID
 * @param state final execution state (COMPLETED, FAILED, CANCELLED)
 * @param startedAt timestamp when task execution started (null if cancelled before start)
 * @param completedAt timestamp when task reached its final state
 * @param durationMs duration in milliseconds between start and completion (null if not started)
 * @param attemptCount total execution attempts that were initiated
 * @param errorMessage sanitized terminal error message (null if successful or cancelled)
 * @param attemptErrors sanitized chronological list of errors captured across all attempts
 */
public record TaskExecutionResponseDto(
    String taskId,
    TaskState state,
    Instant startedAt,
    Instant completedAt,
    Long durationMs,
    int attemptCount,
    String errorMessage,
    List<String> attemptErrors
) {
}
