package com.flowforge.scheduler;

import java.util.*;

/**
 * Registry holding task actions mapped by task ID.
 * Rejects missing task actions before any execution begins.
 */
public final class TaskRegistry {

    private final Map<String, TaskAction> actions = new HashMap<>();
    private final Map<String, RetryPolicy> retryPolicies = new HashMap<>();

    public TaskRegistry() {
    }

    /**
     * Registers an action for the specified task ID with default no-retry policy.
     *
     * @param taskId the task ID
     * @param action the action to execute
     * @return this registry instance for fluent chaining
     */
    public TaskRegistry register(String taskId, TaskAction action) {
        return register(taskId, action, RetryPolicy.none());
    }

    /**
     * Registers an action and retry policy for the specified task ID.
     *
     * @param taskId the task ID
     * @param action the action to execute
     * @param retryPolicy the retry policy to apply upon failure
     * @return this registry instance for fluent chaining
     */
    public TaskRegistry register(String taskId, TaskAction action, RetryPolicy retryPolicy) {
        Objects.requireNonNull(taskId, "taskId must not be null");
        if (taskId.isBlank()) {
            throw new IllegalArgumentException("taskId must not be blank");
        }
        Objects.requireNonNull(action, "action must not be null");
        Objects.requireNonNull(retryPolicy, "retryPolicy must not be null");
        actions.put(taskId, action);
        retryPolicies.put(taskId, retryPolicy);
        return this;
    }

    /**
     * Retrieves the retry policy registered for the given task ID.
     * Defaults to RetryPolicy.none() if no explicit policy was registered.
     *
     * @param taskId the task ID
     * @return the configured retry policy
     */
    public RetryPolicy getRetryPolicy(String taskId) {
        return retryPolicies.getOrDefault(taskId, RetryPolicy.none());
    }

    /**
     * Retrieves the task action registered for the given task ID.
     *
     * @param taskId the task ID
     * @return the registered action, or null if not registered
     */
    public TaskAction get(String taskId) {
        return actions.get(taskId);
    }

    /**
     * Checks if an action is registered for the given task ID.
     *
     * @param taskId the task ID
     * @return true if registered, false otherwise
     */
    public boolean contains(String taskId) {
        return actions.containsKey(taskId);
    }

    /**
     * Validates that every task ID in the collection has a registered action.
     *
     * @param taskIds the task IDs to validate
     * @throws IllegalStateException if any task ID does not have a registered action
     */
    public void validateAllTasksRegistered(Collection<String> taskIds) {
        Objects.requireNonNull(taskIds, "taskIds must not be null");
        List<String> missing = new ArrayList<>();
        for (String id : taskIds) {
            if (!actions.containsKey(id)) {
                missing.add(id);
            }
        }
        if (!missing.isEmpty()) {
            Collections.sort(missing);
            throw new IllegalStateException("Missing task action(s) for task(s): " + String.join(", ", missing));
        }
    }
}
