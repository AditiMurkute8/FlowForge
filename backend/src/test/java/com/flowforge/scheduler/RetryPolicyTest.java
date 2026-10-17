package com.flowforge.scheduler;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RetryPolicyTest {

    @Test
    @DisplayName("1. RetryPolicy.none() allows exactly one attempt with zero delay")
    void nonePolicy() {
        RetryPolicy policy = RetryPolicy.none();

        assertThat(policy.maxAttempts()).isEqualTo(1);
        assertThat(policy.backoffStrategy()).isEqualTo(BackoffStrategy.NONE);
        assertThat(policy.computeDelay(1)).isEqualTo(Duration.ZERO);
        assertThat(policy.computeDelay(2)).isEqualTo(Duration.ZERO);
        assertThat(policy.isRetryable(new RuntimeException())).isTrue();
    }

    @Test
    @DisplayName("2. Fixed backoff returns constant delay across all attempts")
    void fixedBackoff() {
        RetryPolicy policy = RetryPolicy.fixed(3, Duration.ofMillis(250));

        assertThat(policy.maxAttempts()).isEqualTo(3);
        assertThat(policy.backoffStrategy()).isEqualTo(BackoffStrategy.FIXED);
        assertThat(policy.computeDelay(1)).isEqualTo(Duration.ofMillis(250));
        assertThat(policy.computeDelay(2)).isEqualTo(Duration.ofMillis(250));
        assertThat(policy.computeDelay(3)).isEqualTo(Duration.ofMillis(250));
    }

    @Test
    @DisplayName("3. Exponential backoff calculates exponential progression")
    void exponentialBackoffProgression() {
        // initial = 100ms, max = 5000ms, multiplier = 2.0
        RetryPolicy policy = RetryPolicy.exponential(
            5,
            Duration.ofMillis(100),
            Duration.ofMillis(5000),
            2.0
        );

        // Attempt 1 failed -> 100 * 2^0 = 100ms
        assertThat(policy.computeDelay(1)).isEqualTo(Duration.ofMillis(100));
        // Attempt 2 failed -> 100 * 2^1 = 200ms
        assertThat(policy.computeDelay(2)).isEqualTo(Duration.ofMillis(200));
        // Attempt 3 failed -> 100 * 2^2 = 400ms
        assertThat(policy.computeDelay(3)).isEqualTo(Duration.ofMillis(400));
        // Attempt 4 failed -> 100 * 2^3 = 800ms
        assertThat(policy.computeDelay(4)).isEqualTo(Duration.ofMillis(800));
    }

    @Test
    @DisplayName("4. Exponential backoff strictly respects maxDelay cap")
    void exponentialBackoffRespectsCap() {
        RetryPolicy policy = RetryPolicy.exponential(
            6,
            Duration.ofMillis(100),
            Duration.ofMillis(500),
            2.0
        );

        assertThat(policy.computeDelay(1)).isEqualTo(Duration.ofMillis(100));
        assertThat(policy.computeDelay(2)).isEqualTo(Duration.ofMillis(200));
        assertThat(policy.computeDelay(3)).isEqualTo(Duration.ofMillis(400));
        // 100 * 2^3 = 800ms -> capped at 500ms
        assertThat(policy.computeDelay(4)).isEqualTo(Duration.ofMillis(500));
        // 100 * 2^4 = 1600ms -> capped at 500ms
        assertThat(policy.computeDelay(5)).isEqualTo(Duration.ofMillis(500));
    }

    @Test
    @DisplayName("5. Extremely high attempt counts do not overflow or produce negative delays")
    void exponentialOverflowSafety() {
        RetryPolicy policy = RetryPolicy.exponential(
            100,
            Duration.ofMillis(100),
            Duration.ofMillis(60000),
            2.0
        );

        // Very high attempt index
        Duration delay = policy.computeDelay(70);
        assertThat(delay).isEqualTo(Duration.ofMillis(60000));
    }

    @Test
    @DisplayName("6. Full jitter stays within [0, baseDelay] bounds")
    void jitterBounds() {
        RetryPolicy policy = RetryPolicy.fixed(3, Duration.ofMillis(1000))
            .withJitter(JitterStrategy.FULL);

        for (int i = 0; i < 50; i++) {
            Duration delay = policy.computeDelay(1);
            assertThat(delay.toMillis()).isBetween(0L, 1000L);
        }
    }

    @Test
    @DisplayName("7. Injected deterministic jitter supplier produces exact values")
    void deterministicJitterSupplier() {
        RetryPolicy policy = RetryPolicy.fixed(3, Duration.ofMillis(1000))
            .withJitter(JitterStrategy.FULL);

        // Test with 0.0 -> 0ms
        assertThat(policy.computeDelay(1, () -> 0.0)).isEqualTo(Duration.ZERO);
        // Test with 0.5 -> 500ms
        assertThat(policy.computeDelay(1, () -> 0.5)).isEqualTo(Duration.ofMillis(500));
        // Test with 1.0 -> 1000ms
        assertThat(policy.computeDelay(1, () -> 1.0)).isEqualTo(Duration.ofMillis(1000));
        // Out of bounds raw jitter clamped
        assertThat(policy.computeDelay(1, () -> 1.5)).isEqualTo(Duration.ofMillis(1000));
        assertThat(policy.computeDelay(1, () -> -0.2)).isEqualTo(Duration.ZERO);
    }

    @Test
    @DisplayName("8. Default retry predicate accepts Exception instances but rejects Error instances")
    void defaultPredicateEligibility() {
        RetryPolicy policy = RetryPolicy.fixed(3, Duration.ofMillis(100));

        // Ordinary checked and unchecked exceptions are retryable
        assertThat(policy.isRetryable(new RuntimeException("transient"))).isTrue();
        assertThat(policy.isRetryable(new IOException("network timeout"))).isTrue();
        assertThat(policy.isRetryable(new IllegalStateException("conflict"))).isTrue();

        // Error instances are NOT retryable by default
        assertThat(policy.isRetryable(new AssertionError("assertion failed"))).isFalse();
        assertThat(policy.isRetryable(new OutOfMemoryError("heap exhausted"))).isFalse();
        assertThat(policy.isRetryable(new StackOverflowError("recursion limit"))).isFalse();
    }

    @Test
    @DisplayName("9. Custom retry predicate selectively retries specific exception types")
    void customPredicateEligibility() {
        RetryPolicy policy = RetryPolicy.fixed(3, Duration.ofMillis(100))
            .withPredicate(t -> t instanceof IOException);

        assertThat(policy.isRetryable(new IOException("connection reset"))).isTrue();
        assertThat(policy.isRetryable(new IllegalArgumentException("invalid input"))).isFalse();
        assertThat(policy.isRetryable(new NullPointerException())).isFalse();
    }

    @Test
    @DisplayName("10. Invalid policy configuration arguments throw IllegalArgumentException")
    void invalidArgumentsRejected() {
        assertThatThrownBy(() -> RetryPolicy.fixed(0, Duration.ofMillis(100)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("maxAttempts must be at least 1");

        assertThatThrownBy(() -> RetryPolicy.fixed(2, Duration.ofMillis(-10)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("initialDelay must not be negative");

        assertThatThrownBy(() -> RetryPolicy.exponential(3, Duration.ofMillis(200), Duration.ofMillis(100), 2.0))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("maxDelay must be greater than or equal to initialDelay");

        assertThatThrownBy(() -> RetryPolicy.exponential(3, Duration.ofMillis(100), Duration.ofMillis(500), 0.5))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("backoffMultiplier must be at least 1.0");
    }
}
