package com.flowforge.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * Request payload for executing an immutable version of a workflow.
 *
 * @param versionNumber optional specific sequential version number to execute (1..N). If omitted, the latest version is executed.
 * @param triggeredBy optional trigger source identifier (e.g. "manual", "api", "scheduler") (max 100 chars)
 * @param concurrency optional execution concurrency limit override (1..4, default 4)
 */
public record ExecuteRunRequest(
    @Min(value = 1, message = "Version number must be at least 1")
    Integer versionNumber,

    @Size(max = 100, message = "Triggered-by identifier must not exceed 100 characters")
    String triggeredBy,

    @Min(value = 1, message = "Concurrency must be at least 1")
    @Max(value = 4, message = "Concurrency must not exceed 4")
    Integer concurrency
) {
    public ExecuteRunRequest() {
        this(null, null, null);
    }
}
