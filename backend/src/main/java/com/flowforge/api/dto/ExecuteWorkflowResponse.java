package com.flowforge.api.dto;

import com.flowforge.scheduler.WorkflowRunState;

import java.time.Instant;
import java.util.Map;

/**
 * Result payload representing the overall execution outcome of a workflow run.
 *
 * @param state final workflow state (COMPLETED or FAILED)
 * @param startedAt timestamp when workflow execution started
 * @param completedAt timestamp when workflow reached its terminal state
 * @param durationMs duration in milliseconds of the entire workflow run
 * @param taskResults map of task ID to individual sanitized task execution results
 */
public record ExecuteWorkflowResponse(
    WorkflowRunState state,
    Instant startedAt,
    Instant completedAt,
    Long durationMs,
    Map<String, TaskExecutionResponseDto> taskResults
) {
}
