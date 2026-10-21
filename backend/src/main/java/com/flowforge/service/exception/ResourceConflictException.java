package com.flowforge.service.exception;

/**
 * Exception thrown when an operation conflicts with current resource state (e.g. duplicate slug).
 * Mapped to HTTP 409 Conflict by RestExceptionHandler.
 */
public class ResourceConflictException extends RuntimeException {

    public ResourceConflictException(String message) {
        super(message);
    }

    public ResourceConflictException(String message, Throwable cause) {
        super(message, cause);
    }
}
