package com.flowforge.execution.retry;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.*;

class BackoffStrategyTest {

    @Nested
    @DisplayName("FixedBackoff Strategy Tests")
    class FixedBackoffTests {

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

    @Nested
    @DisplayName("ExponentialBackoff Strategy Tests")
    class ExponentialBackoffTests {

        @ParameterizedTest(name = "retry #{0} should return {1} ms")
        @CsvSource({
                "1, 1000",
                "2, 2000",
                "3, 4000",
                "4, 8000",
                "5, 16000",
                "6, 30000",
                "7, 30000"
        })
        @DisplayName("1. initial=1000, max=30000 doubling curve capped at maxDelayMillis")
        void testExponentialDoublingAndCap(int retryNumber, long expectedDelay) {
            ExponentialBackoff backoff = new ExponentialBackoff(1000, 30000);
            assertThat(backoff.getDelayMillis(retryNumber)).isEqualTo(expectedDelay);
        }

        @Test
        @DisplayName("2. initial=1000, max=1000 returns 1000 ms for all retries")
        void testEqualInitialAndMaxDelay() {
            ExponentialBackoff backoff = new ExponentialBackoff(1000, 1000);
            assertThat(backoff.getDelayMillis(1)).isEqualTo(1000L);
            assertThat(backoff.getDelayMillis(10)).isEqualTo(1000L);
        }

        @Test
        @DisplayName("3. initialDelayMillis = 0 returns 0 ms for all retries")
        void testZeroInitialDelayReturnsZero() {
            ExponentialBackoff backoff = new ExponentialBackoff(0, 30000);
            assertThat(backoff.getDelayMillis(1)).isEqualTo(0L);
            assertThat(backoff.getDelayMillis(5)).isEqualTo(0L);
        }

        @Test
        @DisplayName("4. initialDelayMillis < 0 throws IllegalArgumentException")
        void testNegativeInitialDelayThrowsException() {
            assertThatThrownBy(() -> new ExponentialBackoff(-1, 5000))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("initialDelayMillis must be non-negative");
        }

        @Test
        @DisplayName("5. maxDelayMillis < 0 throws IllegalArgumentException")
        void testNegativeMaxDelayThrowsException() {
            assertThatThrownBy(() -> new ExponentialBackoff(1000, -1))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("maxDelayMillis must be non-negative");
        }

        @Test
        @DisplayName("6. maxDelayMillis < initialDelayMillis throws IllegalArgumentException")
        void testMaxDelayLessThanInitialDelayThrowsException() {
            assertThatThrownBy(() -> new ExponentialBackoff(5000, 1000))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("must be greater than or equal to initialDelayMillis");
        }

