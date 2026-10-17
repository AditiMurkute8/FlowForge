package com.flowforge.scheduler;

/**
 * Strategy for introducing randomized jitter into backoff delays to prevent thundering-herd contention.
 */
public enum JitterStrategy {
    /**
     * Exact calculated delay without randomization.
     */
    NONE,

    /**
     * Full jitter: delay is uniformly distributed between 0 and the calculated base delay.
     */
    FULL
}
