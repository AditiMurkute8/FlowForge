package com.flowforge.dag.model;

import com.flowforge.dag.exception.InvalidDagException;

import java.util.*;

/**
 * Immutable directed acyclic graph (DAG) structure representing workflow tasks and dependencies.
 * Maintains task definitions, adjacency lists (outgoing edges), reverse adjacency lists (incoming edges),
 * and node indegree counts.
 */
public final class WorkflowDag {

    private final Map<String, Task> tasks;
    private final Set<TaskDependency> dependencies;
    private final Map<String, Set<String>> adjacencyList;
    private final Map<String, Set<String>> reverseAdjacencyList;
    private final Map<String, Integer> indegrees;

    public WorkflowDag(Collection<Task> tasks, Collection<TaskDependency> dependencies) {
        if (tasks == null) {
            throw new InvalidDagException("Task collection must not be null.");
        }

        Map<String, Task> taskMap = new LinkedHashMap<>();
        for (Task task : tasks) {
            if (task == null) {
                throw new InvalidDagException("Task in collection must not be null.");
            }
            if (taskMap.containsKey(task.getId())) {
                throw new InvalidDagException("Duplicate task ID found in workflow: " + task.getId());
            }
            taskMap.put(task.getId(), task);
        }
        this.tasks = Collections.unmodifiableMap(taskMap);

        Map<String, Set<String>> adj = new LinkedHashMap<>();
        Map<String, Set<String>> revAdj = new LinkedHashMap<>();
        Map<String, Integer> indeg = new LinkedHashMap<>();

        for (String taskId : this.tasks.keySet()) {
            adj.put(taskId, new TreeSet<>());
            revAdj.put(taskId, new TreeSet<>());
            indeg.put(taskId, 0);
        }

        Set<TaskDependency> depSet = new LinkedHashSet<>();
        if (dependencies != null) {
            for (TaskDependency dep : dependencies) {
                if (dep == null) {
                    throw new InvalidDagException("Dependency edge must not be null.");
                }
                String source = dep.getSourceTaskId();
                String target = dep.getTargetTaskId();

                if (!this.tasks.containsKey(source)) {
                    throw new InvalidDagException("Dependency references unknown source task ID: " + source);
                }
                if (!this.tasks.containsKey(target)) {
                    throw new InvalidDagException("Dependency references unknown target task ID: " + target);
                }

                boolean added = adj.get(source).add(target);
                if (added) {
                    revAdj.get(target).add(source);
                    indeg.put(target, indeg.get(target) + 1);
                    depSet.add(dep);
                }
            }
        }

        this.dependencies = Collections.unmodifiableSet(depSet);

        Map<String, Set<String>> unmodAdj = new LinkedHashMap<>();
        for (Map.Entry<String, Set<String>> entry : adj.entrySet()) {
            unmodAdj.put(entry.getKey(), Collections.unmodifiableSet(entry.getValue()));
        }
        this.adjacencyList = Collections.unmodifiableMap(unmodAdj);

        Map<String, Set<String>> unmodRevAdj = new LinkedHashMap<>();
        for (Map.Entry<String, Set<String>> entry : revAdj.entrySet()) {
            unmodRevAdj.put(entry.getKey(), Collections.unmodifiableSet(entry.getValue()));
        }
        this.reverseAdjacencyList = Collections.unmodifiableMap(unmodRevAdj);

        this.indegrees = Collections.unmodifiableMap(indeg);
    }

    public Map<String, Task> getTasks() {
        return tasks;
    }

    public Task getTask(String taskId) {
        return tasks.get(taskId);
    }

    public boolean hasTask(String taskId) {
        return tasks.containsKey(taskId);
    }

    public Set<TaskDependency> getDependencies() {
        return dependencies;
    }

    public Map<String, Set<String>> getAdjacencyList() {
        return adjacencyList;
    }

    public Map<String, Set<String>> getReverseAdjacencyList() {
        return reverseAdjacencyList;
    }

    public Map<String, Integer> getIndegrees() {
        return indegrees;
    }

    public Set<String> getOutgoingNeighbors(String taskId) {
        Set<String> neighbors = adjacencyList.get(taskId);
        return neighbors != null ? neighbors : Collections.emptySet();
    }

    public Set<String> getPrerequisites(String taskId) {
        Set<String> prereqs = reverseAdjacencyList.get(taskId);
        return prereqs != null ? prereqs : Collections.emptySet();
    }

    /**
     * Returns all tasks that have 0 prerequisites (indegree == 0).
     */
    public Set<Task> getInitialReadyTasks() {
        Set<Task> ready = new TreeSet<>();
        for (Map.Entry<String, Integer> entry : indegrees.entrySet()) {
            if (entry.getValue() == 0) {
                ready.add(tasks.get(entry.getKey()));
            }
        }
        return Collections.unmodifiableSet(ready);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private final Map<String, Task> tasks = new LinkedHashMap<>();
        private final Set<TaskDependency> dependencies = new LinkedHashSet<>();

        public Builder addTask(Task task) {
            if (task == null) {
                throw new InvalidDagException("Task must not be null.");
            }
            if (tasks.containsKey(task.getId())) {
                throw new InvalidDagException("Duplicate task ID in builder: " + task.getId());
            }
            tasks.put(task.getId(), task);
            return this;
        }

        public Builder addTask(String id) {
            return addTask(new Task(id));
        }

        public Builder addTask(String id, String name) {
            return addTask(new Task(id, name));
        }

        public Builder addDependency(String sourceTaskId, String targetTaskId) {
            dependencies.add(new TaskDependency(sourceTaskId, targetTaskId));
            return this;
        }

        public Builder addDependency(TaskDependency dependency) {
            if (dependency == null) {
                throw new InvalidDagException("Dependency must not be null.");
            }
            dependencies.add(dependency);
            return this;
        }

        public WorkflowDag build() {
            return new WorkflowDag(tasks.values(), dependencies);
        }
    }
}
