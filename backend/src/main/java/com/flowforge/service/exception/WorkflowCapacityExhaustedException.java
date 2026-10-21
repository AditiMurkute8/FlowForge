package com.flowforge.service.exception;

/**
 * Thrown when workflow execution cannot be admitted because server capacity is exhausted.
 */
public class WorkflowCapacityExhaustedException extends RuntimeException {

    public WorkflowCapacityExhaustedException(String message) {
        super(message);
    }
}
