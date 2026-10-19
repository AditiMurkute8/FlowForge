package com.flowforge.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.flowforge.domain.Workflow;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Service managing immutable WorkflowVersion creation, pessimistic row locking,
 * version number allocation, and snapshot retrieval.
 */
@Service
@Transactional(readOnly = true)
public class WorkflowVersionService {

    private final WorkflowRepository workflowRepository;
    private final WorkflowVersionRepository workflowVersionRepository;
    private final WorkflowSnapshotConverter snapshotConverter;

    public WorkflowVersionService(WorkflowRepository workflowRepository,
                                  WorkflowVersionRepository workflowVersionRepository,
                                  WorkflowSnapshotConverter snapshotConverter) {
        this.workflowRepository = workflowRepository;
        this.workflowVersionRepository = workflowVersionRepository;
        this.snapshotConverter = snapshotConverter;
    }

    /**
     * Creates an immutable WorkflowVersion snapshot.
     * Uses pessimistic write locking on the parent Workflow row to serialize version allocation.
     * Derives taskCount, edgeCount, and isValidDag on the server.
     *
     * @param workflowId parent workflow UUID
     * @param versionName optional human-readable version label (e.g. "v1.0.0"); defaults to "v{number}" if omitted
     * @param description optional changelog or snapshot notes
     * @param rawPayload client graph payload (React Flow canvas structure or legacy tasks)
     * @return persisted immutable WorkflowVersion
     * @throws ResourceNotFoundException if workflowId does not exist
     * @throws IllegalArgumentException if the graph payload is structurally malformed
     */
    @Transactional
    public WorkflowVersion createVersion(UUID workflowId, String versionTag, String description, JsonNode rawPayload) {
        Objects.requireNonNull(workflowId, "Workflow ID must not be null");

        // 1. Lock the parent workflow row before allocating MAX(version_number) + 1
        Workflow workflow = workflowRepository.findByIdForUpdate(workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found: " + workflowId));

        // 2. Validate snapshot structure, strip transient telemetry, and derive TaskGraph / DagValidationResult
        WorkflowSnapshot snapshot = snapshotConverter.convertAndValidate(rawPayload);

        // 3. Allocate next version number under pessimistic lock
        int nextVersionNumber = workflowVersionRepository.findMaxVersionNumber(workflowId)
                .map(v -> v + 1)
                .orElse(1);

        String effectiveVersionTag = (versionTag != null && !versionTag.isBlank())
                ? versionTag.trim()
                : "v" + nextVersionNumber;

        // 4. Construct and save immutable version record
        WorkflowVersion version = new WorkflowVersion(
                workflow,
                nextVersionNumber,
                effectiveVersionTag,
                description != null ? description.trim() : null,
                snapshot.cleanedPayload(),
                snapshot.taskCount(),
                snapshot.edgeCount(),
                snapshot.isValidDag()
        );

        return workflowVersionRepository.save(version);
    }

    /**
     * Converts and validates a graph payload without persisting a version snapshot.
     *
     * @param rawPayload raw JSON payload
     * @return validated snapshot with server-derived metrics and DagValidationResult
     */
    public WorkflowSnapshot validateSnapshot(JsonNode rawPayload) {
        return snapshotConverter.convertAndValidate(rawPayload);
    }

    public WorkflowVersion getLatestVersion(UUID workflowId) {
        Objects.requireNonNull(workflowId, "Workflow ID must not be null");
        if (!workflowRepository.existsById(workflowId)) {
            throw new ResourceNotFoundException("Workflow not found: " + workflowId);
        }
        return workflowVersionRepository.findFirstByWorkflowIdOrderByVersionNumberDesc(workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow has no saved versions"));
    }

    public WorkflowVersion getVersionByNumber(UUID workflowId, int versionNumber) {
        Objects.requireNonNull(workflowId, "Workflow ID must not be null");
        if (!workflowRepository.existsById(workflowId)) {
            throw new ResourceNotFoundException("Workflow not found: " + workflowId);
        }
        return workflowVersionRepository.findByWorkflowIdAndVersionNumber(workflowId, versionNumber)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Workflow version " + versionNumber + " not found for workflow " + workflowId));
    }

    public Page<WorkflowVersion> listVersions(UUID workflowId, Pageable pageable) {
        Objects.requireNonNull(workflowId, "Workflow ID must not be null");
        if (!workflowRepository.existsById(workflowId)) {
            throw new ResourceNotFoundException("Workflow not found: " + workflowId);
        }
        return workflowVersionRepository.findByWorkflowIdOrderByVersionNumberDesc(workflowId, pageable);
    }
}
