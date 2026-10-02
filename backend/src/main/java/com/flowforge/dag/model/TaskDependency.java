package com.flowforge.dag.model;

import java.util.Objects;

/**
 * Represents a directed dependency edge from sourceTaskId to targetTaskId.
 * Interpretation: sourceTaskId must execute BEFORE targetTaskId.
 */
public final class TaskDependency {

    private final String sourceTaskId;
    private final String targetTaskId;

    public TaskDependency(String sourceTaskId, String targetTaskId) {
        if (sourceTaskId == null || sourceTaskId.trim().isEmpty()) {
            throw new IllegalArgumentException("Source task ID must not be null or empty.");
        }
        if (targetTaskId == null || targetTaskId.trim().isEmpty()) {
            throw new IllegalArgumentException("Target task ID must not be null or empty.");
        }
        this.sourceTaskId = sourceTaskId.trim();
        this.targetTaskId = targetTaskId.trim();
    }

    public String getSourceTaskId() {
        return sourceTaskId;
    }

    public String getTargetTaskId() {
        return targetTaskId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TaskDependency edge = (TaskDependency) o;
        return Objects.equals(sourceTaskId, edge.sourceTaskId) &&
               Objects.equals(targetTaskId, edge.targetTaskId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sourceTaskId, targetTaskId);
    }

    @Override
    public String toString() {
        return sourceTaskId + " -> " + targetTaskId;
    }
}
