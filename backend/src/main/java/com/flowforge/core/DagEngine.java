package com.flowforge.core;

import java.util.*;

/**
 * Pure Java DAG validation and deterministic topological sorting engine.
 * Thread-safe and independent of any web, database, or framework dependencies.
 */
public final class DagEngine {

    private static final int WHITE = 0; // Unvisited
    private static final int GRAY = 1;  // Currently visiting (in current recursion path)
    private static final int BLACK = 2; // Fully processed

    private DagEngine() {
        // Static utility class
    }

    /**
     * Validates that a graph is a valid Directed Acyclic Graph (DAG).
     *
     * @param graph the task graph to validate
     * @return validation result containing validity status, errors, warnings, and cycle nodes
     */
    public static DagValidationResult validate(TaskGraph graph) {
        Objects.requireNonNull(graph, "graph must not be null");

        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Set<String> cycleNodesSet = new TreeSet<>();

        if (graph.taskIds().isEmpty() && graph.edges().isEmpty()) {
            warnings.add("Workflow contains no tasks.");
            return new DagValidationResult(true, false, List.of(), warnings, List.of(), List.of());
        }

        // 1. Check for duplicate task IDs
        Set<String> uniqueTasks = new TreeSet<>();
        Set<String> duplicateTasks = new TreeSet<>();
        for (String id : graph.taskIds()) {
            if (!uniqueTasks.add(id)) {
                duplicateTasks.add(id);
            }
        }
        if (!duplicateTasks.isEmpty()) {
            for (String dup : duplicateTasks) {
                errors.add("Duplicate task ID detected: " + dup);
            }
        }

        // 2. Check for duplicate dependency edges
        Set<DependencyEdge> seenEdges = new HashSet<>();
        Set<String> duplicateEdges = new TreeSet<>();
        for (DependencyEdge edge : graph.edges()) {
            if (!seenEdges.add(edge)) {
                duplicateEdges.add(edge.source() + " -> " + edge.target());
            }
        }
        if (!duplicateEdges.isEmpty()) {
            for (String dup : duplicateEdges) {
                errors.add("Duplicate dependency edge detected: " + dup);
            }
        }

        // 3. Build adjacency list and in/out degrees, validating edge references
        Map<String, List<String>> adj = new TreeMap<>();
        Map<String, Integer> inDegree = new TreeMap<>();
        Map<String, Integer> outDegree = new TreeMap<>();

        for (String id : uniqueTasks) {
            adj.put(id, new ArrayList<>());
            inDegree.put(id, 0);
            outDegree.put(id, 0);
        }

        Set<DependencyEdge> uniqueEdges = new HashSet<>();
        for (DependencyEdge edge : graph.edges()) {
            if (!uniqueEdges.add(edge)) {
                continue;
            }

            boolean sourceKnown = uniqueTasks.contains(edge.source());
            boolean targetKnown = uniqueTasks.contains(edge.target());

            if (!sourceKnown || !targetKnown) {
                errors.add("Edge references unknown task: " + edge.source() + " -> " + edge.target());
                continue;
            }

            if (edge.source().equals(edge.target())) {
                errors.add("Self-loop detected on task: " + edge.source());
                cycleNodesSet.add(edge.source());
                continue;
            }

            adj.get(edge.source()).add(edge.target());
            outDegree.put(edge.source(), outDegree.get(edge.source()) + 1);
            inDegree.put(edge.target(), inDegree.get(edge.target()) + 1);
        }

        // Sort adjacency lists for deterministic DFS traversal
        for (List<String> neighbors : adj.values()) {
            Collections.sort(neighbors);
        }

        // 4. 3-Color DFS Cycle Detection
        Map<String, Integer> colors = new HashMap<>();
        for (String id : uniqueTasks) {
            colors.put(id, WHITE);
        }

        for (String id : uniqueTasks) {
            if (colors.get(id) == WHITE) {
                iterativeDfs(id, adj, colors, cycleNodesSet, errors);
            }
        }

        // 5. Identify disconnected nodes in a multi-task graph
        List<String> disconnectedNodes = new ArrayList<>();
        if (uniqueTasks.size() > 1) {
            for (String id : uniqueTasks) {
                if (inDegree.get(id) == 0 && outDegree.get(id) == 0) {
                    disconnectedNodes.add(id);
                    warnings.add("Task \"" + id + "\" is isolated and not connected to any pipeline flow.");
                }
            }
        }

        boolean hasCycle = !cycleNodesSet.isEmpty();
        boolean isValid = errors.isEmpty() && !hasCycle;

        return new DagValidationResult(
            isValid,
            hasCycle,
            List.copyOf(errors),
            List.copyOf(warnings),
            List.copyOf(cycleNodesSet),
            List.copyOf(disconnectedNodes)
        );
    }

