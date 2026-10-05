package com.flowforge.execution.retry;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.*;

class BackoffStrategyTest {

    @Test
    @DisplayName("1. FixedBackoff(5000), retry 1 should return 5000 ms")
    void testFixedBackoffRetryOne() {
        FixedBackoff backoff = new FixedBackoff(5000);
        assertThat(backoff.getDelayMillis(1)).isEqualTo(5000L);
    }

    @Test
    @DisplayName("2. FixedBackoff(5000), retry 2 should return 5000 ms")
    void testFixedBackoffRetryTwo() {
        FixedBackoff backoff = new FixedBackoff(5000);
        assertThat(backoff.getDelayMillis(2)).isEqualTo(5000L);
    }

    @Test
    @DisplayName("3. FixedBackoff(5000), retry 10 should return 5000 ms")
    void testFixedBackoffRetryTen() {
        FixedBackoff backoff = new FixedBackoff(5000);
        assertThat(backoff.getDelayMillis(10)).isEqualTo(5000L);
    }

    @Test
    @DisplayName("4. delayMillis = 0 is allowed and returns 0 ms")
    void testZeroDelayMillisAllowed() {
        FixedBackoff backoff = new FixedBackoff(0);
        assertThat(backoff.getDelayMillis(1)).isEqualTo(0L);
        assertThat(backoff.getDelayMillis(5)).isEqualTo(0L);
    }

    @ParameterizedTest(name = "negative delayMillis = {0} should throw IllegalArgumentException")
    @ValueSource(longs = {-1L, -100L, -5000L})
    @DisplayName("5. negative delayMillis throws IllegalArgumentException")
    void testNegativeDelayMillisThrowsException(long invalidDelay) {
        assertThatThrownBy(() -> new FixedBackoff(invalidDelay))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("delayMillis must be non-negative");
    }

    @Test
    @DisplayName("6. retryNumber = 0 throws IllegalArgumentException")
    void testRetryNumberZeroThrowsException() {
        FixedBackoff backoff = new FixedBackoff(5000);
        assertThatThrownBy(() -> backoff.getDelayMillis(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("retryNumber must be at least 1");
    }

    @ParameterizedTest(name = "negative retryNumber = {0} should throw IllegalArgumentException")
    @ValueSource(ints = {-1, -5, -10})
    @DisplayName("7. negative retryNumber throws IllegalArgumentException")
    void testNegativeRetryNumberThrowsException(int invalidRetryNumber) {
        FixedBackoff backoff = new FixedBackoff(5000);
        assertThatThrownBy(() -> backoff.getDelayMillis(invalidRetryNumber))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("retryNumber must be at least 1");
    }
}
