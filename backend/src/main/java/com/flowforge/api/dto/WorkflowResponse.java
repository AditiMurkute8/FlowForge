package com.flowforge.api.dto;

import com.flowforge.domain.Workflow;

import java.time.Instant;
import java.util.UUID;

/**
 * API response representing a Workflow resource within a Project.
 *
 * @param id unique workflow identifier
 * @param projectId parent project identifier
 * @param name human-readable workflow name
 * @param slug project-scoped unique workflow slug
 * @param description optional workflow description
 * @param createdAt creation timestamp
 * @param updatedAt last update timestamp
 */
public record WorkflowResponse(
        UUID id,
        UUID projectId,
        String name,
        String slug,
        String description,
        Instant createdAt,
        Instant updatedAt
) {
    public static WorkflowResponse fromEntity(Workflow workflow) {
        return new WorkflowResponse(
                workflow.getId(),
                workflow.getProject().getId(),
                workflow.getName(),
                workflow.getSlug(),
                workflow.getDescription(),
                workflow.getCreatedAt(),
                workflow.getUpdatedAt()
        );
    }
}
