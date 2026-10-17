package com.flowforge.scheduler;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;
import java.util.function.Predicate;

/**
 * Immutable configuration defining task retry behavior, backoff timing, and jitter.
 */
public final class RetryPolicy {

    /**
     * Default retry eligibility: retries ordinary Exception instances, excluding Error instances.
     */
    public static final Predicate<Throwable> DEFAULT_PREDICATE = t -> t instanceof Exception;

    private static final RetryPolicy NO_RETRY = new RetryPolicy(
        1,
        BackoffStrategy.NONE,
        Duration.ZERO,
        Duration.ZERO,
        1.0,
        JitterStrategy.NONE,
        DEFAULT_PREDICATE
    );

    private final int maxAttempts;
    private final BackoffStrategy backoffStrategy;
    private final Duration initialDelay;
    private final Duration maxDelay;
    private final double backoffMultiplier;
    private final JitterStrategy jitterStrategy;
    private final Predicate<Throwable> retryPredicate;

    private RetryPolicy(
        int maxAttempts,
        BackoffStrategy backoffStrategy,
        Duration initialDelay,
        Duration maxDelay,
        double backoffMultiplier,
        JitterStrategy jitterStrategy,
        Predicate<Throwable> retryPredicate
    ) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be at least 1: " + maxAttempts);
        }
        Objects.requireNonNull(backoffStrategy, "backoffStrategy must not be null");
        Objects.requireNonNull(initialDelay, "initialDelay must not be null");
        Objects.requireNonNull(maxDelay, "maxDelay must not be null");
        if (initialDelay.isNegative()) {
            throw new IllegalArgumentException("initialDelay must not be negative: " + initialDelay);
        }
        if (maxDelay.isNegative()) {
            throw new IllegalArgumentException("maxDelay must not be negative: " + maxDelay);
        }
        if (backoffStrategy == BackoffStrategy.EXPONENTIAL) {
            if (backoffMultiplier < 1.0) {
                throw new IllegalArgumentException("backoffMultiplier must be at least 1.0: " + backoffMultiplier);
            }
            if (maxDelay.compareTo(initialDelay) < 0) {
                throw new IllegalArgumentException("maxDelay must be greater than or equal to initialDelay");
            }
        }
        Objects.requireNonNull(jitterStrategy, "jitterStrategy must not be null");
        Objects.requireNonNull(retryPredicate, "retryPredicate must not be null");

        this.maxAttempts = maxAttempts;
        this.backoffStrategy = backoffStrategy;
        this.initialDelay = initialDelay;
        this.maxDelay = maxDelay;
        this.backoffMultiplier = backoffMultiplier;
        this.jitterStrategy = jitterStrategy;
        this.retryPredicate = retryPredicate;
    }

    /**
     * Returns a policy with no retries (exactly 1 total attempt).
     */
    public static RetryPolicy none() {
        return NO_RETRY;
    }

    /**
     * Creates a fixed-delay retry policy.
     *
     * @param maxAttempts total attempts allowed, must be at least 1
     * @param delay constant delay between attempts, must not be negative
     * @return the configured retry policy
     */
    public static RetryPolicy fixed(int maxAttempts, Duration delay) {
        Objects.requireNonNull(delay, "delay must not be null");
        return new RetryPolicy(
            maxAttempts,
            BackoffStrategy.FIXED,
            delay,
            delay,
            1.0,
            JitterStrategy.NONE,
            DEFAULT_PREDICATE
        );
    }

    /**
     * Creates an exponential backoff retry policy with a maximum delay ceiling.
     *
     * @param maxAttempts total attempts allowed, must be at least 1
     * @param initialDelay initial delay after the first failure, must not be negative
     * @param maxDelay maximum delay ceiling, must be >= initialDelay
     * @param multiplier exponential factor, must be >= 1.0
     * @return the configured retry policy
     */
    public static RetryPolicy exponential(int maxAttempts, Duration initialDelay, Duration maxDelay, double multiplier) {
        return new RetryPolicy(
            maxAttempts,
            BackoffStrategy.EXPONENTIAL,
            initialDelay,
            maxDelay,
            multiplier,
            JitterStrategy.NONE,
            DEFAULT_PREDICATE
        );
    }

    /**
     * Returns a copy of this policy with the specified jitter strategy.
     */
    public RetryPolicy withJitter(JitterStrategy jitterStrategy) {
        return new RetryPolicy(
            this.maxAttempts,
            this.backoffStrategy,
            this.initialDelay,
            this.maxDelay,
            this.backoffMultiplier,
            jitterStrategy,
            this.retryPredicate
        );
    }

    /**
     * Returns a copy of this policy with the specified retry predicate.
     */
    public RetryPolicy withPredicate(Predicate<Throwable> retryPredicate) {
        return new RetryPolicy(
            this.maxAttempts,
            this.backoffStrategy,
            this.initialDelay,
            this.maxDelay,
            this.backoffMultiplier,
            this.jitterStrategy,
            retryPredicate
        );
    }

    public int maxAttempts() {
        return maxAttempts;
    }

    public BackoffStrategy backoffStrategy() {
        return backoffStrategy;
    }

    public Duration initialDelay() {
        return initialDelay;
    }

    public Duration maxDelay() {
        return maxDelay;
    }

    public double backoffMultiplier() {
        return backoffMultiplier;
    }

    public JitterStrategy jitterStrategy() {
        return jitterStrategy;
    }

    public Predicate<Throwable> retryPredicate() {
        return retryPredicate;
    }

    /**
     * Checks if the given throwable is eligible for retry under this policy.
     */
    public boolean isRetryable(Throwable t) {
        return t != null && retryPredicate.test(t);
    }

    /**
     * Computes backoff delay for the specified failed attempt index using a custom jitter supplier.
     *
     * @param failedAttempt 1-based index of the failed attempt (e.g. 1 after first attempt fails)
     * @param jitterSupplier supplier producing random float in [0.0, 1.0)
     * @return the calculated delay duration
     */
    public Duration computeDelay(int failedAttempt, DoubleSupplier jitterSupplier) {
        if (backoffStrategy == BackoffStrategy.NONE || failedAttempt < 1) {
            return Duration.ZERO;
        }

        long baseMillis;
        if (backoffStrategy == BackoffStrategy.FIXED) {
            baseMillis = initialDelay.toMillis();
        } else {
            int exponent = failedAttempt - 1;
            double factor = Math.pow(backoffMultiplier, exponent);
            if (Double.isInfinite(factor) || Double.isNaN(factor)) {
                baseMillis = maxDelay.toMillis();
            } else {
                long calculated = (long) Math.min((double) Long.MAX_VALUE, initialDelay.toMillis() * factor);
                baseMillis = Math.min(maxDelay.toMillis(), calculated);
            }
        }

        long actualMillis = baseMillis;
        if (jitterStrategy == JitterStrategy.FULL) {
            Objects.requireNonNull(jitterSupplier, "jitterSupplier must not be null when FULL jitter is enabled");
            double rawJitter = jitterSupplier.getAsDouble();
            double clampedJitter = Math.max(0.0, Math.min(1.0, rawJitter));
            actualMillis = (long) (baseMillis * clampedJitter);
        }

        return Duration.ofMillis(actualMillis);
    }

    /**
     * Computes backoff delay for the specified failed attempt index using thread-local random jitter.
     *
     * @param failedAttempt 1-based index of the failed attempt
     * @return the calculated delay duration
     */
    public Duration computeDelay(int failedAttempt) {
        return computeDelay(failedAttempt, ThreadLocalRandom.current()::nextDouble);
    }
}
