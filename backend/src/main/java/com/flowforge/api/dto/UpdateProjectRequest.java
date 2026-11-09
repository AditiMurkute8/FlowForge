package com.flowforge.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request payload for updating an existing Project.
 *
 * @param name updated display name (required, 1..100 characters)
 * @param description optional updated description (max 500 characters)
 */
public record UpdateProjectRequest(
        @NotBlank(message = "Project name must not be blank")
        @Size(max = 100, message = "Project name must not exceed 100 characters")
        String name,

        @Size(max = 500, message = "Description must not exceed 500 characters")
        String description
) {}
