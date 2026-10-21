package com.flowforge.persistence.repository;

import com.flowforge.domain.WorkflowVersion;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for immutable WorkflowVersion entities.
 * Version deletion operations are explicitly rejected at both repository and database trigger levels.
 */
@Repository
public interface WorkflowVersionRepository extends JpaRepository<WorkflowVersion, UUID> {

    Page<WorkflowVersion> findByWorkflowIdOrderByVersionNumberDesc(UUID workflowId, Pageable pageable);

    Optional<WorkflowVersion> findByWorkflowIdAndVersionNumber(UUID workflowId, Integer versionNumber);

    Optional<WorkflowVersion> findFirstByWorkflowIdOrderByVersionNumberDesc(UUID workflowId);

    @Query("SELECT MAX(v.versionNumber) FROM WorkflowVersion v WHERE v.workflow.id = :workflowId")
    Optional<Integer> findMaxVersionNumber(@Param("workflowId") UUID workflowId);

    long countByWorkflowId(UUID workflowId);

    @Override
    default void delete(WorkflowVersion entity) {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteById(UUID id) {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteAll() {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteAll(Iterable<? extends WorkflowVersion> entities) {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteAllById(Iterable<? extends UUID> ids) {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteAllInBatch() {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteAllByIdInBatch(Iterable<UUID> ids) {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }

    @Override
    default void deleteInBatch(Iterable<WorkflowVersion> entities) {
        throw new UnsupportedOperationException("Workflow versions are immutable and cannot be deleted");
    }
}
