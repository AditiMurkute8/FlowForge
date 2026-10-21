package com.flowforge.persistence.repository;

import com.flowforge.domain.Project;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for Project entities.
 */
@Repository
public interface ProjectRepository extends JpaRepository<Project, UUID> {

    Optional<Project> findBySlug(String slug);

    boolean existsBySlug(String slug);

    Page<Project> findAll(Pageable pageable);

    @Query(
        value = "SELECT pm.project FROM ProjectMember pm WHERE pm.user.id = :userId ORDER BY pm.project.createdAt DESC",
        countQuery = "SELECT count(pm) FROM ProjectMember pm WHERE pm.user.id = :userId"
    )
    Page<Project> findByMemberUserId(@Param("userId") UUID userId, Pageable pageable);

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Project p WHERE p.id = :id")
    Optional<Project> findByIdWithPessimisticLock(@Param("id") UUID id);
}
