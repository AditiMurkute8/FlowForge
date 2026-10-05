package com.flowforge.execution.retry;

/**
 * Defines a policy for deciding whether a failed task execution should be retried.
 */
public interface RetryPolicy {

    /**
     * Determines whether a failed task execution should be attempted again.
     *
     * @param currentAttempt the 1-indexed attempt number of the execution that just failed
     *                       (1 for initial execution, 2 for first retry attempt, etc.)
     * @return true if another execution attempt should be made, false otherwise
     * @throws IllegalArgumentException if currentAttempt is less than 1
     */
    boolean shouldRetry(int currentAttempt);
}
