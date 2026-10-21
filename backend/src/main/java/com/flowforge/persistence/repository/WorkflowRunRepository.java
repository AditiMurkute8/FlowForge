package com.flowforge.persistence.repository;

import com.flowforge.domain.WorkflowRun;
import com.flowforge.scheduler.WorkflowRunState;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA repository for WorkflowRun entities.
 */
@Repository
public interface WorkflowRunRepository extends JpaRepository<WorkflowRun, UUID> {

    @Query("SELECT wr FROM WorkflowRun wr JOIN FETCH wr.workflowVersion wv JOIN FETCH wv.workflow w WHERE wr.id = :runId")
    Optional<WorkflowRun> findByIdWithDetails(@Param("runId") UUID runId);

    @Query(
        value = "SELECT wr FROM WorkflowRun wr JOIN FETCH wr.workflowVersion wv JOIN FETCH wv.workflow w WHERE w.id = :workflowId ORDER BY wr.createdAt DESC, wr.id DESC",
        countQuery = "SELECT count(wr) FROM WorkflowRun wr JOIN wr.workflowVersion wv WHERE wv.workflow.id = :workflowId"
    )
    Page<WorkflowRun> findByWorkflowIdOrderByCreatedAtDesc(@Param("workflowId") UUID workflowId, Pageable pageable);

    @Query("SELECT count(wr) FROM WorkflowRun wr JOIN wr.workflowVersion wv WHERE wv.workflow.id = :workflowId")
    long countByWorkflowId(@Param("workflowId") UUID workflowId);

    Page<WorkflowRun> findByWorkflowVersionIdOrderByCreatedAtDesc(UUID workflowVersionId, Pageable pageable);

    List<WorkflowRun> findByWorkflowVersionId(UUID workflowVersionId);

    long countByWorkflowVersionId(UUID workflowVersionId);

    List<WorkflowRun> findByStatus(WorkflowRunState status);
}
