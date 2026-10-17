package com.flowforge.api;

import com.flowforge.api.dto.ApiErrorResponse;
import com.flowforge.core.InvalidDagException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Collections;
import java.util.List;

/**
 * Global exception handler providing safe, standardized error envelopes without leaking internal details.
 */
@RestControllerAdvice
public class RestExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(RestExceptionHandler.class);

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleNotReadable(HttpMessageNotReadableException e) {
        log.warn("Malformed JSON payload: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ApiErrorResponse(
                400,
                "Bad Request",
                "Malformed JSON request payload",
                Instant.now(),
                Collections.emptyList()
            ));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        log.warn("Validation error: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ApiErrorResponse(
                400,
                "Bad Request",
                e.getMessage(),
                Instant.now(),
                Collections.emptyList()
            ));
    }

    @ExceptionHandler(InvalidDagException.class)
    public ResponseEntity<ApiErrorResponse> handleInvalidDag(InvalidDagException e) {
        log.warn("Invalid DAG submitted: {}", e.getMessage());
        List<String> details = e.getValidationResult() != null ? e.getValidationResult().errors() : Collections.emptyList();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ApiErrorResponse(
                400,
                "Bad Request",
                e.getMessage(),
                Instant.now(),
                details
            ));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException e) {
        log.warn("Constraint validation error: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ApiErrorResponse(
                400,
                "Bad Request",
                "Invalid request parameters",
                Instant.now(),
                Collections.emptyList()
            ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleGeneric(Exception e) {
        log.error("Unhandled server error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ApiErrorResponse(
                500,
                "Internal Server Error",
                "An unexpected internal error occurred while executing the workflow",
                Instant.now(),
                Collections.emptyList()
            ));
    }
}
