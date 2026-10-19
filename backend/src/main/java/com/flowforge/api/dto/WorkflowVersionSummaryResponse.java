package com.flowforge.api.dto;

import com.flowforge.domain.WorkflowVersion;

import java.time.Instant;
import java.util.UUID;

/**
 * Summary API response representing a WorkflowVersion metadata item in list views.
 *
 * @param id unique version identifier
 * @param workflowId parent workflow identifier
 * @param versionNumber sequential version number (1..N)
 * @param versionTag human-readable version label (e.g. "v1", "v1.0.0")
 * @param description optional changelog or snapshot notes
 * @param taskCount server-derived total task count
 * @param edgeCount server-derived total dependency edge count
 * @param isValidDag server-derived DAG validity flag
 * @param createdAt creation timestamp
 */
public record WorkflowVersionSummaryResponse(
        UUID id,
        UUID workflowId,
        Integer versionNumber,
        String versionTag,
        String description,
        Integer taskCount,
        Integer edgeCount,
        Boolean isValidDag,
        Instant createdAt
) {
    public static WorkflowVersionSummaryResponse fromEntity(WorkflowVersion version) {
        return new WorkflowVersionSummaryResponse(
                version.getId(),
                version.getWorkflow().getId(),
                version.getVersionNumber(),
                version.getVersionTag(),
                version.getDescription(),
                version.getTaskCount(),
                version.getEdgeCount(),
                version.getIsValidDag(),
                version.getCreatedAt()
        );
    }
}
