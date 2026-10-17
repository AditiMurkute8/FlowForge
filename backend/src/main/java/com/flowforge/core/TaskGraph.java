package com.flowforge.core;

import java.util.Collection;
import java.util.List;
import java.util.Objects;

/**
 * Immutable representation of a workflow graph containing task IDs and dependency edges.
 * Task IDs and edges must be non-null, and task IDs must not be blank.
 */
public record TaskGraph(List<String> taskIds, List<DependencyEdge> edges) {

    public TaskGraph {
        Objects.requireNonNull(taskIds, "taskIds must not be null");
        Objects.requireNonNull(edges, "edges must not be null");
        for (String id : taskIds) {
            Objects.requireNonNull(id, "task ID must not be null");
            if (id.isBlank()) {
                throw new IllegalArgumentException("task ID must not be blank");
            }
        }
        for (DependencyEdge edge : edges) {
            Objects.requireNonNull(edge, "dependency edge must not be null");
        }
        taskIds = List.copyOf(taskIds);
        edges = List.copyOf(edges);
    }

    public static TaskGraph of(Collection<String> taskIds, Collection<DependencyEdge> edges) {
        Objects.requireNonNull(taskIds, "taskIds must not be null");
        Objects.requireNonNull(edges, "edges must not be null");
        for (String id : taskIds) {
            Objects.requireNonNull(id, "task ID must not be null");
            if (id.isBlank()) {
                throw new IllegalArgumentException("task ID must not be blank");
            }
        }
        for (DependencyEdge edge : edges) {
            Objects.requireNonNull(edge, "dependency edge must not be null");
        }
        return new TaskGraph(List.copyOf(taskIds), List.copyOf(edges));
    }

    public static TaskGraph empty() {
        return new TaskGraph(List.of(), List.of());
    }
}
