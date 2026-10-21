package com.flowforge.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flowforge.core.DagEngine;
import com.flowforge.core.DagValidationResult;
import com.flowforge.core.DependencyEdge;
import com.flowforge.core.TaskGraph;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Validates incoming graph payloads, extracts core TaskGraph models,
 * strips transient execution telemetry, and verifies DAG validity via DagEngine.
 */
@Component
public class WorkflowSnapshotConverter {

    public static final int MAX_TASKS_LIMIT = 50;
    public static final int MAX_EDGES_LIMIT = 100;

    /**
     * Converts a raw graph payload into a validated WorkflowSnapshot.
     * Rejects structurally malformed payloads with IllegalArgumentException (HTTP 400).
     * Structurally valid but logically invalid DAG drafts (cycles, dangling edges) are accepted
     * and marked with isValidDag = false.
     *
     * @param rawPayload raw JSON payload from client
     * @return validated WorkflowSnapshot containing cleaned JSON and server-derived metrics
     */
    public WorkflowSnapshot convertAndValidate(JsonNode rawPayload) {
        if (rawPayload == null || !rawPayload.isObject()) {
            throw new IllegalArgumentException("Graph payload must be a non-null JSON object");
        }

        // 1. Resolve nodes array or fallback to legacy tasks array
        JsonNode nodesNode = rawPayload.get("nodes");
        boolean isLegacyTasks = false;

        if (nodesNode != null && !nodesNode.isNull()) {
            if (!nodesNode.isArray()) {
                throw new IllegalArgumentException("'nodes' field must be a JSON array");
            }
        } else {
            // nodes is missing or null -> check legacy tasks
            JsonNode tasksNode = rawPayload.get("tasks");
            if (tasksNode != null && !tasksNode.isNull()) {
                if (!tasksNode.isArray()) {
                    throw new IllegalArgumentException("'tasks' field must be a JSON array");
                }
                nodesNode = tasksNode;
                isLegacyTasks = true;
            } else {
                throw new IllegalArgumentException("Payload must contain a 'nodes' or 'tasks' array");
            }
        }

        // 2. Resolve edges array
        JsonNode edgesNode = rawPayload.get("edges");
        if (edgesNode != null && !edgesNode.isNull() && !edgesNode.isArray()) {
            throw new IllegalArgumentException("'edges' field must be a JSON array");
        }

        // 3. Check graph size limits
        int taskCount = nodesNode.size();
        if (taskCount > MAX_TASKS_LIMIT) {
            throw new IllegalArgumentException(
                    "Workflow exceeds maximum limit of " + MAX_TASKS_LIMIT + " tasks (found " + taskCount + ")");
        }

        int edgeCount = (edgesNode != null && !edgesNode.isNull()) ? edgesNode.size() : 0;
        if (edgeCount > MAX_EDGES_LIMIT) {
            throw new IllegalArgumentException(
                    "Workflow exceeds maximum limit of " + MAX_EDGES_LIMIT + " edges (found " + edgeCount + ")");
        }

        // 4. Create deep copy for cleaned payload
        ObjectNode cleanedPayload = rawPayload.deepCopy();
        stripTransientFields(cleanedPayload);

        // 5. Validate nodes, extract IDs, and strip transient fields
        ArrayNode cleanedNodes = (ArrayNode) (isLegacyTasks ? cleanedPayload.get("tasks") : cleanedPayload.get("nodes"));
        List<String> taskIds = new ArrayList<>();
        Set<String> seenTaskIds = new HashSet<>();

        for (int i = 0; i < cleanedNodes.size(); i++) {
            JsonNode node = cleanedNodes.get(i);
            if (!node.isObject()) {
                throw new IllegalArgumentException("Node at index " + i + " must be a JSON object");
            }
            ObjectNode nodeObj = (ObjectNode) node;

            JsonNode idNode = nodeObj.get("id");
            if (idNode == null || idNode.isNull() || !idNode.isTextual() || idNode.asText().trim().isEmpty()) {
                throw new IllegalArgumentException("Node at index " + i + " has a missing, null, or blank 'id'");
            }
            String id = idNode.asText().trim();
            if (!seenTaskIds.add(id)) {
                throw new IllegalArgumentException("Duplicate task ID detected: " + id);
            }
            taskIds.add(id);

            // Strip transient execution fields from node level
            stripTransientFields(nodeObj);

            // Strip transient execution fields from node.data
            JsonNode dataNode = nodeObj.get("data");
            if (dataNode != null && dataNode.isObject()) {
                stripTransientFields((ObjectNode) dataNode);
                validateNumericBounds(dataNode);
            }

            // Also validate bounds if defined directly on nodeObj (legacy format)
            validateNumericBounds(nodeObj);
        }

        // 6. Validate edges and extract DependencyEdge instances
        List<DependencyEdge> edges = new ArrayList<>();
        if (edgesNode != null && edgesNode.isArray()) {
            for (int i = 0; i < edgesNode.size(); i++) {
                JsonNode edge = edgesNode.get(i);
                if (!edge.isObject()) {
                    throw new IllegalArgumentException("Edge at index " + i + " must be a JSON object");
                }
                JsonNode sourceNode = edge.get("source");
                JsonNode targetNode = edge.get("target");

                if (sourceNode == null || sourceNode.isNull() || !sourceNode.isTextual() || sourceNode.asText().trim().isEmpty()) {
                    throw new IllegalArgumentException("Edge at index " + i + " has a missing, null, or blank 'source'");
                }
                if (targetNode == null || targetNode.isNull() || !targetNode.isTextual() || targetNode.asText().trim().isEmpty()) {
                    throw new IllegalArgumentException("Edge at index " + i + " has a missing, null, or blank 'target'");
                }

                edges.add(new DependencyEdge(sourceNode.asText().trim(), targetNode.asText().trim()));
            }
        }

        // 7. Construct backend TaskGraph and validate DAG rules
        TaskGraph taskGraph = TaskGraph.of(taskIds, edges);
        DagValidationResult validationResult = DagEngine.validate(taskGraph);

        return new WorkflowSnapshot(
                cleanedPayload,
                taskGraph,
                validationResult,
                taskIds.size(),
                edges.size(),
                validationResult.isValid()
        );
    }

