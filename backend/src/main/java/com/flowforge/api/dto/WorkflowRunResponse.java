package com.flowforge.api.dto;

import com.flowforge.domain.WorkflowRun;
import com.flowforge.scheduler.WorkflowRunState;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Detailed API response representing a workflow run, including individual task run executions.
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
 * @param tasks list of task execution records for this run
 */
public record WorkflowRunResponse(
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
    List<TaskRunResponse> tasks
) {
    public WorkflowRunResponse {
        tasks = tasks != null ? List.copyOf(tasks) : List.of();
    }

    public static WorkflowRunResponse fromEntity(WorkflowRun run, List<TaskRunResponse> tasks) {
        if (run == null) {
            return null;
        }
        UUID workflowId = null;
        UUID workflowVersionId = null;
        Integer versionNumber = null;
        if (run.getWorkflowVersion() != null) {
            workflowVersionId = run.getWorkflowVersion().getId();
            versionNumber = run.getWorkflowVersion().getVersionNumber();
            if (run.getWorkflowVersion().getWorkflow() != null) {
                workflowId = run.getWorkflowVersion().getWorkflow().getId();
            }
        }
        return new WorkflowRunResponse(
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
            tasks
        );
    }

    public static WorkflowRunResponse fromEntity(WorkflowRun run) {
        if (run == null) {
            return null;
        }
        List<TaskRunResponse> taskResponses = run.getTaskRuns() != null
            ? run.getTaskRuns().stream().map(TaskRunResponse::fromEntity).toList()
            : List.of();
        return fromEntity(run, taskResponses);
    }
}
