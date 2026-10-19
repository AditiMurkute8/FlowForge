package com.flowforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.flowforge.domain.WorkflowVersion;

import java.time.Instant;
import java.util.UUID;

/**
 * Detailed API response representing an immutable WorkflowVersion snapshot, including graph payload.
 *
 * @param id unique version identifier
 * @param workflowId parent workflow identifier
 * @param versionNumber sequential version number (1..N)
 * @param versionTag human-readable version label (e.g. "v1", "v1.0.0")
 * @param description optional changelog or snapshot notes
 * @param graphPayload cleaned, canonical React Flow graph JSON payload
 * @param taskCount server-derived total task count
 * @param edgeCount server-derived total dependency edge count
 * @param isValidDag server-derived DAG validity flag
 * @param createdAt creation timestamp
 */
public record WorkflowVersionResponse(
        UUID id,
        UUID workflowId,
        Integer versionNumber,
        String versionTag,
        String description,
        JsonNode graphPayload,
        Integer taskCount,
        Integer edgeCount,
        Boolean isValidDag,
        Instant createdAt
) {
    public static WorkflowVersionResponse fromEntity(WorkflowVersion version) {
        return new WorkflowVersionResponse(
                version.getId(),
                version.getWorkflow().getId(),
                version.getVersionNumber(),
                version.getVersionTag(),
                version.getDescription(),
                version.getGraphPayload(),
                version.getTaskCount(),
                version.getEdgeCount(),
                version.getIsValidDag(),
                version.getCreatedAt()
        );
    }
}
