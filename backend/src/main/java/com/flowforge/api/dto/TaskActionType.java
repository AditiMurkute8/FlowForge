package com.flowforge.api.dto;

/**
 * Allowlisted task action types supported for safe in-process execution.
 */
public enum TaskActionType {
    /**
     * Completes immediately without delay or error.
     */
    NO_OP,

    /**
     * Pauses execution for a bounded delay duration.
     */
    DELAY,

    /**
     * Fails with a simulated error.
     */
    FAIL,

    /**
     * Fails transiently until a specified attempt index, then succeeds on subsequent attempts.
     */
    FAIL_UNTIL_ATTEMPT
}
