package com.flowforge.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * Standardized error envelope returned for API failure responses.
 *
 * @param status the HTTP status code
 * @param error the HTTP status reason phrase
 * @param message safe high-level description of the error
 * @param timestamp timestamp when the error occurred
 * @param details detailed error messages (e.g. DAG cycle paths or validation issues)
 */
public record ApiErrorResponse(
    int status,
    String error,
    String message,
    Instant timestamp,
    List<String> details
) {
}
