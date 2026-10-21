package com.flowforge.api;

import com.flowforge.api.dto.CreateProjectRequest;
import com.flowforge.api.dto.ProjectResponse;
import com.flowforge.domain.Project;
import com.flowforge.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for managing Project lifecycles, slug queries, and pagination.
 */
@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {

    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    @PostMapping
    public ResponseEntity<ProjectResponse> createProject(@Valid @RequestBody CreateProjectRequest request) {
        Project project = projectService.createProject(request.name(), request.slug(), request.description());
        return ResponseEntity.status(HttpStatus.CREATED).body(ProjectResponse.fromEntity(project));
    }

    @GetMapping
    public ResponseEntity<Page<ProjectResponse>> listProjects(@PageableDefault(size = 20) Pageable pageable) {
        Page<Project> page = projectService.listProjects(pageable);
        return ResponseEntity.ok(page.map(ProjectResponse::fromEntity));
    }

    @GetMapping("/{projectId}")
    public ResponseEntity<ProjectResponse> getProjectById(@PathVariable UUID projectId) {
        Project project = projectService.getProjectById(projectId);
        return ResponseEntity.ok(ProjectResponse.fromEntity(project));
    }

    @GetMapping("/slug/{slug}")
    public ResponseEntity<ProjectResponse> getProjectBySlug(@PathVariable String slug) {
        Project project = projectService.getProjectBySlug(slug);
        return ResponseEntity.ok(ProjectResponse.fromEntity(project));
    }

    @DeleteMapping("/{projectId}")
    public ResponseEntity<Void> deleteProject(@PathVariable UUID projectId) {
        projectService.deleteProject(projectId);
        return ResponseEntity.noContent().build();
    }
}
