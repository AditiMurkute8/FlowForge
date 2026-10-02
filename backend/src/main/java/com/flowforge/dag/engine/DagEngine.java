package com.flowforge.dag.engine;

import com.flowforge.dag.exception.CycleDetectedException;
import com.flowforge.dag.exception.InvalidDagException;
import com.flowforge.dag.model.Task;
import com.flowforge.dag.model.WorkflowDag;

import java.util.*;

/**
 * Deterministic DAG domain engine for FlowForge.
 * Responsible for graph validation, cycle detection using Kahn's algorithm,
 * topological ordering generation, and task readiness calculation.
 */
public class DagEngine {

    /**
     * Validates that the provided workflow graph is acyclic and structurally sound.
     * Throws an exception if any cycle or structural flaw is detected.
     *
     * @param dag the workflow DAG to validate
     * @throws CycleDetectedException if a cycle is detected in the graph
     * @throws InvalidDagException if the DAG is null or malformed
     */
    public void validate(WorkflowDag dag) {
        if (dag == null) {
            throw new InvalidDagException("Workflow DAG must not be null.");
        }
        computeTopologicalOrder(dag);
    }

    /**
     * Computes a valid topological ordering of tasks using Kahn's algorithm.
     * Guarantees deterministic node ordering by sorting ready nodes by task ID.
     *
     * Kahn's Algorithm Steps:
     * 1. Calculate/copy indegrees for every node in the graph.
     * 2. Add all nodes with 0 indegree to a queue (priority queue for determinism).
     * 3. Repeatedly dequeue a node and append it to the topological ordering.
     * 4. For every outgoing neighbor, decrement its indegree count.
     * 5. If a neighbor's indegree reaches zero, enqueue it.
     * 6. If total processed node count equals total node count, graph is acyclic.
     *    Otherwise, a cycle exists and an exception is thrown.
     *
     * @param dag the workflow graph
     * @return unmodifiable list of tasks in topological execution order
     * @throws CycleDetectedException if the graph contains a cycle
     */
    public List<Task> computeTopologicalOrder(WorkflowDag dag) {
        if (dag == null) {
            throw new InvalidDagException("Workflow DAG must not be null.");
        }

        Map<String, Integer> currentIndegrees = new HashMap<>(dag.getIndegrees());
        Map<String, Task> taskMap = dag.getTasks();

        // PriorityQueue guarantees deterministic processing order when multiple zero-indegree nodes exist
        Queue<String> readyQueue = new PriorityQueue<>();

        for (Map.Entry<String, Integer> entry : currentIndegrees.entrySet()) {
            if (entry.getValue() == 0) {
                readyQueue.offer(entry.getKey());
            }
        }

        List<Task> topologicalOrder = new ArrayList<>(taskMap.size());

        while (!readyQueue.isEmpty()) {
            String currentTaskId = readyQueue.poll();
            topologicalOrder.add(taskMap.get(currentTaskId));

            for (String neighborId : dag.getOutgoingNeighbors(currentTaskId)) {
                int updatedIndegree = currentIndegrees.get(neighborId) - 1;
                currentIndegrees.put(neighborId, updatedIndegree);

                if (updatedIndegree == 0) {
                    readyQueue.offer(neighborId);
                }
            }
        }

        if (topologicalOrder.size() != taskMap.size()) {
            Set<String> cycleInvolvedTaskIds = new HashSet<>();
            for (Map.Entry<String, Integer> entry : currentIndegrees.entrySet()) {
                if (entry.getValue() > 0) {
                    cycleInvolvedTaskIds.add(entry.getKey());
                }
            }
            throw new CycleDetectedException(
                    String.format("Cycle detected in workflow graph! Processed %d of %d nodes. Cycle-involved tasks: %s",
                            topologicalOrder.size(), taskMap.size(), cycleInvolvedTaskIds),
                    cycleInvolvedTaskIds
            );
        }

        return Collections.unmodifiableList(topologicalOrder);
    }

    /**
     * Identifies all tasks that are currently ready to execute given a set of completed task IDs.
     * A task is ready if:
     * 1. It has not already been completed.
     * 2. All of its prerequisite (incoming neighbor) tasks are contained in completedTaskIds.
     *
     * @param dag the workflow DAG
     * @param completedTaskIds set of task IDs that have already succeeded
     * @return unmodifiable set of ready tasks
     */
    public Set<Task> getReadyTasks(WorkflowDag dag, Set<String> completedTaskIds) {
        if (dag == null) {
            throw new InvalidDagException("Workflow DAG must not be null.");
        }
        Set<String> completed = completedTaskIds != null ? completedTaskIds : Collections.emptySet();

        Set<Task> readyTasks = new TreeSet<>();
        for (Task task : dag.getTasks().values()) {
            if (!completed.contains(task.getId())) {
                if (isTaskReady(dag, task.getId(), completed)) {
                    readyTasks.add(task);
                }
            }
        }
        return Collections.unmodifiableSet(readyTasks);
    }

    /**
     * Determines whether a specific task is ready to execute given the set of completed task IDs.
     *
     * @param dag the workflow DAG
     * @param taskId the target task ID to check
     * @param completedTaskIds set of completed task IDs
     * @return true if all prerequisites for taskId are in completedTaskIds, false otherwise
     */
    public boolean isTaskReady(WorkflowDag dag, String taskId, Set<String> completedTaskIds) {
        if (dag == null) {
            throw new InvalidDagException("Workflow DAG must not be null.");
        }
        if (!dag.hasTask(taskId)) {
            throw new InvalidDagException("Task ID not found in DAG: " + taskId);
        }
        Set<String> completed = completedTaskIds != null ? completedTaskIds : Collections.emptySet();
        Set<String> prerequisites = dag.getPrerequisites(taskId);

        return completed.containsAll(prerequisites);
    }
}
