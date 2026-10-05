package com.flowforge.execution.retry;

/**
 * Immutable overflow-safe exponential backoff strategy.
 * Calculates delay using the exponential growth formula:
 * <pre>
 *   delay = initialDelayMillis * 2^(retryNumber - 1)
 * </pre>
 * capped at maxDelayMillis.
 */
public final class ExponentialBackoff implements BackoffStrategy {

    private final long initialDelayMillis;
    private final long maxDelayMillis;

    /**
     * Constructs an ExponentialBackoff strategy.
     *
     * @param initialDelayMillis initial delay in milliseconds for the 1st retry (must be >= 0)
     * @param maxDelayMillis upper bound cap for backoff delay in milliseconds (must be >= initialDelayMillis)
     * @throws IllegalArgumentException if initialDelayMillis < 0, maxDelayMillis < 0,
     *                                  or maxDelayMillis < initialDelayMillis
     */
    public ExponentialBackoff(long initialDelayMillis, long maxDelayMillis) {
        if (initialDelayMillis < 0) {
            throw new IllegalArgumentException(
                    "initialDelayMillis must be non-negative, provided: " + initialDelayMillis);
        }
        if (maxDelayMillis < 0) {
            throw new IllegalArgumentException(
                    "maxDelayMillis must be non-negative, provided: " + maxDelayMillis);
        }
        if (maxDelayMillis < initialDelayMillis) {
            throw new IllegalArgumentException(
                    String.format("maxDelayMillis (%d) must be greater than or equal to initialDelayMillis (%d)",
                            maxDelayMillis, initialDelayMillis));
        }
        this.initialDelayMillis = initialDelayMillis;
        this.maxDelayMillis = maxDelayMillis;
    }

    public long getInitialDelayMillis() {
        return initialDelayMillis;
    }

    public long getMaxDelayMillis() {
        return maxDelayMillis;
    }

    /**
     * Calculates the exponential backoff delay for the given retry attempt.
     * Prevents long overflow by checking division bounds before multiplication.
     *
     * @param retryNumber 1-indexed retry number (1 for first retry, 2 for second retry, etc.)
     * @return delay in milliseconds, capped at maxDelayMillis
     * @throws IllegalArgumentException if retryNumber is less than 1
     */
    @Override
    public long getDelayMillis(int retryNumber) {
        if (retryNumber < 1) {
            throw new IllegalArgumentException(
                    "retryNumber must be at least 1, provided: " + retryNumber);
        }

        if (initialDelayMillis == 0) {
            return 0L;
        }

        int shift = retryNumber - 1;
        // Shifts >= 62 produce multipliers (2^shift) that exceed maxDelayMillis or overflow positive 64-bit long values.
        // Capping immediately at maxDelayMillis prevents invalid bit shifts (shift >= 63 sets the sign bit) and long overflow.
        if (shift >= 62) {
            return maxDelayMillis;
        }

        long multiplier = 1L << shift;
        if (initialDelayMillis > maxDelayMillis / multiplier) {
            return maxDelayMillis;
        }

        long calculatedDelay = initialDelayMillis * multiplier;
        return Math.min(calculatedDelay, maxDelayMillis);
    }

    @Override
    public String toString() {
        return "ExponentialBackoff{" +
                "initialDelayMillis=" + initialDelayMillis +
                ", maxDelayMillis=" + maxDelayMillis +
                '}';
    }
}
