package com.flowforge.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request payload for creating a new Project.
 *
 * @param name display name (required, 1..100 characters)
 * @param slug optional custom slug (max 100 characters); auto-generated from name if omitted or blank
 * @param description optional description (max 500 characters)
 */
public record CreateProjectRequest(
        @NotBlank(message = "Project name must not be blank")
        @Size(max = 100, message = "Project name must not exceed 100 characters")
        String name,

        @Size(max = 100, message = "Project slug must not exceed 100 characters")
        String slug,

        @Size(max = 500, message = "Description must not exceed 500 characters")
        String description
) {}
