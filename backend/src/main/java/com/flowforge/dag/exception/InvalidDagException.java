package com.flowforge.dag.exception;

/**
 * Exception thrown when a DAG definition is invalid (e.g., missing referenced tasks,
 * duplicate identifiers, or malformed dependencies).
 */
public class InvalidDagException extends RuntimeException {

    public InvalidDagException(String message) {
        super(message);
    }

    public InvalidDagException(String message, Throwable cause) {
        super(message, cause);
    }
}
