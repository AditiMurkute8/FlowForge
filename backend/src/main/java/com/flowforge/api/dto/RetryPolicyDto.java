package com.flowforge.api.dto;

import com.flowforge.scheduler.BackoffStrategy;
import com.flowforge.scheduler.JitterStrategy;

/**
 * DTO defining task retry behavior and backoff timing.
 *
 * @param maxAttempts maximum total execution attempts (1..5, default 1)
 * @param backoffStrategy strategy for calculating delays (NONE, FIXED, EXPONENTIAL, default NONE)
 * @param initialDelayMs base delay in milliseconds (0..2000, default 0)
 * @param maxDelayMs delay ceiling in milliseconds (initialDelayMs..5000)
 * @param backoffMultiplier multiplier for exponential progression (1.0..5.0, default 2.0)
 * @param jitterStrategy jitter randomization strategy (NONE, FULL, default NONE)
 */
public record RetryPolicyDto(
    Integer maxAttempts,
    BackoffStrategy backoffStrategy,
    Long initialDelayMs,
    Long maxDelayMs,
    Double backoffMultiplier,
    JitterStrategy jitterStrategy
) {
}
