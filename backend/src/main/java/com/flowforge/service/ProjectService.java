package com.flowforge.service;

import com.flowforge.domain.Project;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Service managing Project lifecycles, slug generation, and uniqueness validation.
 */
@Service
@Transactional(readOnly = true)
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final WorkflowRepository workflowRepository;

    public ProjectService(ProjectRepository projectRepository, WorkflowRepository workflowRepository) {
        this.projectRepository = projectRepository;
        this.workflowRepository = workflowRepository;
    }

    /**
     * Creates a new Project with a unique slug.
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
        return projectRepository.save(project);
    }

    public Project getProjectById(UUID id) {
        Objects.requireNonNull(id, "Project ID must not be null");
        return projectRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + id));
    }

    public Project getProjectBySlug(String slug) {
        Objects.requireNonNull(slug, "Slug must not be null");
        return projectRepository.findBySlug(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found with slug: " + slug));
    }

    public Page<Project> listProjects(Pageable pageable) {
        return projectRepository.findAll(pageable);
    }

    @Transactional
    public void deleteProject(UUID id) {
        Objects.requireNonNull(id, "Project ID must not be null");
        Project project = getProjectById(id);
        if (workflowRepository.countByProjectId(id) > 0) {
            throw new ResourceConflictException("Cannot delete project because dependent workflows exist");
        }
        projectRepository.delete(project);
    }
}
