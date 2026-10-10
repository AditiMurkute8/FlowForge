package com.flowforge.health;

import java.time.Instant;

/**
 * Data transfer record representing health status and service metadata.
 *
 * @param status the operational status of the service (e.g. "UP")
 * @param service the identifier of the service (e.g. "flowforge-backend")
 * @param timestamp the timestamp of the health check in UTC
 */
public record HealthResponse(
    String status,
    String service,
    Instant timestamp
) {}
