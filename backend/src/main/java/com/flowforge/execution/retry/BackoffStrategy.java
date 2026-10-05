package com.flowforge.execution.retry;

/**
 * Strategy for calculating delay intervals before performing a task retry attempt.
 */
public interface BackoffStrategy {

    /**
     * Calculates the backoff delay in milliseconds for a specific retry attempt.
     *
     * @param retryNumber 1-indexed retry attempt number (1 for first retry, 2 for second retry, etc.)
     * @return delay in milliseconds to wait before attempting the retry
     * @throws IllegalArgumentException if retryNumber is less than 1
     */
    long getDelayMillis(int retryNumber);
}
