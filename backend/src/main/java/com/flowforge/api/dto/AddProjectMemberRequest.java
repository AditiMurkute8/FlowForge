package com.flowforge.api.dto;

import com.flowforge.domain.ProjectRole;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Request payload for adding or updating a member's role within a project.
 */
public record AddProjectMemberRequest(
    UUID userId,
    String email,
    @NotNull(message = "Role is required")
    ProjectRole role
) {
}
