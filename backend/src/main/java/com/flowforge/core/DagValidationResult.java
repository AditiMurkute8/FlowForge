package com.flowforge.core;

import java.util.List;
import java.util.Objects;

/**
 * Result of validating a directed graph.
 *
 * @param isValid true if the graph has no cycles, self-loops, duplicate tasks, or missing task references
 * @param hasCycle true if any cycle or self-loop was detected
 * @param errors list of validation error messages
 * @param warnings list of non-fatal warnings (e.g. empty graph or disconnected nodes)
 * @param cycleNodes task IDs involved in cycles
 * @param disconnectedNodes task IDs that have neither prerequisites nor dependents in a multi-task graph
 */
public record DagValidationResult(
    boolean isValid,
    boolean hasCycle,
    List<String> errors,
    List<String> warnings,
    List<String> cycleNodes,
    List<String> disconnectedNodes
) {

    public DagValidationResult {
        Objects.requireNonNull(errors, "errors must not be null");
        Objects.requireNonNull(warnings, "warnings must not be null");
        Objects.requireNonNull(cycleNodes, "cycleNodes must not be null");
        Objects.requireNonNull(disconnectedNodes, "disconnectedNodes must not be null");
        errors = List.copyOf(errors);
        warnings = List.copyOf(warnings);
        cycleNodes = List.copyOf(cycleNodes);
        disconnectedNodes = List.copyOf(disconnectedNodes);
    }
}
