package com.flowforge.persistence.repository;

import com.flowforge.domain.Workflow;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for Workflow entities.
 * Includes pessimistic locking query to serialize version allocation per workflow.
 */
@Repository
public interface WorkflowRepository extends JpaRepository<Workflow, UUID> {

    Optional<Workflow> findByProjectIdAndSlug(UUID projectId, String slug);

    boolean existsByProjectIdAndSlug(UUID projectId, String slug);

    Page<Workflow> findByProjectId(UUID projectId, Pageable pageable);

    long countByProjectId(UUID projectId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM Workflow w WHERE w.id = :id")
    Optional<Workflow> findByIdForUpdate(@Param("id") UUID id);
}
