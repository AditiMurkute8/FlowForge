package com.flowforge.api;

import java.util.Collections;
import java.util.List;

/**
 * Sanitizes task exceptions into safe public API strings.
 * Preserves specific validated messages only for simulated task exceptions,
 * and masks all unexpected internal exceptions with a generic failure message.
 */
public final class TaskErrorSanitizer {

    private static final String DEFAULT_TASK_FAILURE_MESSAGE = "Task execution failed";
    private static final String INTERRUPTED_TASK_MESSAGE = "Task execution was interrupted";
    private static final int MAX_MESSAGE_LENGTH = 255;

    private TaskErrorSanitizer() {
    }

    /**
     * Converts a task throwable into a safe, bounded public error message.
     *
     * @param t the throwable captured during task execution
     * @return sanitized string message, or null if throwable is null
     */
    public static String sanitize(Throwable t) {
        if (t == null) {
            return null;
        }
        if (t instanceof SimulatedTaskException) {
            String msg = t.getMessage();
            if (msg == null || msg.isBlank()) {
                return "Simulated task failure";
            }
            return msg.length() > MAX_MESSAGE_LENGTH ? msg.substring(0, MAX_MESSAGE_LENGTH) : msg;
        }
        if (t instanceof InterruptedException) {
            return INTERRUPTED_TASK_MESSAGE;
        }
        return DEFAULT_TASK_FAILURE_MESSAGE;
    }

    /**
     * Sanitizes a chronological list of attempt exceptions.
     *
     * @param errors list of exceptions across attempts
     * @return immutable list of sanitized error strings
     */
    public static List<String> sanitizeAll(List<Throwable> errors) {
        if (errors == null || errors.isEmpty()) {
            return Collections.emptyList();
        }
        return errors.stream().map(TaskErrorSanitizer::sanitize).toList();
    }
}
