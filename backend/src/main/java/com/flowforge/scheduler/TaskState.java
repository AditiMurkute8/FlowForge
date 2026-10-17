package com.flowforge.scheduler;

/**
 * Execution states for an individual task in a workflow run.
 */
public enum TaskState {
    /**
     * Task is waiting for prerequisites to complete or waiting to be scheduled.
     */
    PENDING,

    /**
     * Task is actively executing on a worker thread.
     */
    RUNNING,

    /**
     * Task finished executing normally without throwing an exception.
     */
    COMPLETED,

    /**
     * Task threw an exception during execution.
     */
    FAILED,

    /**
     * Task was cancelled before running (due to prerequisite failure or workflow-level fail-fast).
     */
    CANCELLED
}
