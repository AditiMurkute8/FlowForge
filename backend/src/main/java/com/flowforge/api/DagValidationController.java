package com.flowforge.api;

import com.flowforge.api.dto.EdgeDto;
import com.flowforge.api.dto.ValidateDagRequest;
import com.flowforge.api.dto.ValidateDagResponse;
import com.flowforge.core.DagEngine;
import com.flowforge.core.DagValidationResult;
import com.flowforge.core.DependencyEdge;
import com.flowforge.core.TaskGraph;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * REST controller providing DAG structure validation, cycle diagnostics, and topological ordering.
 */
@RestController
@RequestMapping("/api/v1/dag")
public class DagValidationController {

    public static final int MAX_TASKS_LIMIT = 50;
    public static final int MAX_EDGES_LIMIT = 100;

    @PostMapping("/validate")
    public ResponseEntity<ValidateDagResponse> validateDag(@RequestBody ValidateDagRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Request body must not be null");
        }
        if (request.taskIds() == null) {
            throw new IllegalArgumentException("taskIds list must not be null");
        }
        if (request.edges() == null) {
            throw new IllegalArgumentException("edges list must not be null");
        }
        if (request.taskIds().size() > MAX_TASKS_LIMIT) {
            throw new IllegalArgumentException("Task count exceeds limit of " + MAX_TASKS_LIMIT + ": " + request.taskIds().size());
        }
        if (request.edges().size() > MAX_EDGES_LIMIT) {
            throw new IllegalArgumentException("Edge count exceeds limit of " + MAX_EDGES_LIMIT + ": " + request.edges().size());
        }

        List<String> taskIds = new ArrayList<>();
        for (String id : request.taskIds()) {
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException("Task ID must not be blank");
            }
            taskIds.add(id.trim());
        }

        List<DependencyEdge> edges = new ArrayList<>();
        for (EdgeDto edge : request.edges()) {
            if (edge == null) {
                throw new IllegalArgumentException("Dependency edge must not be null");
            }
            if (edge.source() == null || edge.source().isBlank()) {
                throw new IllegalArgumentException("Edge source task ID must not be blank");
            }
            if (edge.target() == null || edge.target().isBlank()) {
                throw new IllegalArgumentException("Edge target task ID must not be blank");
            }
            edges.add(new DependencyEdge(edge.source().trim(), edge.target().trim()));
        }

        TaskGraph graph = TaskGraph.of(taskIds, edges);
        DagValidationResult validation = DagEngine.validate(graph);

        List<String> topologicalOrder = validation.isValid()
            ? DagEngine.topologicalSort(graph)
            : Collections.emptyList();

        ValidateDagResponse response = new ValidateDagResponse(
            validation.isValid(),
            validation.hasCycle(),
            validation.errors(),
            validation.warnings(),
            validation.cycleNodes(),
            validation.disconnectedNodes(),
            topologicalOrder
        );

        return ResponseEntity.ok(response);
    }
}
