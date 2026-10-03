package com.flowforge.execution.state;

/**
 * Represents the lifecycle state of a task in FlowForge.
 */
public enum TaskState {
    /** Task is created but waiting for dependency prerequisites to complete. */
    PENDING,

    /** Task prerequisites are fully met; eligible for execution. */
    READY,

    /** Task is currently being processed by a worker. */
    RUNNING,

    /** Task completed successfully. */
    SUCCESS,

    /** Task execution failed and needs retry evaluation or terminal handling. */
    FAILED,

    /** Task is queued for re-attempt after failure. */
    RETRYING,

    /** Task exceeded max retries or encountered unrecoverable failure. */
    DEAD_LETTER,

    /** Task was manually or transitively cancelled. */
    CANCELLED
}
