package com.flowforge.api.dto;

import com.flowforge.domain.Project;

import java.time.Instant;
import java.util.UUID;

/**
 * API response representing a Project resource.
 *
 * @param id unique project identifier
 * @param name human-readable project name
 * @param slug globally unique project slug
 * @param description optional project description
 * @param createdAt creation timestamp
 * @param updatedAt last update timestamp
 */
public record ProjectResponse(
        UUID id,
        String name,
        String slug,
        String description,
        Instant createdAt,
        Instant updatedAt
) {
    public static ProjectResponse fromEntity(Project project) {
        return new ProjectResponse(
                project.getId(),
                project.getName(),
                project.getSlug(),
                project.getDescription(),
                project.getCreatedAt(),
                project.getUpdatedAt()
        );
    }
}
