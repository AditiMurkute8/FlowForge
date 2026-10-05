package com.flowforge.execution.retry;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.*;

class RetryPolicyTest {

    @Test
    @DisplayName("1. maxAttempts = 3, attempt 1 should return true (1st retry allowed)")
    void testMaxAttemptsThreeAttemptOne() {
        FixedRetryPolicy policy = new FixedRetryPolicy(3);
        assertThat(policy.shouldRetry(1)).isTrue();
    }

    @Test
    @DisplayName("2. maxAttempts = 3, attempt 2 should return true (2nd retry allowed)")
    void testMaxAttemptsThreeAttemptTwo() {
        FixedRetryPolicy policy = new FixedRetryPolicy(3);
        assertThat(policy.shouldRetry(2)).isTrue();
    }

    @Test
    @DisplayName("3. maxAttempts = 3, attempt 3 should return false (3 total attempts exhausted)")
    void testMaxAttemptsThreeAttemptThree() {
        FixedRetryPolicy policy = new FixedRetryPolicy(3);
        assertThat(policy.shouldRetry(3)).isFalse();
    }

    @Test
    @DisplayName("4. maxAttempts = 1, attempt 1 should return false (no retries allowed for single-run policy)")
    void testMaxAttemptsOneAttemptOne() {
        FixedRetryPolicy policy = new FixedRetryPolicy(1);
        assertThat(policy.shouldRetry(1)).isFalse();
    }

    @ParameterizedTest(name = "attempt {0} with maxAttempts = 3 should return false")
    @ValueSource(ints = {4, 5, 10})
    @DisplayName("5. currentAttempt greater than maxAttempts should return false")
    void testCurrentAttemptGreaterThanMaxAttempts(int attempt) {
        FixedRetryPolicy policy = new FixedRetryPolicy(3);
        assertThat(policy.shouldRetry(attempt)).isFalse();
    }

    @Test
    @DisplayName("6. maxAttempts = 0 should throw IllegalArgumentException")
    void testMaxAttemptsZeroThrowsException() {
        assertThatThrownBy(() -> new FixedRetryPolicy(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxAttempts must be at least 1");
    }

    @ParameterizedTest(name = "negative maxAttempts = {0} should throw IllegalArgumentException")
    @ValueSource(ints = {-1, -5, -100})
    @DisplayName("7. negative maxAttempts should throw IllegalArgumentException")
    void testNegativeMaxAttemptsThrowsException(int invalidMaxAttempts) {
        assertThatThrownBy(() -> new FixedRetryPolicy(invalidMaxAttempts))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxAttempts must be at least 1");
    }

    @Test
    @DisplayName("8. currentAttempt = 0 should throw IllegalArgumentException")
    void testCurrentAttemptZeroThrowsException() {
        FixedRetryPolicy policy = new FixedRetryPolicy(3);
        assertThatThrownBy(() -> policy.shouldRetry(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("currentAttempt must be at least 1");
    }

    @ParameterizedTest(name = "negative currentAttempt = {0} should throw IllegalArgumentException")
    @ValueSource(ints = {-1, -5, -10})
    @DisplayName("9. negative currentAttempt should throw IllegalArgumentException")
    void testNegativeCurrentAttemptThrowsException(int invalidAttempt) {
        FixedRetryPolicy policy = new FixedRetryPolicy(3);
        assertThatThrownBy(() -> policy.shouldRetry(invalidAttempt))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("currentAttempt must be at least 1");
    }
}
