package com.flowforge.core;

import java.util.Objects;

/**
 * Exception thrown when topological ordering is requested on an invalid directed graph.
 */
public class InvalidDagException extends RuntimeException {

    private final DagValidationResult validationResult;

    public InvalidDagException(String message, DagValidationResult validationResult) {
        super(message);
        this.validationResult = Objects.requireNonNull(validationResult, "validationResult must not be null");
    }

    public DagValidationResult getValidationResult() {
        return validationResult;
    }
}
