package com.flowforge.api;

import com.flowforge.api.dto.CreateWorkflowVersionRequest;
import com.flowforge.api.dto.WorkflowVersionResponse;
import com.flowforge.api.dto.WorkflowVersionSummaryResponse;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.service.WorkflowVersionService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for creating immutable WorkflowVersion snapshots and querying version history.
 */
@RestController
@RequestMapping("/api/v1/workflows/{workflowId}/versions")
public class WorkflowVersionController {

    private final WorkflowVersionService workflowVersionService;

    public WorkflowVersionController(WorkflowVersionService workflowVersionService) {
        this.workflowVersionService = workflowVersionService;
    }

    @PostMapping
    public ResponseEntity<WorkflowVersionResponse> createVersion(
            @PathVariable UUID workflowId,
            @Valid @RequestBody CreateWorkflowVersionRequest request
    ) {
        WorkflowVersion version = workflowVersionService.createVersion(
                workflowId,
                request.versionTag(),
                request.description(),
                request.graphPayload()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(WorkflowVersionResponse.fromEntity(version));
    }

    @GetMapping
    public ResponseEntity<Page<WorkflowVersionSummaryResponse>> listVersions(
            @PathVariable UUID workflowId,
            @PageableDefault(size = 20) Pageable pageable
    ) {
        Page<WorkflowVersion> page = workflowVersionService.listVersions(workflowId, pageable);
        return ResponseEntity.ok(page.map(WorkflowVersionSummaryResponse::fromEntity));
    }

    @GetMapping("/latest")
    public ResponseEntity<WorkflowVersionResponse> getLatestVersion(@PathVariable UUID workflowId) {
        WorkflowVersion version = workflowVersionService.getLatestVersion(workflowId);
        return ResponseEntity.ok(WorkflowVersionResponse.fromEntity(version));
    }

    @GetMapping("/{versionNumber}")
    public ResponseEntity<WorkflowVersionResponse> getVersionByNumber(
            @PathVariable UUID workflowId,
            @PathVariable int versionNumber
    ) {
        WorkflowVersion version = workflowVersionService.getVersionByNumber(workflowId, versionNumber);
        return ResponseEntity.ok(WorkflowVersionResponse.fromEntity(version));
    }
}
