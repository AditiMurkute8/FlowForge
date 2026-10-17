package com.flowforge.api;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class TaskErrorSanitizerTest {

    @Test
    @DisplayName("Null exception sanitizes to null")
    void nullException() {
        assertThat(TaskErrorSanitizer.sanitize(null)).isNull();
    }

    @Test
    @DisplayName("SimulatedTaskException preserves allowed message")
    void simulatedTaskExceptionPreserved() {
        String msg = "Custom allowable error";
        assertThat(TaskErrorSanitizer.sanitize(new SimulatedTaskException(msg))).isEqualTo(msg);
    }

    @Test
    @DisplayName("SimulatedTaskException truncates messages exceeding 255 chars")
    void simulatedTaskExceptionTruncates() {
        String longMsg = "X".repeat(300);
        String sanitized = TaskErrorSanitizer.sanitize(new SimulatedTaskException(longMsg));
        assertThat(sanitized).hasSize(255).isEqualTo("X".repeat(255));
    }

    @Test
    @DisplayName("SimulatedTaskException with null or blank message falls back to default")
    void simulatedTaskExceptionBlank() {
        assertThat(TaskErrorSanitizer.sanitize(new SimulatedTaskException(null))).isEqualTo("Simulated task failure");
        assertThat(TaskErrorSanitizer.sanitize(new SimulatedTaskException("   "))).isEqualTo("Simulated task failure");
    }

    @Test
    @DisplayName("InterruptedException maps to interrupted message")
    void interruptedTaskException() {
        assertThat(TaskErrorSanitizer.sanitize(new InterruptedException())).isEqualTo("Task execution was interrupted");
    }

    @Test
    @DisplayName("Unexpected internal exceptions are masked with generic message")
    void unexpectedExceptionsMasked() {
        assertThat(TaskErrorSanitizer.sanitize(new RuntimeException("secret db credentials or internal stack")))
            .isEqualTo("Task execution failed");
        assertThat(TaskErrorSanitizer.sanitize(new NullPointerException("null pointer in internal class Foo")))
            .isEqualTo("Task execution failed");
        assertThat(TaskErrorSanitizer.sanitize(new IOException("file /etc/passwd not found")))
            .isEqualTo("Task execution failed");
    }

    @Test
    @DisplayName("sanitizeAll correctly processes lists and empty lists")
    void sanitizeAllList() {
        assertThat(TaskErrorSanitizer.sanitizeAll(null)).isEmpty();
        assertThat(TaskErrorSanitizer.sanitizeAll(List.of())).isEmpty();

        List<Throwable> errors = List.of(
            new SimulatedTaskException("Attempt 1 failed"),
            new RuntimeException("Attempt 2 internal error"),
            new InterruptedException()
        );

        List<String> sanitized = TaskErrorSanitizer.sanitizeAll(errors);
        assertThat(sanitized).containsExactly(
            "Attempt 1 failed",
            "Task execution failed",
            "Task execution was interrupted"
        );
    }
}
