package com.flowforge.api.dto;

/**
 * Action specification and parameters for an executable task.
 *
 * @param type the action type (defaults to NO_OP if omitted)
 * @param delayMs duration in milliseconds for DELAY action (0..5000)
 * @param failUntilAttempt attempt threshold for FAIL_UNTIL_ATTEMPT action (1..5)
 * @param errorMessage custom simulated error message for FAIL or FAIL_UNTIL_ATTEMPT (max 255 chars)
 */
public record TaskActionDto(
    TaskActionType type,
    Long delayMs,
    Integer failUntilAttempt,
    String errorMessage
) {
}
