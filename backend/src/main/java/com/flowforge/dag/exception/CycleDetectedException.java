package com.flowforge.dag.exception;

import java.util.Collections;
import java.util.Set;

/**
 * Exception thrown when Kahn's algorithm detects a cycle in the workflow graph.
 */
public class CycleDetectedException extends InvalidDagException {

    private final Set<String> cycleInvolvedTaskIds;

    public CycleDetectedException(String message) {
        this(message, Collections.emptySet());
    }

    public CycleDetectedException(String message, Set<String> cycleInvolvedTaskIds) {
        super(message);
        this.cycleInvolvedTaskIds = cycleInvolvedTaskIds != null ?
                Collections.unmodifiableSet(cycleInvolvedTaskIds) : Collections.emptySet();
    }

    /**
     * Returns the set of task IDs that could not be processed due to participating in or depending on a cycle.
     */
    public Set<String> getCycleInvolvedTaskIds() {
        return cycleInvolvedTaskIds;
    }
}
