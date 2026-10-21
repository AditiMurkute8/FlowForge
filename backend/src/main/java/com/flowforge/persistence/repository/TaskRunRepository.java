package com.flowforge.persistence.repository;

import com.flowforge.domain.TaskRun;
import com.flowforge.scheduler.TaskState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA repository for TaskRun entities.
 */
@Repository
public interface TaskRunRepository extends JpaRepository<TaskRun, UUID> {

    List<TaskRun> findByWorkflowRunId(UUID workflowRunId);

    List<TaskRun> findByWorkflowRunIdOrderByCreatedAtAscIdAsc(UUID workflowRunId);

    Optional<TaskRun> findByWorkflowRunIdAndTaskId(UUID workflowRunId, String taskId);

    long countByWorkflowRunId(UUID workflowRunId);

    List<TaskRun> findByWorkflowRunIdAndStatus(UUID workflowRunId, TaskState status);

    @Modifying(clearAutomatically = true)
    @Query("UPDATE TaskRun tr SET tr.status = :status, " +
           "tr.attemptCount = COALESCE(:attemptCount, tr.attemptCount), " +
           "tr.startedAt = COALESCE(tr.startedAt, :startedAt), " +
           "tr.completedAt = COALESCE(:completedAt, tr.completedAt), " +
           "tr.durationMs = COALESCE(:durationMs, tr.durationMs), " +
           "tr.errorMessage = :errorMessage " +
           "WHERE tr.workflowRun.id = :runId AND tr.taskId = :taskId " +
           "AND tr.status NOT IN (com.flowforge.scheduler.TaskState.COMPLETED, com.flowforge.scheduler.TaskState.FAILED, com.flowforge.scheduler.TaskState.CANCELLED) " +
           "AND tr.workflowRun.id IN (SELECT wr.id FROM WorkflowRun wr WHERE wr.id = :runId AND wr.status NOT IN (com.flowforge.scheduler.WorkflowRunState.COMPLETED, com.flowforge.scheduler.WorkflowRunState.FAILED, com.flowforge.scheduler.WorkflowRunState.CANCELLED))")
    int updateTaskRunIfNonTerminal(
        @Param("runId") UUID runId,
        @Param("taskId") String taskId,
        @Param("status") TaskState status,
        @Param("attemptCount") Integer attemptCount,
        @Param("startedAt") Instant startedAt,
        @Param("completedAt") Instant completedAt,
        @Param("durationMs") Long durationMs,
        @Param("errorMessage") String errorMessage
    );
}
