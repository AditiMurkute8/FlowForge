package com.flowforge.api.dto;

/**
 * Specification of an individual task in a workflow execution request.
 *
 * @param id the unique identifier of the task (must not be blank)
 * @param action the task execution action (defaults to NO_OP if null)
 * @param retryPolicy the retry policy configuration (defaults to no retries if null)
 */
public record TaskDefinitionDto(
    String id,
    TaskActionDto action,
    RetryPolicyDto retryPolicy
) {
}
