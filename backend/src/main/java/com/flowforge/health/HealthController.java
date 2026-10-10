package com.flowforge.health;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Health check endpoint providing liveness verification for the FlowForge backend.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private static final String SERVICE_NAME = "flowforge-backend";
    private static final String STATUS_UP = "UP";

    /**
     * Health check endpoint to verify that the application is running and responsive.
     *
     * @return HTTP 200 with {@link HealthResponse}
     */
    @GetMapping("/health")
    public ResponseEntity<HealthResponse> getHealth() {
        return ResponseEntity.ok(new HealthResponse(STATUS_UP, SERVICE_NAME, Instant.now()));
    }
}
