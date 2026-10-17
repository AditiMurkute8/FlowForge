package com.flowforge.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for workflow execution timeouts and server concurrency limits.
 */
@Configuration
@ConfigurationProperties(prefix = "flowforge.scheduler")
public class SchedulerProperties {

    /**
     * Maximum concurrent workflows admitted by the server semaphore (default 4).
     */
    private int maxConcurrentWorkflows = 4;

    /**
     * Maximum synchronous execution timeout in seconds before returning HTTP 504 (default 15).
     */
    private long executionTimeoutSeconds = 15;

    public int getMaxConcurrentWorkflows() {
        return maxConcurrentWorkflows;
    }

    public void setMaxConcurrentWorkflows(int maxConcurrentWorkflows) {
        this.maxConcurrentWorkflows = maxConcurrentWorkflows;
    }

    public long getExecutionTimeoutSeconds() {
        return executionTimeoutSeconds;
    }

    public void setExecutionTimeoutSeconds(long executionTimeoutSeconds) {
        this.executionTimeoutSeconds = executionTimeoutSeconds;
    }
}
