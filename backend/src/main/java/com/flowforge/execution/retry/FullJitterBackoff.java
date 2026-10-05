package com.flowforge.execution.retry;

/**
 * Immutable backoff strategy decorator implementing Full Jitter.
 * For a given retry attempt:
 * 1. Computes base delay = baseBackoff.getDelayMillis(retryNumber).
 * 2. If base delay == 0, returns 0.
 * 3. Otherwise returns randomSource.nextLong(baseDelay), resulting in a jittered delay
 *    in the range [0, baseDelay).
 */
public final class FullJitterBackoff implements BackoffStrategy {

    private final BackoffStrategy baseBackoff;
    private final RandomSource randomSource;

    /**
     * Constructs a FullJitterBackoff strategy wrapping a base backoff strategy and random source.
     *
     * @param baseBackoff underlying backoff strategy to calculate upper bound delay (must not be null)
     * @param randomSource generator for pseudo-random numbers (must not be null)
     * @throws IllegalArgumentException if baseBackoff or randomSource is null
     */
    public FullJitterBackoff(BackoffStrategy baseBackoff, RandomSource randomSource) {
        if (baseBackoff == null) {
            throw new IllegalArgumentException("baseBackoff must not be null.");
        }
        if (randomSource == null) {
            throw new IllegalArgumentException("randomSource must not be null.");
        }
        this.baseBackoff = baseBackoff;
        this.randomSource = randomSource;
    }

    public BackoffStrategy getBaseBackoff() {
        return baseBackoff;
    }

    public RandomSource getRandomSource() {
        return randomSource;
    }

    /**
     * Calculates the jittered backoff delay for a retry attempt.
     *
     * @param retryNumber 1-indexed retry number (must be >= 1)
     * @return pseudo-random delay in range [0, baseDelay) if baseDelay > 0, or 0 if baseDelay == 0
     * @throws IllegalArgumentException if retryNumber is less than 1
     */
    @Override
    public long getDelayMillis(int retryNumber) {
        long baseDelay = baseBackoff.getDelayMillis(retryNumber);
        if (baseDelay == 0L) {
            return 0L;
        }
        return randomSource.nextLong(baseDelay);
    }

    @Override
    public String toString() {
        return "FullJitterBackoff{" +
                "baseBackoff=" + baseBackoff +
                ", randomSource=" + randomSource +
                '}';
    }
}
