package com.flowforge.dag.engine;

import com.flowforge.dag.exception.CycleDetectedException;
import com.flowforge.dag.exception.InvalidDagException;
import com.flowforge.dag.model.Task;
import com.flowforge.dag.model.WorkflowDag;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.*;

class DagEngineTest {

    private DagEngine dagEngine;

    @BeforeEach
    void setUp() {
        dagEngine = new DagEngine();
    }

    /**
     * Helper method to verify that a computed topological ordering respects all dependency edges in the DAG.
     * For every directed edge U -> V, the position of U in the ordering MUST be strictly before V.
     */
    private void verifyTopologicalOrder(WorkflowDag dag, List<Task> ordering) {
        assertThat(ordering).hasSize(dag.getTasks().size());
        assertThat(ordering).containsExactlyInAnyOrderElementsOf(dag.getTasks().values());

        Map<String, Integer> positionMap = new HashMap<>();
        for (int i = 0; i < ordering.size(); i++) {
            positionMap.put(ordering.get(i).getId(), i);
        }

        for (var edge : dag.getDependencies()) {
            int sourcePos = positionMap.get(edge.getSourceTaskId());
            int targetPos = positionMap.get(edge.getTargetTaskId());
            assertThat(sourcePos)
                    .withFailMessage("Dependency edge violated: %s (pos %d) must precede %s (pos %d)",
                            edge.getSourceTaskId(), sourcePos, edge.getTargetTaskId(), targetPos)
                    .isLessThan(targetPos);
        }
    }

