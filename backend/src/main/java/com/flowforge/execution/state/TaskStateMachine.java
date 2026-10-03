package com.flowforge.execution.state;

import java.util.*;

/**
 * Validates and enforces task state transitions for FlowForge task execution.
 * Stateless and deterministic domain component.
 */
public class TaskStateMachine {

    private static final Map<TaskState, Set<TaskState>> ALLOWED_TRANSITIONS;

    static {
        Map<TaskState, Set<TaskState>> map = new EnumMap<>(TaskState.class);
        map.put(TaskState.PENDING, Set.of(TaskState.READY, TaskState.CANCELLED));
        map.put(TaskState.READY, Set.of(TaskState.RUNNING, TaskState.CANCELLED));
        map.put(TaskState.RUNNING, Set.of(TaskState.SUCCESS, TaskState.FAILED, TaskState.CANCELLED));
        map.put(TaskState.FAILED, Set.of(TaskState.RETRYING, TaskState.DEAD_LETTER));
        map.put(TaskState.RETRYING, Set.of(TaskState.RUNNING));
        map.put(TaskState.SUCCESS, Collections.emptySet());
        map.put(TaskState.DEAD_LETTER, Collections.emptySet());
        map.put(TaskState.CANCELLED, Collections.emptySet());

        ALLOWED_TRANSITIONS = Collections.unmodifiableMap(map);
    }

    /**
     * Checks if a transition from currentState to requestedState is allowed.
     *
     * @param currentState the current state of the task
     * @param requestedState the desired target state
     * @return true if the transition is allowed, false otherwise
     */
    public boolean isValidTransition(TaskState currentState, TaskState requestedState) {
        if (currentState == null || requestedState == null) {
            return false;
        }
        Set<TaskState> validNextStates = ALLOWED_TRANSITIONS.get(currentState);
        return validNextStates != null && validNextStates.contains(requestedState);
    }

    /**
     * Validates and performs a task state transition.
     *
     * @param currentState the current task state
     * @param requestedState the desired target state
     * @return the requestedState if the transition is valid
     * @throws InvalidTaskStateTransitionException if the transition is not allowed
     * @throws IllegalArgumentException if either state is null
     */
    public TaskState transition(TaskState currentState, TaskState requestedState) {
        if (currentState == null || requestedState == null) {
            throw new IllegalArgumentException("Current state and requested state must not be null.");
        }

        if (!isValidTransition(currentState, requestedState)) {
            throw new InvalidTaskStateTransitionException(currentState, requestedState);
        }

        return requestedState;
    }

    /**
     * Returns an unmodifiable set of all valid target states accessible from currentState.
     *
     * @param currentState the state to inspect
     * @return unmodifiable set of allowed next states
     */
    public Set<TaskState> getValidNextStates(TaskState currentState) {
        if (currentState == null) {
            return Collections.emptySet();
        }
        return ALLOWED_TRANSITIONS.getOrDefault(currentState, Collections.emptySet());
    }
}
