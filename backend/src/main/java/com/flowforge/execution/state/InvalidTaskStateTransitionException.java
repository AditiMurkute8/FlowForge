package com.flowforge.execution.state;

/**
 * Exception thrown when an illegal state transition is requested on a task.
 */
public class InvalidTaskStateTransitionException extends RuntimeException {

    private final TaskState currentState;
    private final TaskState requestedState;

    public InvalidTaskStateTransitionException(TaskState currentState, TaskState requestedState) {
        super(String.format("Invalid task state transition: %s -> %s", currentState, requestedState));
        this.currentState = currentState;
        this.requestedState = requestedState;
    }

    public TaskState getCurrentState() {
        return currentState;
    }

    public TaskState getRequestedState() {
        return requestedState;
    }
}
