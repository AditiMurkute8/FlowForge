package com.flowforge.service.exception;

/**
 * Thrown when workflow execution exceeds its configured timeout deadline.
 */
public class WorkflowExecutionTimeoutException extends RuntimeException {

    public WorkflowExecutionTimeoutException(String message) {
        super(message);
    }

    public WorkflowExecutionTimeoutException(String message, Throwable cause) {
        super(message, cause);
    }
}
