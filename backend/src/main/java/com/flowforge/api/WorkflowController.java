package com.flowforge.api;

import com.flowforge.api.dto.CreateWorkflowRequest;
import com.flowforge.api.dto.WorkflowResponse;
import com.flowforge.domain.Workflow;
import com.flowforge.service.WorkflowService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for managing Workflow definitions, project-scoped queries, and pagination.
 */
@RestController
public class WorkflowController {

    private final WorkflowService workflowService;

    public WorkflowController(WorkflowService workflowService) {
        this.workflowService = workflowService;
    }

    @PostMapping("/api/v1/projects/{projectId}/workflows")
    public ResponseEntity<WorkflowResponse> createWorkflow(
            @PathVariable UUID projectId,
            @Valid @RequestBody CreateWorkflowRequest request
    ) {
        Workflow workflow = workflowService.createWorkflow(projectId, request.name(), request.slug(), request.description());
        return ResponseEntity.status(HttpStatus.CREATED).body(WorkflowResponse.fromEntity(workflow));
    }

    @GetMapping("/api/v1/projects/{projectId}/workflows")
    public ResponseEntity<Page<WorkflowResponse>> listWorkflowsByProject(
            @PathVariable UUID projectId,
            @PageableDefault(size = 20) Pageable pageable
    ) {
        Page<Workflow> page = workflowService.listWorkflowsByProject(projectId, pageable);
        return ResponseEntity.ok(page.map(WorkflowResponse::fromEntity));
    }

    @GetMapping("/api/v1/workflows/{workflowId}")
    public ResponseEntity<WorkflowResponse> getWorkflowById(@PathVariable UUID workflowId) {
        Workflow workflow = workflowService.getWorkflowById(workflowId);
        return ResponseEntity.ok(WorkflowResponse.fromEntity(workflow));
    }

    @GetMapping("/api/v1/projects/{projectId}/workflows/slug/{workflowSlug}")
    public ResponseEntity<WorkflowResponse> getWorkflowByProjectAndSlug(
            @PathVariable UUID projectId,
            @PathVariable String workflowSlug
    ) {
        Workflow workflow = workflowService.getWorkflowByProjectAndSlug(projectId, workflowSlug);
        return ResponseEntity.ok(WorkflowResponse.fromEntity(workflow));
    }

    @DeleteMapping("/api/v1/workflows/{workflowId}")
    public ResponseEntity<Void> deleteWorkflow(@PathVariable UUID workflowId) {
        workflowService.deleteWorkflow(workflowId);
        return ResponseEntity.noContent().build();
    }
}