    /**
     * Strips transient telemetry fields (status, executionDurationMs, isCycle) from the given ObjectNode.
     */
    private void stripTransientFields(ObjectNode objectNode) {
        if (objectNode == null) {
            return;
        }
        objectNode.remove("status");
        objectNode.remove("executionDurationMs");
        objectNode.remove("isCycle");
    }

    /**
     * Validates numeric parameter constraints.
     */
    private void validateNumericBounds(JsonNode container) {
        if (container == null || !container.isObject()) {
            return;
        }

        if (container.has("timeoutMs")) {
            JsonNode node = container.get("timeoutMs");
            if (!node.isNumber()) {
                throw new IllegalArgumentException("timeoutMs must be a number");
            }
            long timeoutMs = node.asLong();
            if (timeoutMs < 0) {
                throw new IllegalArgumentException("timeoutMs must not be negative");
            }
        }

        if (container.has("maxRetries")) {
            JsonNode node = container.get("maxRetries");
            if (!node.isNumber()) {
                throw new IllegalArgumentException("maxRetries must be a number");
            }
            int maxRetries = node.asInt();
            if (maxRetries < 0 || maxRetries > 4) {
                throw new IllegalArgumentException("maxRetries must be between 0 and 4");
            }
        }

        JsonNode params = container.get("parameters");
        if (params != null && params.isObject()) {
            validateSimulationParams(params);
            JsonNode sim = params.get("simulation");
            if (sim != null && sim.isObject()) {
                validateSimulationParams(sim);
            }

            validateRetryParams(params);
            JsonNode retry = params.get("retry");
            if (retry != null && retry.isObject()) {
                validateRetryParams(retry);
            }
        }
    }

    private void validateSimulationParams(JsonNode simNode) {
        if (simNode.has("delayMs")) {
            JsonNode node = simNode.get("delayMs");
            if (!node.isNumber()) {
                throw new IllegalArgumentException("delayMs must be a number");
            }
            long delayMs = node.asLong();
            if (delayMs < 0 || delayMs > 5000) {
                throw new IllegalArgumentException("delayMs must be between 0 and 5000");
            }
        }
        if (simNode.has("failUntilAttempt")) {
            JsonNode node = simNode.get("failUntilAttempt");
            if (!node.isNumber()) {
                throw new IllegalArgumentException("failUntilAttempt must be a number");
            }
            int failUntil = node.asInt();
            if (failUntil < 1 || failUntil > 5) {
                throw new IllegalArgumentException("failUntilAttempt must be between 1 and 5");
            }
        }
    }

    private void validateRetryParams(JsonNode retryNode) {
        if (retryNode.has("initialDelayMs")) {
            JsonNode node = retryNode.get("initialDelayMs");
            if (!node.isNumber()) {
                throw new IllegalArgumentException("initialDelayMs must be a number");
            }
            long initialDelayMs = node.asLong();
            if (initialDelayMs < 0 || initialDelayMs > 2000) {
                throw new IllegalArgumentException("initialDelayMs must be between 0 and 2000");
            }
        }
    }
}
