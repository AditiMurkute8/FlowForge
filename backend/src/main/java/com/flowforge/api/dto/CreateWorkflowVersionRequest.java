package com.flowforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Request payload for creating an immutable WorkflowVersion snapshot.
 *
 * @param versionTag optional version label (e.g. "v1.0.0", max 30 characters); defaults to "v{number}" if omitted
 * @param description optional snapshot changelog or notes (max 500 characters)
 * @param graphPayload React Flow canvas graph payload containing nodes and edges
 */
public record CreateWorkflowVersionRequest(
        @Size(max = 30, message = "Version tag must not exceed 30 characters")
        String versionTag,

        @Size(max = 500, message = "Description must not exceed 500 characters")
        String description,

        @NotNull(message = "graphPayload must not be null")
        JsonNode graphPayload
) {}
