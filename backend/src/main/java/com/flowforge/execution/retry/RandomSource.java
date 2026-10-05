package com.flowforge.execution.retry;

/**
 * Abstraction for generating pseudo-random long values within a specified bound.
 * Enables deterministic testing of randomized algorithms (e.g. Full Jitter backoff)
 * via dependency injection.
 */
@FunctionalInterface
public interface RandomSource {

    /**
     * Generates a pseudo-random long value in the half-open range [0, bound).
     *
     * @param bound upper bound (exclusive), must be > 0
     * @return pseudo-random long value satisfying 0 <= value < bound
     * @throws IllegalArgumentException if bound is less than or equal to 0
     */
    long nextLong(long bound);
}
