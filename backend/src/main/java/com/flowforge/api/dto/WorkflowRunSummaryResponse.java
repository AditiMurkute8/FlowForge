package com.flowforge.api.dto;

import com.flowforge.domain.WorkflowRun;
import com.flowforge.scheduler.WorkflowRunState;

import java.time.Instant;
import java.util.UUID;

/**
 * Summary API response representing a workflow run item in paginated list views.
 * Excludes individual task run details to prevent N+1 query overhead and bloated payloads.
 *
 * @param id unique workflow run identifier
 * @param workflowId parent workflow identifier
 * @param workflowVersionId immutable workflow version snapshot identifier
 * @param versionNumber sequential version number (1..N)
 * @param status current lifecycle status of the workflow run
 * @param startedAt timestamp when execution started
 * @param completedAt timestamp when execution completed or reached terminal state
 * @param durationMs duration in milliseconds
 * @param triggeredBy trigger source identifier
 * @param createdAt timestamp when the workflow run record was created
 * @param taskCount total number of tasks defined in this workflow version
 */
public record WorkflowRunSummaryResponse(
    UUID id,
    UUID workflowId,
    UUID workflowVersionId,
    Integer versionNumber,
    WorkflowRunState status,
    Instant startedAt,
    Instant completedAt,
    Long durationMs,
    String triggeredBy,
    Instant createdAt,
    Integer taskCount
) {
    public static WorkflowRunSummaryResponse fromEntity(WorkflowRun run) {
        if (run == null) {
            return null;
        }
        UUID workflowId = null;
        UUID workflowVersionId = null;
        Integer versionNumber = null;
        Integer taskCount = null;
        if (run.getWorkflowVersion() != null) {
            workflowVersionId = run.getWorkflowVersion().getId();
            versionNumber = run.getWorkflowVersion().getVersionNumber();
            taskCount = run.getWorkflowVersion().getTaskCount();
            if (run.getWorkflowVersion().getWorkflow() != null) {
                workflowId = run.getWorkflowVersion().getWorkflow().getId();
            }
        }
        return new WorkflowRunSummaryResponse(
            run.getId(),
            workflowId,
            workflowVersionId,
            versionNumber,
            run.getStatus(),
            run.getStartedAt(),
            run.getCompletedAt(),
            run.getDurationMs(),
            run.getTriggeredBy(),
            run.getCreatedAt(),
            taskCount
        );
    }
}
