package com.flowforge.service;

import com.flowforge.domain.Project;
import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Service managing Project lifecycles, slug generation, uniqueness validation,
 * and project-scoped RBAC enforcement.
 */
@Service
@Transactional(readOnly = true)
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final WorkflowRepository workflowRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectAuthorizationService authorizationService;

    public ProjectService(ProjectRepository projectRepository, WorkflowRepository workflowRepository) {
        this(projectRepository, workflowRepository, null, null);
    }

    @Autowired
    public ProjectService(
        ProjectRepository projectRepository,
        WorkflowRepository workflowRepository,
        ProjectMemberRepository projectMemberRepository,
        ProjectAuthorizationService authorizationService
    ) {
        this.projectRepository = projectRepository;
        this.workflowRepository = workflowRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.authorizationService = authorizationService;
    }

    /**
     * Creates a new Project with a unique slug and establishes the creator's initial ADMIN membership.
     *
     * @param name project display name
     * @param slug optional custom slug; if omitted or blank, auto-derived from name
     * @param description optional description
     * @return persisted Project entity
     * @throws IllegalArgumentException if name is blank or custom slug format is invalid
     * @throws ResourceConflictException if a project with the effective slug already exists
     */
    @Transactional
    public Project createProject(String name, String slug, String description) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Project name must not be blank");
        }

        String effectiveSlug;
        if (slug == null || slug.isBlank()) {
            effectiveSlug = SlugGenerator.generateSlug(name);
        } else {
            effectiveSlug = SlugGenerator.normalizeSlug(slug);
        }

        if (projectRepository.existsBySlug(effectiveSlug)) {
            throw new ResourceConflictException("A project with slug '" + effectiveSlug + "' already exists");
        }

        Project project = new Project(name.trim(), effectiveSlug, description != null ? description.trim() : null);
        Project savedProject = projectRepository.save(project);

        // Assign creator as initial ProjectRole.ADMIN when authenticated
        if (authorizationService != null && projectMemberRepository != null) {
            Optional<User> currentUserOpt = authorizationService.getCurrentUser();
            if (currentUserOpt.isPresent()) {
                ProjectMember adminMember = new ProjectMember(savedProject, currentUserOpt.get(), ProjectRole.ADMIN);
                projectMemberRepository.save(adminMember);
            }
        }

        return savedProject;
    }

    public Project getProjectById(UUID id) {
        Objects.requireNonNull(id, "Project ID must not be null");
        if (authorizationService != null) {
            authorizationService.requireReadAccess(id);
        }
        return projectRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + id));
    }

    public Project getProjectBySlug(String slug) {
        Objects.requireNonNull(slug, "Slug must not be null");
        Project project = projectRepository.findBySlug(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found with slug: " + slug));
        if (authorizationService != null) {
            authorizationService.requireReadAccess(project.getId());
        }
        return project;
    }

    public Page<Project> listProjects(Pageable pageable) {
        if (authorizationService != null && authorizationService.getCurrentUser().isPresent()) {
            UUID userId = authorizationService.getCurrentUser().get().getId();
            return projectRepository.findByMemberUserId(userId, pageable);
        }
        return projectRepository.findAll(pageable);
    }

    @Transactional
    public void deleteProject(UUID id) {
        Objects.requireNonNull(id, "Project ID must not be null");
        if (authorizationService != null) {
            authorizationService.requireAdminAccess(id);
        }
        Project project = projectRepository.findByIdWithPessimisticLock(id)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + id));
        if (workflowRepository.countByProjectId(id) > 0) {
            throw new ResourceConflictException("Cannot delete project because dependent workflows exist");
        }
        projectRepository.delete(project);
    }
}
