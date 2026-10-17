package com.flowforge.api.dto;

import java.util.List;

/**
 * Request payload for DAG structure validation.
 *
 * @param taskIds the list of task IDs in the workflow
 * @param edges the list of directed dependency edges
 */
public record ValidateDagRequest(List<String> taskIds, List<EdgeDto> edges) {
}
