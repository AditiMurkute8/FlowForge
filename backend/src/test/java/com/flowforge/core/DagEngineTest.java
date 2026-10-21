package com.flowforge.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DagEngineTest {

    @Test
    @DisplayName("1. Empty graph is valid and yields empty topological order")
    void emptyGraph() {
        TaskGraph graph = TaskGraph.empty();

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.errors()).isEmpty();
        assertThat(result.warnings()).contains("Workflow contains no tasks.");

        List<String> order = DagEngine.topologicalSort(graph);
        assertThat(order).isEmpty();
    }

    @Test
    @DisplayName("2. Single task with no edges is valid and yields single item")
    void singleTask() {
        TaskGraph graph = TaskGraph.of(List.of("task-1"), List.of());

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.errors()).isEmpty();
        assertThat(result.warnings()).isEmpty();
        assertThat(result.disconnectedNodes()).isEmpty();

        List<String> order = DagEngine.topologicalSort(graph);
        assertThat(order).containsExactly("task-1");
    }

    @Test
    @DisplayName("3. Linear dependency chain orders prerequisites before dependents")
    void simpleDependencyChain() {
        TaskGraph graph = TaskGraph.of(
            List.of("fetch", "clean", "store"),
            List.of(
                new DependencyEdge("fetch", "clean"),
                new DependencyEdge("clean", "store")
            )
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.errors()).isEmpty();

        List<String> order = DagEngine.topologicalSort(graph);
        assertThat(order).containsExactly("fetch", "clean", "store");
    }

    @Test
    @DisplayName("4. Diamond graph with multiple valid branches preserves topological constraints")
    void multipleValidBranches() {
        // A -> B, A -> C, B -> D, C -> D
        TaskGraph graph = TaskGraph.of(
            List.of("A", "B", "C", "D"),
            List.of(
                new DependencyEdge("A", "B"),
                new DependencyEdge("A", "C"),
                new DependencyEdge("B", "D"),
                new DependencyEdge("C", "D")
            )
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.hasCycle()).isFalse();

        List<String> order = DagEngine.topologicalSort(graph);
        assertThat(order).containsExactly("A", "B", "C", "D");
        assertThat(order.indexOf("A")).isLessThan(order.indexOf("B"));
        assertThat(order.indexOf("A")).isLessThan(order.indexOf("C"));
        assertThat(order.indexOf("B")).isLessThan(order.indexOf("D"));
        assertThat(order.indexOf("C")).isLessThan(order.indexOf("D"));
    }

    @Test
    @DisplayName("5. Independent tasks are resolved with deterministic alphabetical tie-breaking")
    void independentTasksDeterministicOrdering() {
        // Passed in reverse order: Z, M, A
        TaskGraph graph = TaskGraph.of(List.of("Z", "M", "A"), List.of());

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.disconnectedNodes()).containsExactly("A", "M", "Z");

        List<String> order = DagEngine.topologicalSort(graph);
        // PriorityQueue tie-breaking guarantees alphabetical order A, M, Z
        assertThat(order).containsExactly("A", "M", "Z");
    }

    @Test
    @DisplayName("6. Duplicate task IDs are rejected during validation and sort fails")
    void duplicateTaskIds() {
        TaskGraph graph = TaskGraph.of(
            List.of("task-1", "task-2", "task-1"),
            List.of(new DependencyEdge("task-1", "task-2"))
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).anyMatch(e -> e.contains("Duplicate task ID detected: task-1"));

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Duplicate task ID detected")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().errors())
                    .anyMatch(e -> e.contains("Duplicate task ID detected: task-1"));
            });
    }

    @Test
    @DisplayName("7. Edge referencing unknown task is rejected")
    void dependencyReferencingMissingTask() {
        TaskGraph graph = TaskGraph.of(
            List.of("task-1"),
            List.of(new DependencyEdge("task-1", "ghost-task"))
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).anyMatch(e -> e.contains("Edge references unknown task: task-1 -> ghost-task"));

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Edge references unknown task")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().errors())
                    .anyMatch(e -> e.contains("Edge references unknown task: task-1 -> ghost-task"));
            });
    }

    @Test
    @DisplayName("8. Self-cycle is detected and rejected")
    void selfCycle() {
        TaskGraph graph = TaskGraph.of(
            List.of("loop-task"),
            List.of(new DependencyEdge("loop-task", "loop-task"))
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.hasCycle()).isTrue();
        assertThat(result.cycleNodes()).containsExactly("loop-task");
        assertThat(result.errors()).anyMatch(e -> e.contains("Self-loop detected on task: loop-task"));

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Self-loop detected")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().hasCycle()).isTrue();
                assertThat(ide.getValidationResult().cycleNodes()).containsExactly("loop-task");
            });
    }

    @Test
    @DisplayName("9. Multi-node cycle is detected with cycle nodes identified")
    void multiNodeCycle() {
        // Cycle: A -> B -> C -> A
        TaskGraph graph = TaskGraph.of(
            List.of("A", "B", "C"),
            List.of(
                new DependencyEdge("A", "B"),
                new DependencyEdge("B", "C"),
                new DependencyEdge("C", "A")
            )
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.hasCycle()).isTrue();
        assertThat(result.cycleNodes()).containsExactlyInAnyOrder("A", "B", "C");
        assertThat(result.errors()).anyMatch(e -> e.contains("Cyclic dependency"));

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Cyclic dependency")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().hasCycle()).isTrue();
                assertThat(ide.getValidationResult().cycleNodes()).containsExactlyInAnyOrder("A", "B", "C");
            });
    }

    @Test
    @DisplayName("10. Valid complex workflow ordering is verified against every dependency edge")
    void validComplexGraphOrderingMatchesEveryDependency() {
        // Mirrors Clickstream workflow:
        // node-1 -> node-2, node-1 -> node-3, node-2 -> node-4, node-3 -> node-4, node-4 -> node-5
        List<String> taskIds = List.of("node-1", "node-2", "node-3", "node-4", "node-5");
        List<DependencyEdge> edges = List.of(
            new DependencyEdge("node-1", "node-2"),
            new DependencyEdge("node-1", "node-3"),
            new DependencyEdge("node-2", "node-4"),
            new DependencyEdge("node-3", "node-4"),
            new DependencyEdge("node-4", "node-5")
        );
        TaskGraph graph = TaskGraph.of(taskIds, edges);

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.errors()).isEmpty();

        List<String> order = DagEngine.topologicalSort(graph);
        assertThat(order).hasSameSizeAs(taskIds);

        // Verification invariant: for EVERY edge, source must precede target in the topological sort
        for (DependencyEdge edge : edges) {
            int sourceIdx = order.indexOf(edge.source());
            int targetIdx = order.indexOf(edge.target());
            assertThat(sourceIdx)
                .as("Prerequisite %s must appear before dependent %s in %s", edge.source(), edge.target(), order)
                .isLessThan(targetIdx);
        }
    }

    @Test
    @DisplayName("11. Blank or null task IDs are rejected by TaskGraph and DependencyEdge")
    void blankAndNullTaskIdsRejected() {
        assertThatThrownBy(() -> TaskGraph.of(List.of(""), List.of()))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("task ID must not be blank");

        assertThatThrownBy(() -> TaskGraph.of(List.of("   "), List.of()))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("task ID must not be blank");

        assertThatThrownBy(() -> TaskGraph.of(Collections.singletonList(null), List.of()))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("task ID must not be null");

        assertThatThrownBy(() -> new DependencyEdge("", "task-2"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("source task ID must not be blank");

        assertThatThrownBy(() -> new DependencyEdge("task-1", "   "))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("target task ID must not be blank");

        assertThatThrownBy(() -> new DependencyEdge(null, "task-2"))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("source task ID must not be null");

        assertThatThrownBy(() -> new DependencyEdge("task-1", null))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("target task ID must not be null");
    }

    @Test
    @DisplayName("12. Empty task list with dependency edges is rejected as invalid referencing unknown tasks")
    void emptyTaskListWithDanglingEdgeIsRejected() {
        TaskGraph graph = TaskGraph.of(List.of(), List.of(new DependencyEdge("node-1", "node-2")));

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.warnings()).isEmpty();
        assertThat(result.errors()).containsExactly("Edge references unknown task: node-1 -> node-2");

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Edge references unknown task")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().errors())
                    .containsExactly("Edge references unknown task: node-1 -> node-2");
            });
    }

    @Test
    @DisplayName("13. Duplicate identical dependency edges are rejected with clear error")
    void duplicateDependencyEdgesAreRejected() {
        TaskGraph graph = TaskGraph.of(
            List.of("A", "B"),
            List.of(
                new DependencyEdge("A", "B"),
                new DependencyEdge("A", "B")
            )
        );

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.errors()).containsExactly("Duplicate dependency edge detected: A -> B");

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Duplicate dependency edge detected")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().errors())
                    .containsExactly("Duplicate dependency edge detected: A -> B");
            });
    }

    @Test
    @DisplayName("14. Public collections exposed by TaskGraph, DagValidationResult, and topologicalSort are immutable")
    void publicCollectionsAreImmutable() {
        TaskGraph graph = TaskGraph.of(List.of("A", "B"), List.of(new DependencyEdge("A", "B")));

        assertThatThrownBy(() -> graph.taskIds().add("C"))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> graph.edges().add(new DependencyEdge("B", "C")))
            .isInstanceOf(UnsupportedOperationException.class);

        DagValidationResult validation = DagEngine.validate(graph);
        assertThatThrownBy(() -> validation.errors().add("new-error"))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> validation.warnings().add("new-warning"))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> validation.cycleNodes().add("node"))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> validation.disconnectedNodes().add("node"))
            .isInstanceOf(UnsupportedOperationException.class);

        List<String> order = DagEngine.topologicalSort(graph);
        assertThatThrownBy(() -> order.add("C"))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    @DisplayName("15. Convenience overloads validate and sort tasks and edges directly")
    void convenienceOverloadsValidateAndSortDirectly() {
        List<String> taskIds = List.of("fetch", "process");
        List<DependencyEdge> edges = List.of(new DependencyEdge("fetch", "process"));

        DagValidationResult validation = DagEngine.validate(taskIds, edges);
        assertThat(validation.isValid()).isTrue();
        assertThat(validation.errors()).isEmpty();

        List<String> order = DagEngine.topologicalSort(taskIds, edges);
        assertThat(order).containsExactly("fetch", "process");
    }

    @Test
    @DisplayName("16. 10,000-node deep DAG is stack-safe during validation and topological sorting")
    void tenThousandNodeDeepDagValidationAndSorting() {
        int nodeCount = 10_000;
        List<String> taskIds = new ArrayList<>(nodeCount);
        List<DependencyEdge> edges = new ArrayList<>(nodeCount - 1);

        for (int i = 0; i < nodeCount; i++) {
            taskIds.add(String.format("task-%05d", i));
            if (i > 0) {
                edges.add(new DependencyEdge(String.format("task-%05d", i - 1), String.format("task-%05d", i)));
            }
        }

        TaskGraph graph = TaskGraph.of(taskIds, edges);

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isTrue();
        assertThat(result.hasCycle()).isFalse();
        assertThat(result.errors()).isEmpty();
        assertThat(result.warnings()).isEmpty();
        assertThat(result.cycleNodes()).isEmpty();
        assertThat(result.disconnectedNodes()).isEmpty();

        List<String> order = DagEngine.topologicalSort(graph);
        assertThat(order).hasSize(nodeCount);
        assertThat(order.get(0)).isEqualTo("task-00000");
        assertThat(order.get(nodeCount - 1)).isEqualTo(String.format("task-%05d", nodeCount - 1));

        // Deterministic sequence verification across checkpoints
        for (int i = 0; i < 100; i++) {
            int sampleIdx = i * 100;
            assertThat(order.get(sampleIdx)).isEqualTo(String.format("task-%05d", sampleIdx));
        }
    }

    @Test
    @DisplayName("17. Deep cycle traversal is stack-safe and accurately reports cycle path")
    void deepCycleTraversalIsStackSafeAndReportsCycle() {
        int nodeCount = 5_000;
        List<String> taskIds = new ArrayList<>(nodeCount);
        List<DependencyEdge> edges = new ArrayList<>(nodeCount);

        for (int i = 0; i < nodeCount; i++) {
            taskIds.add(String.format("deep-%04d", i));
            if (i > 0) {
                edges.add(new DependencyEdge(String.format("deep-%04d", i - 1), String.format("deep-%04d", i)));
            }
        }
        // Add back-edge from tail to head to form a 5,000-node deep cycle
        edges.add(new DependencyEdge(String.format("deep-%04d", nodeCount - 1), "deep-0000"));

        TaskGraph graph = TaskGraph.of(taskIds, edges);

        DagValidationResult result = DagEngine.validate(graph);
        assertThat(result.isValid()).isFalse();
        assertThat(result.hasCycle()).isTrue();
        assertThat(result.cycleNodes()).hasSize(nodeCount);
        assertThat(result.cycleNodes()).contains("deep-0000", "deep-2500", String.format("deep-%04d", nodeCount - 1));
        assertThat(result.errors()).anyMatch(err ->
            err.startsWith("Cyclic dependency: deep-0000 -> ") && err.endsWith(" -> deep-0000")
        );

        assertThatThrownBy(() -> DagEngine.topologicalSort(graph))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Cyclic dependency")
            .satisfies(ex -> {
                InvalidDagException ide = (InvalidDagException) ex;
                assertThat(ide.getValidationResult().isValid()).isFalse();
                assertThat(ide.getValidationResult().hasCycle()).isTrue();
                assertThat(ide.getValidationResult().cycleNodes()).hasSize(nodeCount);
            });
    }
}
