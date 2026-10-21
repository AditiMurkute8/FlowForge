package com.flowforge.service;

import com.flowforge.domain.Project;
import com.flowforge.domain.Workflow;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Service managing Workflow definitions, project-scoped slug generation, uniqueness validation,
 * and project-scoped RBAC enforcement.
 */
@Service
@Transactional(readOnly = true)
public class WorkflowService {

    private final WorkflowRepository workflowRepository;
    private final ProjectRepository projectRepository;
    private final WorkflowVersionRepository workflowVersionRepository;
    private final ProjectAuthorizationService authorizationService;

    public WorkflowService(WorkflowRepository workflowRepository,
                           ProjectRepository projectRepository,
                           WorkflowVersionRepository workflowVersionRepository) {
        this(workflowRepository, projectRepository, workflowVersionRepository, null);
    }

    @Autowired
    public WorkflowService(
        WorkflowRepository workflowRepository,
        ProjectRepository projectRepository,
        WorkflowVersionRepository workflowVersionRepository,
        ProjectAuthorizationService authorizationService
    ) {
        this.workflowRepository = workflowRepository;
        this.projectRepository = projectRepository;
        this.workflowVersionRepository = workflowVersionRepository;
        this.authorizationService = authorizationService;
    }

    /**
     * Creates a new Workflow under a parent Project with a project-scoped unique slug.
     * Requires DEVELOPER or ADMIN role on the parent project.
     *
     * @param projectId parent Project UUID
     * @param name workflow display name
     * @param slug optional custom slug; if omitted or blank, auto-derived from name
     * @param description optional description
     * @return persisted Workflow entity
     * @throws ResourceNotFoundException if parent project does not exist
     * @throws IllegalArgumentException if name is blank or custom slug format is invalid
     * @throws ResourceConflictException if a workflow with the effective slug already exists in this project
     */
    @Transactional
    public Workflow createWorkflow(UUID projectId, String name, String slug, String description) {
        Objects.requireNonNull(projectId, "Project ID must not be null");
        if (authorizationService != null) {
            authorizationService.requireEditAccess(projectId);
        }

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + projectId));

        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Workflow name must not be blank");
        }

        String effectiveSlug;
        if (slug == null || slug.isBlank()) {
            effectiveSlug = SlugGenerator.generateSlug(name);
        } else {
            effectiveSlug = SlugGenerator.normalizeSlug(slug);
        }

        if (workflowRepository.existsByProjectIdAndSlug(projectId, effectiveSlug)) {
            throw new ResourceConflictException(
                    "A workflow with slug '" + effectiveSlug + "' already exists in this project");
        }

        Workflow workflow = new Workflow(project, name.trim(), effectiveSlug, description != null ? description.trim() : null);
        return workflowRepository.save(workflow);
    }

    public Workflow getWorkflowById(UUID id) {
        Objects.requireNonNull(id, "Workflow ID must not be null");
        Workflow workflow = workflowRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found: " + id));
        if (authorizationService != null) {
            authorizationService.requireReadAccess(workflow.getProject().getId());
        }
        return workflow;
    }

    public Workflow getWorkflowByProjectAndSlug(UUID projectId, String slug) {
        Objects.requireNonNull(projectId, "Project ID must not be null");
        Objects.requireNonNull(slug, "Slug must not be null");
        if (authorizationService != null) {
            authorizationService.requireReadAccess(projectId);
        }
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project not found: " + projectId);
        }
        return workflowRepository.findByProjectIdAndSlug(projectId, slug)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Workflow not found with slug '" + slug + "' in project " + projectId));
    }

    public Page<Workflow> listWorkflowsByProject(UUID projectId, Pageable pageable) {
        Objects.requireNonNull(projectId, "Project ID must not be null");
        if (authorizationService != null) {
            authorizationService.requireReadAccess(projectId);
        }
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project not found: " + projectId);
        }
        return workflowRepository.findByProjectId(projectId, pageable);
    }

    @Transactional
    public void deleteWorkflow(UUID id) {
        Objects.requireNonNull(id, "Workflow ID must not be null");
        Workflow workflow = workflowRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found: " + id));
        if (authorizationService != null) {
            authorizationService.requireEditAccess(workflow.getProject().getId());
        }
        if (workflowVersionRepository.countByWorkflowId(id) > 0) {
            throw new ResourceConflictException("Cannot delete workflow because dependent versions exist");
        }
        workflowRepository.delete(workflow);
    }
}
