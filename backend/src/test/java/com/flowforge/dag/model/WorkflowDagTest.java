package com.flowforge.dag.model;

import com.flowforge.dag.exception.InvalidDagException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.*;

class WorkflowDagTest {

    @Test
    @DisplayName("WorkflowDag construction builds correct adjacency lists and indegree counts")
    void testAdjacencyListAndIndegreeCalculation() {
        // A -> [B, C]
        // B -> [D]
        // C -> [D]
        // D -> []
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

        assertThat(dag.getTasks()).hasSize(4);
        assertThat(dag.getIndegrees()).containsEntry("A", 0);
        assertThat(dag.getIndegrees()).containsEntry("B", 1);
        assertThat(dag.getIndegrees()).containsEntry("C", 1);
        assertThat(dag.getIndegrees()).containsEntry("D", 2);

        assertThat(dag.getOutgoingNeighbors("A")).containsExactly("B", "C");
        assertThat(dag.getOutgoingNeighbors("B")).containsExactly("D");
        assertThat(dag.getOutgoingNeighbors("C")).containsExactly("D");
        assertThat(dag.getOutgoingNeighbors("D")).isEmpty();

        assertThat(dag.getPrerequisites("A")).isEmpty();
        assertThat(dag.getPrerequisites("B")).containsExactly("A");
        assertThat(dag.getPrerequisites("C")).containsExactly("A");
        assertThat(dag.getPrerequisites("D")).containsExactly("B", "C");

        assertThat(dag.getInitialReadyTasks()).extracting(Task::getId).containsExactly("A");
    }

    @Test
    @DisplayName("Unknown task reference in dependency edge throws InvalidDagException")
    void testUnknownTaskInDependency() {
        assertThatThrownBy(() -> WorkflowDag.builder()
                .addTask("A")
                .addDependency("A", "UNKNOWN_TASK")
                .build())
                .isInstanceOf(InvalidDagException.class)
                .hasMessageContaining("unknown target task ID");

        assertThatThrownBy(() -> WorkflowDag.builder()
                .addTask("B")
                .addDependency("UNKNOWN_TASK", "B")
                .build())
                .isInstanceOf(InvalidDagException.class)
                .hasMessageContaining("unknown source source task ID".contains("source") ? "source" : "source");
    }

    @Test
    @DisplayName("Duplicate task IDs are rejected")
    void testDuplicateTaskIdRejection() {
        WorkflowDag.Builder builder = WorkflowDag.builder().addTask("A");
        assertThatThrownBy(() -> builder.addTask("A"))
                .isInstanceOf(InvalidDagException.class)
                .hasMessageContaining("Duplicate task ID");
    }

    @Test
    @DisplayName("Task validation enforces non-null, non-blank identifiers")
    void testTaskValidation() {
        assertThatThrownBy(() -> new Task(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Task(""))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Task("   "))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> new TaskDependency(null, "B"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new TaskDependency("A", null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