        @Test
        @DisplayName("7. retryNumber = 0 throws IllegalArgumentException")
        void testRetryNumberZeroThrowsException() {
            ExponentialBackoff backoff = new ExponentialBackoff(1000, 30000);
            assertThatThrownBy(() -> backoff.getDelayMillis(0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("retryNumber must be at least 1");
        }

        @ParameterizedTest(name = "negative retryNumber = {0} throws IllegalArgumentException")
        @ValueSource(ints = {-1, -5, -100})
        @DisplayName("8. negative retryNumber throws IllegalArgumentException")
        void testNegativeRetryNumberThrowsException(int invalidRetryNumber) {
            ExponentialBackoff backoff = new ExponentialBackoff(1000, 30000);
            assertThatThrownBy(() -> backoff.getDelayMillis(invalidRetryNumber))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("retryNumber must be at least 1");
        }

        @Test
        @DisplayName("9. Very large retryNumber (Integer.MAX_VALUE) returns maxDelayMillis without long overflow")
        void testIntegerMaxRetryNumberReturnsMaxDelayWithoutOverflow() {
            ExponentialBackoff backoff = new ExponentialBackoff(1000, 30000);
            assertThat(backoff.getDelayMillis(Integer.MAX_VALUE)).isEqualTo(30000L);
        }

        @Test
        @DisplayName("10. Very large initial/max delay near Long.MAX_VALUE calculation remains overflow-safe")
        void testNearLongMaxDelayOverflowSafety() {
            long maxDelay = Long.MAX_VALUE - 1000L;
            long initialDelay = maxDelay / 2L;
            ExponentialBackoff backoff = new ExponentialBackoff(initialDelay, maxDelay);

            assertThat(backoff.getDelayMillis(1)).isEqualTo(initialDelay);
            assertThat(backoff.getDelayMillis(2)).isEqualTo(initialDelay * 2L);
            assertThat(backoff.getDelayMillis(3)).isEqualTo(maxDelay);
            assertThat(backoff.getDelayMillis(100)).isEqualTo(maxDelay);
            assertThat(backoff.getDelayMillis(Integer.MAX_VALUE)).isEqualTo(maxDelay);
        }
    }

    @Nested
    @DisplayName("FullJitterBackoff Strategy Tests")
    class FullJitterBackoffTests {

        /**
         * Test double for RandomSource allowing deterministic verification of calls and bounds.
         */
        static class TestRandomSource implements RandomSource {
            private final long returnValue;
            private long lastBound = -1;
            private int callCount = 0;

            TestRandomSource(long returnValue) {
                this.returnValue = returnValue;
            }

            @Override
            public long nextLong(long bound) {
                if (bound <= 0) {
                    throw new IllegalArgumentException("bound must be > 0");
                }
                this.callCount++;
                this.lastBound = bound;
                return returnValue;
            }

            public long getLastBound() {
                return lastBound;
            }

            public int getCallCount() {
                return callCount;
            }
        }

        /**
         * Test double for BackoffStrategy tracking passed retry numbers.
         */
        static class TestBackoffStrategy implements BackoffStrategy {
            private final long delayToReturn;
            private int lastRetryNumber = -1;

            TestBackoffStrategy(long delayToReturn) {
                this.delayToReturn = delayToReturn;
            }

            @Override
            public long getDelayMillis(int retryNumber) {
                this.lastRetryNumber = retryNumber;
                return delayToReturn;
            }

            public int getLastRetryNumber() {
                return lastRetryNumber;
            }
        }

        @Test
        @DisplayName("1. Fake RandomSource returning 537 for base delay 8000 returns 537")
        void testFullJitterReturnsRandomValue() {
            TestBackoffStrategy base = new TestBackoffStrategy(8000L);
            TestRandomSource random = new TestRandomSource(537L);
            FullJitterBackoff jitter = new FullJitterBackoff(base, random);

            assertThat(jitter.getDelayMillis(1)).isEqualTo(537L);
        }

        @Test
        @DisplayName("2. Fake RandomSource returning 0 for base delay 8000 returns 0")
        void testFullJitterReturnsMinimumBoundZero() {
            TestBackoffStrategy base = new TestBackoffStrategy(8000L);
            TestRandomSource random = new TestRandomSource(0L);
            FullJitterBackoff jitter = new FullJitterBackoff(base, random);

            assertThat(jitter.getDelayMillis(1)).isEqualTo(0L);
        }

        @Test
        @DisplayName("3. Fake RandomSource returning 7999 for base delay 8000 returns 7999")
        void testFullJitterReturnsMaximumBoundUpperMinusOne() {
            TestBackoffStrategy base = new TestBackoffStrategy(8000L);
            TestRandomSource random = new TestRandomSource(7999L);
            FullJitterBackoff jitter = new FullJitterBackoff(base, random);

            assertThat(jitter.getDelayMillis(1)).isEqualTo(7999L);
        }

        @Test
        @DisplayName("4. BaseBackoff returning 0 returns 0 without calling RandomSource")
        void testBaseDelayZeroDoesNotInvokeRandomSource() {
            TestBackoffStrategy base = new TestBackoffStrategy(0L);
            TestRandomSource random = new TestRandomSource(500L);
            FullJitterBackoff jitter = new FullJitterBackoff(base, random);

            assertThat(jitter.getDelayMillis(1)).isEqualTo(0L);
            assertThat(random.getCallCount()).isZero();
        }

        @Test
        @DisplayName("5. Null BackoffStrategy throws IllegalArgumentException")
        void testNullBaseBackoffThrowsException() {
            TestRandomSource random = new TestRandomSource(100L);
            assertThatThrownBy(() -> new FullJitterBackoff(null, random))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("baseBackoff must not be null");
        }

        @Test
        @DisplayName("6. Null RandomSource throws IllegalArgumentException")
        void testNullRandomSourceThrowsException() {
            TestBackoffStrategy base = new TestBackoffStrategy(1000L);
            assertThatThrownBy(() -> new FullJitterBackoff(base, null))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("randomSource must not be null");
        }

        @Test
        @DisplayName("7. Verify retryNumber is passed unchanged to base BackoffStrategy")
        void testRetryNumberPassedUnchangedToBaseBackoff() {
            TestBackoffStrategy base = new TestBackoffStrategy(5000L);
            TestRandomSource random = new TestRandomSource(1234L);
            FullJitterBackoff jitter = new FullJitterBackoff(base, random);

            jitter.getDelayMillis(7);
            assertThat(base.getLastRetryNumber()).isEqualTo(7);
        }

        @Test
        @DisplayName("8. Verify random bound passed to RandomSource equals calculated base delay")
        void testRandomBoundEqualsBaseDelay() {
            TestBackoffStrategy base = new TestBackoffStrategy(8000L);
            TestRandomSource random = new TestRandomSource(1234L);
            FullJitterBackoff jitter = new FullJitterBackoff(base, random);

            jitter.getDelayMillis(1);
            assertThat(random.getLastBound()).isEqualTo(8000L);
        }

        @Test
        @DisplayName("9. FullJitter with ExponentialBackoff end-to-end integration test")
        void testFullJitterWithExponentialBackoff() {
            ExponentialBackoff expBase = new ExponentialBackoff(1000, 30000);
            TestRandomSource random = new TestRandomSource(1500L);
            FullJitterBackoff jitter = new FullJitterBackoff(expBase, random);

            // retry #3 base delay is 4000
            long result = jitter.getDelayMillis(3);
            assertThat(result).isEqualTo(1500L);
            assertThat(random.getLastBound()).isEqualTo(4000L);
        }
    }
}
