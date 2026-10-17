package com.flowforge.api;

/**
 * Dedicated exception thrown by simulated task actions (FAIL and FAIL_UNTIL_ATTEMPT).
 * Allows the error sanitizer to distinguish controlled client error messages from internal exceptions.
 */
public class SimulatedTaskException extends RuntimeException {

    public SimulatedTaskException(String message) {
        super(message);
    }
}
