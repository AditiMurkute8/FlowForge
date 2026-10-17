package com.flowforge.scheduler;

/**
 * Strategy for calculating delays between consecutive retry attempts.
 */
public enum BackoffStrategy {
    /**
     * No delay between retry attempts.
     */
    NONE,

    /**
     * Constant delay between retry attempts.
     */
    FIXED,

    /**
     * Delay grows exponentially with each retry attempt, capped at a configured maximum delay.
     */
    EXPONENTIAL
}
