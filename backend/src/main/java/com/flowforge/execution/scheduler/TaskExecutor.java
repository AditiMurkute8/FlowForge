package com.flowforge.execution.scheduler;

import com.flowforge.dag.model.Task;

/**
 * Abstraction for executing a single workflow task.
 */
public interface TaskExecutor {

    /**
     * Executes the given task and returns its completion result.
     *
     * @param task the task to execute (must not be null)
     * @return completion result (SUCCESS or FAILURE)
     */
    TaskExecutionResult execute(Task task);
}
