package com.flowforge.execution.retry;

/**
 * Immutable backoff strategy that returns a constant fixed delay for every retry attempt.
 */
public final class FixedBackoff implements BackoffStrategy {

    private final long delayMillis;

    /**
     * Constructs a FixedBackoff strategy with a constant delay duration.
     *
     * @param delayMillis fixed delay in milliseconds (must be >= 0)
     * @throws IllegalArgumentException if delayMillis is negative
     */
    public FixedBackoff(long delayMillis) {
        if (delayMillis < 0) {
            throw new IllegalArgumentException(
                    "delayMillis must be non-negative, provided: " + delayMillis);
        }
        this.delayMillis = delayMillis;
    }

    public long getDelayMillis() {
        return delayMillis;
    }

    /**
     * Calculates the backoff delay in milliseconds for a retry attempt.
     *
     * @param retryNumber 1-indexed retry number (1 for first retry, 2 for second retry, etc.)
     * @return constant delayMillis for any valid retryNumber
     * @throws IllegalArgumentException if retryNumber is less than 1
     */
    @Override
    public long getDelayMillis(int retryNumber) {
        if (retryNumber < 1) {
            throw new IllegalArgumentException(
                    "retryNumber must be at least 1, provided: " + retryNumber);
        }
        return delayMillis;
    }

    @Override
    public String toString() {
        return "FixedBackoff{delayMillis=" + delayMillis + "}";
    }
}
