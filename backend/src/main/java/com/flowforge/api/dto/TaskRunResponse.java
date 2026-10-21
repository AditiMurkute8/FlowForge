package com.flowforge.api.dto;

import com.flowforge.domain.TaskRun;
import com.flowforge.scheduler.TaskState;

import java.time.Instant;
import java.util.UUID;

/**
 * API response representing the execution status and metrics of a single task within a workflow run.
 *
 * @param id unique task run identifier
 * @param taskId identifier of the task definition in the workflow graph
 * @param status current lifecycle status of the task
 * @param attemptCount total execution attempts performed (1..N)
 * @param startedAt timestamp when task execution started
 * @param completedAt timestamp when task execution completed or terminated
 * @param durationMs duration in milliseconds
 * @param errorMessage error message if task failed or was cancelled with an error
 * @param createdAt timestamp when the task run record was created
 */
public record TaskRunResponse(
    UUID id,
    String taskId,
    TaskState status,
    Integer attemptCount,
    Instant startedAt,
    Instant completedAt,
    Long durationMs,
    String errorMessage,
    Instant createdAt
) {
    public static TaskRunResponse fromEntity(TaskRun taskRun) {
        if (taskRun == null) {
            return null;
        }
        return new TaskRunResponse(
            taskRun.getId(),
            taskRun.getTaskId(),
            taskRun.getStatus(),
            taskRun.getAttemptCount(),
            taskRun.getStartedAt(),
            taskRun.getCompletedAt(),
            taskRun.getDurationMs(),
            taskRun.getErrorMessage(),
            taskRun.getCreatedAt()
        );
    }
}
