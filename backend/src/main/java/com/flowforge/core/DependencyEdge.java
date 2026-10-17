package com.flowforge.core;

import java.util.Objects;

/**
 * Represents a directed dependency edge from a prerequisite task to a dependent task.
 * Execution order: source executes before target.
 *
 * @param source the prerequisite task ID
 * @param target the dependent task ID
 */
public record DependencyEdge(String source, String target) {

    public DependencyEdge {
        Objects.requireNonNull(source, "source task ID must not be null");
        Objects.requireNonNull(target, "target task ID must not be null");
        if (source.isBlank()) {
            throw new IllegalArgumentException("source task ID must not be blank");
        }
        if (target.isBlank()) {
            throw new IllegalArgumentException("target task ID must not be blank");
        }
    }
}
