package com.flowforge.service.exception;

/**
 * Exception thrown when a requested resource (Project, Workflow, Version) cannot be found.
 * Mapped to HTTP 404 Not Found by RestExceptionHandler.
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }

    public ResourceNotFoundException(String message, Throwable cause) {
        super(message, cause);
    }
}
