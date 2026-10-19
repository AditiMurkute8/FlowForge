package com.flowforge.api;

import com.flowforge.api.dto.ApiErrorResponse;
import com.flowforge.core.InvalidDagException;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
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

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiErrorResponse> handleNotFound(ResourceNotFoundException e) {
        log.warn("Resource not found: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ApiErrorResponse(
                404,
                "Not Found",
                e.getMessage(),
                Instant.now(),
                Collections.emptyList()
            ));
    }

    @ExceptionHandler(ResourceConflictException.class)
    public ResponseEntity<ApiErrorResponse> handleConflict(ResourceConflictException e) {
        log.warn("Resource conflict: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(new ApiErrorResponse(
                409,
                "Conflict",
                e.getMessage(),
                Instant.now(),
                Collections.emptyList()
            ));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleDataIntegrity(DataIntegrityViolationException e) {
        Throwable cause = e.getMostSpecificCause();
        String msg = cause != null ? cause.getMessage() : e.getMessage();
        log.warn("Database constraint violation: {}", msg);

        String sqlState = null;
        String constraint = null;
        String detail = null;

        if (cause instanceof java.sql.SQLException sqlEx) {
            sqlState = sqlEx.getSQLState();
            try {
                java.lang.reflect.Method getServerError = cause.getClass().getMethod("getServerErrorMessage");
                Object serverError = getServerError.invoke(cause);
                if (serverError != null) {
                    java.lang.reflect.Method getConstraint = serverError.getClass().getMethod("getConstraint");
                    constraint = (String) getConstraint.invoke(serverError);
                    java.lang.reflect.Method getDetail = serverError.getClass().getMethod("getDetail");
                    detail = (String) getDetail.invoke(serverError);
                }
            } catch (Exception ignored) {
                // Graceful fallback to SQLSTATE and message matching
            }
        }

        // 1. Workflow Version Immutability (PL/pgSQL trigger RAISE EXCEPTION: SQLSTATE P0001)
        if ("P0001".equals(sqlState) || (msg != null && (
                msg.contains("Workflow versions are immutable")
                || msg.contains("enforce_workflow_version_immutability")
                || msg.contains("enforce_workflow_version_no_delete")
        ))) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiErrorResponse(409, "Conflict", "Workflow versions are permanent and immutable", Instant.now(), Collections.emptyList()));
        }

        // 2. Unique Constraint Violations (SQLSTATE 23505)
        if ("23505".equals(sqlState) || (constraint != null && constraint.startsWith("uq_")) || (msg != null && msg.contains("uq_"))) {
            if ("uq_projects_slug".equals(constraint) || (msg != null && msg.contains("uq_projects_slug"))) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(new ApiErrorResponse(409, "Conflict", "A project with this slug already exists", Instant.now(), Collections.emptyList()));
            }
            if ("uq_workflows_project_slug".equals(constraint) || (msg != null && msg.contains("uq_workflows_project_slug"))) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(new ApiErrorResponse(409, "Conflict", "A workflow with this slug already exists in this project", Instant.now(), Collections.emptyList()));
            }
            if ("uq_workflow_versions_number".equals(constraint) || (msg != null && msg.contains("uq_workflow_versions_number"))) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(new ApiErrorResponse(409, "Conflict", "A version with this number already exists for this workflow", Instant.now(), Collections.emptyList()));
            }
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiErrorResponse(409, "Conflict", "Resource uniqueness constraint violation", Instant.now(), Collections.emptyList()));
        }

        // 3. Foreign Key Violations (SQLSTATE 23503)
        // Distinguish missing referenced parent from restricted deletion
        if ("23503".equals(sqlState) || (constraint != null && constraint.startsWith("fk_")) || (msg != null && msg.contains("fk_"))) {
            boolean isMissingParent = (detail != null && detail.contains("is not present in table"))
                    || (msg != null && (msg.contains("is not present in table") || msg.contains("insert or update on table")));
            if (isMissingParent) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(404, "Not Found", "Referenced parent resource does not exist", Instant.now(), Collections.emptyList()));
            }
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiErrorResponse(409, "Conflict", "Cannot delete or modify resource because active dependent records exist", Instant.now(), Collections.emptyList()));
        }

        // 4. Schema Constraint Violations (NOT NULL: 23502, Check constraint: 23514)
        if ("23502".equals(sqlState) || "23514".equals(sqlState) || (msg != null && (msg.contains("null value in column") || msg.contains("violates check constraint")))) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ApiErrorResponse(400, "Bad Request", "Database constraint validation failed", Instant.now(), Collections.emptyList()));
        }

        // 5. Unrecognized persistence failures -> Generic 500 without leaking raw DB details
        log.error("Unhandled persistence data integrity exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ApiErrorResponse(500, "Internal Server Error", "A persistence error occurred while processing the request", Instant.now(), Collections.emptyList()));
    }

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
        List<String> details = e.getBindingResult().getFieldErrors().stream()
                .map(err -> err.getField() + ": " + err.getDefaultMessage())
                .toList();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ApiErrorResponse(
                400,
                "Bad Request",
                "Invalid request parameters",
                Instant.now(),
                details
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
