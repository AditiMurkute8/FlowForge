package com.flowforge.api.dto;

/**
 * DTO representing a directed dependency edge from prerequisite to dependent task.
 *
 * @param source the prerequisite task ID
 * @param target the dependent task ID
 */
public record EdgeDto(String source, String target) {
}
