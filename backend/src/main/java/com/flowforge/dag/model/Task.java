package com.flowforge.dag.model;

import java.util.Objects;

/**
 * Represents a single workflow task in the DAG.
 * Intentionally minimal domain model for Phase 1 DAG validation.
 */
public final class Task implements Comparable<Task> {

    private final String id;
    private final String name;

    public Task(String id) {
        this(id, id);
    }

    public Task(String id, String name) {
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("Task ID must not be null or empty.");
        }
        this.id = id.trim();
        this.name = (name != null && !name.trim().isEmpty()) ? name.trim() : this.id;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Task task = (Task) o;
        return Objects.equals(id, task.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public int compareTo(Task other) {
        return this.id.compareTo(other.id);
    }

    @Override
    public String toString() {
        return "Task{id='" + id + "', name='" + name + "'}";
    }
}
