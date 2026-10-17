package com.flowforge.scheduler;

/**
 * Functional interface representing executable task behavior.
 * Allows checked exceptions to be thrown and captured by the scheduler.
 */
@FunctionalInterface
public interface TaskAction {

    /**
     * Executes the task action for the given task ID.
     *
     * @param taskId the ID of the task being executed
     * @throws Exception if task execution fails
     */
    void execute(String taskId) throws Exception;
}
