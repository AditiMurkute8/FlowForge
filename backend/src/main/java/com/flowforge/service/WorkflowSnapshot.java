package com.flowforge.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.flowforge.core.DagValidationResult;
import com.flowforge.core.TaskGraph;

import java.util.Objects;

/**
 * Validated workflow snapshot containing the cleaned JSON payload, TaskGraph representation,
 * and server-derived DAG metrics.
 *
 * @param cleanedPayload JSON payload with transient execution fields removed and canvas configuration preserved
 * @param taskGraph core backend TaskGraph representation
 * @param validationResult validation result from DagEngine
 * @param taskCount total number of unique tasks
 * @param edgeCount total number of dependency edges
 * @param isValidDag true if the snapshot is an executable Directed Acyclic Graph without cycles or invalid edges
 */
public record WorkflowSnapshot(
        JsonNode cleanedPayload,
        TaskGraph taskGraph,
        DagValidationResult validationResult,
        int taskCount,
        int edgeCount,
        boolean isValidDag
) {
    public WorkflowSnapshot {
        Objects.requireNonNull(cleanedPayload, "cleanedPayload must not be null");
        Objects.requireNonNull(taskGraph, "taskGraph must not be null");
        Objects.requireNonNull(validationResult, "validationResult must not be null");
    }
}
