package com.flowforge.api.dto;

import java.util.List;

/**
 * Request payload for executing a workflow.
 *
 * @param tasks list of task specifications with action and retry settings
 * @param edges list of directed dependency edges
 * @param concurrency maximum concurrent worker threads (1..4, default 4)
 */
public record ExecuteWorkflowRequest(
    List<TaskDefinitionDto> tasks,
    List<EdgeDto> edges,
    Integer concurrency
) {
}
