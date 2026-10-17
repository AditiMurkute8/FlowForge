package com.flowforge.scheduler;

/**
 * Execution states for an entire workflow run.
 */
public enum WorkflowRunState {
    /**
     * Workflow has been submitted but no tasks have begun running.
     */
    PENDING,

    /**
     * At least one task is currently running or scheduled.
     */
    RUNNING,

    /**
     * All tasks in the workflow completed successfully.
     */
    COMPLETED,

    /**
     * At least one task in the workflow failed.
     */
    FAILED
}
