package com.flowforge.api.dto;

import java.util.List;

/**
 * Response payload containing DAG validation diagnostics and deterministic execution order.
 *
 * @param isValid true if the graph is a valid acyclic DAG without duplicates or unknown references
 * @param hasCycle true if any cycle or self-loop was detected
 * @param errors list of validation errors
 * @param warnings list of non-fatal warnings (e.g. empty graph or disconnected nodes)
 * @param cycleNodes task IDs involved in cycles
 * @param disconnectedNodes task IDs that have neither prerequisites nor dependents in a multi-task graph
 * @param topologicalOrder deterministic execution order if valid, or empty list if invalid
 */
public record ValidateDagResponse(
    boolean isValid,
    boolean hasCycle,
    List<String> errors,
    List<String> warnings,
    List<String> cycleNodes,
    List<String> disconnectedNodes,
    List<String> topologicalOrder
) {
}