    /**
     * Convenience method validating tasks and edges directly.
     */
    public static DagValidationResult validate(Collection<String> taskIds, Collection<DependencyEdge> edges) {
        return validate(TaskGraph.of(taskIds, edges));
    }

    /**
     * Returns a deterministic topological ordering of task IDs using Kahn's algorithm.
     * Every dependency will appear before any task that depends on it.
     * Independent tasks are ordered deterministically using lexicographical tie-breaking.
     *
     * @param graph the task graph to sort
     * @return an immutable list of task IDs in topological execution order
     * @throws InvalidDagException if the graph contains cycles, duplicate tasks, or missing task references
     */
    public static List<String> topologicalSort(TaskGraph graph) {
        Objects.requireNonNull(graph, "graph must not be null");

        DagValidationResult validation = validate(graph);
        if (!validation.isValid()) {
            throw new InvalidDagException(
                "Cannot topologically sort invalid DAG: " + String.join("; ", validation.errors()),
                validation
            );
        }

        if (graph.taskIds().isEmpty()) {
            return List.of();
        }

        // Build in-degree counts and adjacency mapping
        Map<String, Integer> inDegree = new HashMap<>();
        Map<String, List<String>> adj = new HashMap<>();
        for (String id : graph.taskIds()) {
            inDegree.put(id, 0);
            adj.put(id, new ArrayList<>());
        }

        for (DependencyEdge edge : graph.edges()) {
            adj.get(edge.source()).add(edge.target());
            inDegree.put(edge.target(), inDegree.get(edge.target()) + 1);
        }

        // PriorityQueue guarantees deterministic tie-breaking (lexicographical order)
        PriorityQueue<String> readyQueue = new PriorityQueue<>();
        for (Map.Entry<String, Integer> entry : inDegree.entrySet()) {
            if (entry.getValue() == 0) {
                readyQueue.add(entry.getKey());
            }
        }

        List<String> order = new ArrayList<>(graph.taskIds().size());
        while (!readyQueue.isEmpty()) {
            String current = readyQueue.poll();
            order.add(current);

            for (String dependent : adj.get(current)) {
                int updatedInDegree = inDegree.get(dependent) - 1;
                inDegree.put(dependent, updatedInDegree);
                if (updatedInDegree == 0) {
                    readyQueue.add(dependent);
                }
            }
        }

        return List.copyOf(order);
    }

    /**
     * Convenience method sorting tasks and edges directly.
     */
    public static List<String> topologicalSort(Collection<String> taskIds, Collection<DependencyEdge> edges) {
        return topologicalSort(TaskGraph.of(taskIds, edges));
    }

    private static void iterativeDfs(
        String startNode,
        Map<String, List<String>> adj,
        Map<String, Integer> colors,
        Set<String> cycleNodesSet,
        List<String> errors
    ) {
        Deque<DfsFrame> stack = new ArrayDeque<>();
        List<String> path = new ArrayList<>();

        colors.put(startNode, GRAY);
        path.add(startNode);
        stack.push(new DfsFrame(startNode, adj.getOrDefault(startNode, List.of())));

        while (!stack.isEmpty()) {
            DfsFrame frame = stack.peek();
            if (frame.nextNeighborIndex < frame.neighbors.size()) {
                String v = frame.neighbors.get(frame.nextNeighborIndex++);
                int color = colors.getOrDefault(v, WHITE);
                if (color == GRAY) {
                    // Cycle detected
                    cycleNodesSet.add(v);
                    cycleNodesSet.add(frame.node);

                    int cycleStart = path.indexOf(v);
                    if (cycleStart != -1) {
                        List<String> cyclePath = new ArrayList<>(path.subList(cycleStart, path.size()));
                        cycleNodesSet.addAll(cyclePath);
                        cyclePath.add(v);
                        errors.add("Cyclic dependency: " + String.join(" -> ", cyclePath));
                    } else {
                        errors.add("Cyclic dependency involving task: " + v);
                    }
                } else if (color == WHITE) {
                    colors.put(v, GRAY);
                    path.add(v);
                    stack.push(new DfsFrame(v, adj.getOrDefault(v, List.of())));
                }
            } else {
                stack.pop();
                path.remove(path.size() - 1);
                colors.put(frame.node, BLACK);
            }
        }
    }

    private static final class DfsFrame {
        private final String node;
        private final List<String> neighbors;
        private int nextNeighborIndex;

        private DfsFrame(String node, List<String> neighbors) {
            this.node = node;
            this.neighbors = neighbors;
            this.nextNeighborIndex = 0;
        }
    }
}
