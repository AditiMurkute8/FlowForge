package com.flowforge.execution.retry;

/**
 * Immutable retry policy that permits up to a fixed maximum number of total execution attempts.
 * Max attempts represents the total allowed executions including the initial attempt.
 */
public final class FixedRetryPolicy implements RetryPolicy {

    private final int maxAttempts;

    /**
     * Constructs a FixedRetryPolicy with a specified maximum attempt limit.
     *
     * @param maxAttempts maximum number of total allowed execution attempts (must be >= 1)
     * @throws IllegalArgumentException if maxAttempts is less than 1
     */
    public FixedRetryPolicy(int maxAttempts) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException(
                    "maxAttempts must be at least 1 (representing total executions), provided: " + maxAttempts);
        }
        this.maxAttempts = maxAttempts;
    }

    public int getMaxAttempts() {
        return maxAttempts;
    }

    /**
     * Determines whether a retry attempt should be granted.
     *
     * @param currentAttempt 1-indexed attempt number of the failed execution
     * @return true if currentAttempt < maxAttempts, false if currentAttempt >= maxAttempts
     * @throws IllegalArgumentException if currentAttempt is less than 1
     */
    @Override
    public boolean shouldRetry(int currentAttempt) {
        if (currentAttempt < 1) {
            throw new IllegalArgumentException(
                    "currentAttempt must be at least 1, provided: " + currentAttempt);
        }
        return currentAttempt < maxAttempts;
    }

    @Override
    public String toString() {
        return "FixedRetryPolicy{maxAttempts=" + maxAttempts + "}";
    }
}