    @Test
    @DisplayName("1. Single-node graph should produce a topological ordering containing that single node")
    void testSingleNodeGraph() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A", "Single Task A")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        assertThat(order).extracting(Task::getId).containsExactly("A");
        verifyTopologicalOrder(dag, order);
    }

    @Test
    @DisplayName("2. Empty graph should return an empty topological ordering")
    void testEmptyGraph() {
        WorkflowDag dag = WorkflowDag.builder().build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        assertThat(order).isEmpty();
        verifyTopologicalOrder(dag, order);
    }

    @Test
    @DisplayName("3. Linear graph A -> B -> C should produce exact topological ordering [A, B, C]")
    void testLinearGraph() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addDependency("A", "B")
                .addDependency("B", "C")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        assertThat(order).extracting(Task::getId).containsExactly("A", "B", "C");
        verifyTopologicalOrder(dag, order);
    }

    @Test
    @DisplayName("4. Parallel graph with independent branches A -> B -> D and A -> C -> D")
    void testParallelGraph() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addTask("D")
                .addDependency("A", "B")
                .addDependency("A", "C")
                .addDependency("B", "D")
                .addDependency("C", "D")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        verifyTopologicalOrder(dag, order);
        assertThat(order.get(0).getId()).isEqualTo("A");
        assertThat(order.get(3).getId()).isEqualTo("D");
    }

    @Test
    @DisplayName("5. Diamond dependency graph topology verification")
    void testDiamondDependency() {
        //         A
        //       /   \
        //      B     C
        //       \   /
        //         D
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A", "Start Node")
                .addTask("B", "Branch B")
                .addTask("C", "Branch C")
                .addTask("D", "Merge Node")
                .addDependency("A", "B")
                .addDependency("A", "C")
                .addDependency("B", "D")
                .addDependency("C", "D")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        verifyTopologicalOrder(dag, order);
        // Deterministic sorting guarantees B comes before C
        assertThat(order).extracting(Task::getId).containsExactly("A", "B", "C", "D");
    }

    @Test
    @DisplayName("6. Disconnected graph with multiple components")
    void testDisconnectedGraph() {
        // Component 1: A -> B
        // Component 2: C -> D
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addTask("D")
                .addDependency("A", "B")
                .addDependency("C", "D")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        verifyTopologicalOrder(dag, order);
    }

    @Test
    @DisplayName("7. Self-loop A -> A must throw CycleDetectedException")
    void testSelfLoopCycle() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addDependency("A", "A")
                .build();

        assertThatThrownBy(() -> dagEngine.validate(dag))
                .isInstanceOf(CycleDetectedException.class)
                .hasMessageContaining("Cycle detected");

        assertThatThrownBy(() -> dagEngine.computeTopologicalOrder(dag))
                .isInstanceOf(CycleDetectedException.class)
                .extracting(e -> ((CycleDetectedException) e).getCycleInvolvedTaskIds())
                .isEqualTo(Set.of("A"));
    }

    @Test
    @DisplayName("8. Two-node cycle A -> B, B -> A must throw CycleDetectedException")
    void testTwoNodeCycle() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addDependency("A", "B")
                .addDependency("B", "A")
                .build();

        assertThatThrownBy(() -> dagEngine.validate(dag))
                .isInstanceOf(CycleDetectedException.class);

        assertThatThrownBy(() -> dagEngine.computeTopologicalOrder(dag))
                .isInstanceOf(CycleDetectedException.class)
                .extracting(e -> ((CycleDetectedException) e).getCycleInvolvedTaskIds())
                .isEqualTo(Set.of("A", "B"));
    }

    @Test
    @DisplayName("9. Longer cycle A -> B -> C -> A must throw CycleDetectedException")
    void testLongerCycle() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addDependency("A", "B")
                .addDependency("B", "C")
                .addDependency("C", "A")
                .build();

        assertThatThrownBy(() -> dagEngine.validate(dag))
                .isInstanceOf(CycleDetectedException.class);

        assertThatThrownBy(() -> dagEngine.computeTopologicalOrder(dag))
                .isInstanceOf(CycleDetectedException.class)
                .extracting(e -> ((CycleDetectedException) e).getCycleInvolvedTaskIds())
                .isEqualTo(Set.of("A", "B", "C"));
    }

    @Test
    @DisplayName("10. Valid graph with multiple possible topological orderings")
    void testMultipleValidTopologicalOrderings() {
        // A -> C
        // B -> C
        // Valid orderings: [A, B, C] or [B, A, C]
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addDependency("A", "C")
                .addDependency("B", "C")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        verifyTopologicalOrder(dag, order);
        // Our engine guarantees determinism (A < B)
        assertThat(order).extracting(Task::getId).containsExactly("A", "B", "C");
    }

    @Test
    @DisplayName("11. Verification test for complex graph with 7 nodes respecting all dependency edges")
    void testComplexGraphEdgePrecedenceVerification() {
        // Graph structure:
        // T1 -> T3, T1 -> T4
        // T2 -> T4, T2 -> T5
        // T3 -> T6
        // T4 -> T6, T4 -> T7
        // T5 -> T7
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("T1")
                .addTask("T2")
                .addTask("T3")
                .addTask("T4")
                .addTask("T5")
                .addTask("T6")
                .addTask("T7")
                .addDependency("T1", "T3")
                .addDependency("T1", "T4")
                .addDependency("T2", "T4")
                .addDependency("T2", "T5")
                .addDependency("T3", "T6")
                .addDependency("T4", "T6")
                .addDependency("T4", "T7")
                .addDependency("T5", "T7")
                .build();

        dagEngine.validate(dag);
        List<Task> order = dagEngine.computeTopologicalOrder(dag);

        verifyTopologicalOrder(dag, order);
    }

    @Test
    @DisplayName("Ready-task unlocking logic: initial ready tasks and newly unlocked tasks as completion progresses")
    void testReadyTaskUnlockingLogic() {
        WorkflowDag dag = WorkflowDag.builder()
                .addTask("A")
                .addTask("B")
                .addTask("C")
                .addTask("D")
                .addDependency("A", "B")
                .addDependency("A", "C")
                .addDependency("B", "D")
                .addDependency("C", "D")
                .build();

        // Initially (0 tasks completed), only A is ready
        Set<Task> initialReady = dagEngine.getReadyTasks(dag, Collections.emptySet());
        assertThat(initialReady).extracting(Task::getId).containsExactly("A");

        // After A completes, B and C become ready
        Set<Task> afterA = dagEngine.getReadyTasks(dag, Set.of("A"));
        assertThat(afterA).extracting(Task::getId).containsExactlyInAnyOrder("B", "C");

        // After A and B complete (C not complete), D is NOT ready yet (needs C)
        Set<Task> afterAB = dagEngine.getReadyTasks(dag, Set.of("A", "B"));
        assertThat(afterAB).extracting(Task::getId).containsExactly("C");

        // After A, B, and C complete, D becomes ready
        Set<Task> afterABC = dagEngine.getReadyTasks(dag, Set.of("A", "B", "C"));
        assertThat(afterABC).extracting(Task::getId).containsExactly("D");

        // After all complete, ready set is empty
        Set<Task> afterAll = dagEngine.getReadyTasks(dag, Set.of("A", "B", "C", "D"));
        assertThat(afterAll).isEmpty();
    }

    @Test
    @DisplayName("Invalid DAG inputs should be cleanly rejected")
    void testInvalidDagInputs() {
        assertThatThrownBy(() -> dagEngine.validate(null))
                .isInstanceOf(InvalidDagException.class);

        assertThatThrownBy(() -> dagEngine.computeTopologicalOrder(null))
                .isInstanceOf(InvalidDagException.class);
    }
}
