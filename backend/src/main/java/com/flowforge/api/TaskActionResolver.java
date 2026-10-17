package com.flowforge.api;

import com.flowforge.api.dto.RetryPolicyDto;
import com.flowforge.api.dto.TaskActionDto;
import com.flowforge.api.dto.TaskActionType;
import com.flowforge.api.dto.TaskDefinitionDto;
import com.flowforge.scheduler.*;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Validates and resolves API task definitions into executable TaskAction instances and RetryPolicy configurations.
 */
@Component
public class TaskActionResolver {

    public static final int MAX_DELAY_MS = 5000;
    public static final int MAX_RETRY_ATTEMPTS = 5;
    public static final int MAX_INITIAL_DELAY_MS = 2000;
    public static final int MAX_MAX_DELAY_MS = 5000;
    public static final double MIN_MULTIPLIER = 1.0;
    public static final double MAX_MULTIPLIER = 5.0;
    public static final int MAX_ERROR_MESSAGE_LENGTH = 255;

    public TaskRegistry resolveRegistry(List<TaskDefinitionDto> tasks) {
        TaskRegistry registry = new TaskRegistry();
        if (tasks == null) {
            return registry;
        }

        for (TaskDefinitionDto task : tasks) {
            validateTaskDefinition(task);
            TaskAction action = resolveAction(task.action());
            RetryPolicy retryPolicy = resolveRetryPolicy(task.retryPolicy());
            registry.register(task.id().trim(), action, retryPolicy);
        }

        return registry;
    }

    public void validateTaskDefinition(TaskDefinitionDto task) {
        if (task == null) {
            throw new IllegalArgumentException("Task definition must not be null");
        }
        if (task.id() == null || task.id().isBlank()) {
            throw new IllegalArgumentException("Task ID must not be blank");
        }

        TaskActionDto action = task.action();
        if (action != null && action.type() != null) {
            switch (action.type()) {
                case DELAY -> {
                    long delay = action.delayMs() != null ? action.delayMs() : 0;
                    if (delay < 0 || delay > MAX_DELAY_MS) {
                        throw new IllegalArgumentException("delayMs must be between 0 and " + MAX_DELAY_MS + " ms");
                    }
                }
                case FAIL -> {
                    if (action.errorMessage() != null && action.errorMessage().length() > MAX_ERROR_MESSAGE_LENGTH) {
                        throw new IllegalArgumentException("errorMessage must not exceed " + MAX_ERROR_MESSAGE_LENGTH + " characters");
                    }
                }
                case FAIL_UNTIL_ATTEMPT -> {
                    int threshold = action.failUntilAttempt() != null ? action.failUntilAttempt() : 1;
                    if (threshold < 1 || threshold > MAX_RETRY_ATTEMPTS) {
                        throw new IllegalArgumentException("failUntilAttempt must be between 1 and " + MAX_RETRY_ATTEMPTS);
                    }
                    if (action.errorMessage() != null && action.errorMessage().length() > MAX_ERROR_MESSAGE_LENGTH) {
                        throw new IllegalArgumentException("errorMessage must not exceed " + MAX_ERROR_MESSAGE_LENGTH + " characters");
                    }
                }
                case NO_OP -> {}
            }
        }

        RetryPolicyDto retry = task.retryPolicy();
        if (retry != null) {
            int maxAttempts = retry.maxAttempts() != null ? retry.maxAttempts() : 1;
            if (maxAttempts < 1 || maxAttempts > MAX_RETRY_ATTEMPTS) {
                throw new IllegalArgumentException("maxAttempts must be between 1 and " + MAX_RETRY_ATTEMPTS);
            }
            long initialDelay = retry.initialDelayMs() != null ? retry.initialDelayMs() : 0;
            if (initialDelay < 0 || initialDelay > MAX_INITIAL_DELAY_MS) {
                throw new IllegalArgumentException("initialDelayMs must be between 0 and " + MAX_INITIAL_DELAY_MS + " ms");
            }
            long maxDelay = retry.maxDelayMs() != null ? retry.maxDelayMs() : initialDelay;
            if (maxDelay < initialDelay || maxDelay > MAX_MAX_DELAY_MS) {
                throw new IllegalArgumentException("maxDelayMs must be between initialDelayMs and " + MAX_MAX_DELAY_MS + " ms");
            }
            double multiplier = retry.backoffMultiplier() != null ? retry.backoffMultiplier() : 2.0;
            if (multiplier < MIN_MULTIPLIER || multiplier > MAX_MULTIPLIER) {
                throw new IllegalArgumentException("backoffMultiplier must be between " + MIN_MULTIPLIER + " and " + MAX_MULTIPLIER);
            }
        }
    }

    public TaskAction resolveAction(TaskActionDto actionDto) {
        if (actionDto == null || actionDto.type() == null || actionDto.type() == TaskActionType.NO_OP) {
            return id -> {};
        }

        switch (actionDto.type()) {
            case DELAY -> {
                long delay = actionDto.delayMs() != null ? actionDto.delayMs() : 0;
                long clampedDelay = Math.min(MAX_DELAY_MS, Math.max(0, delay));
                return id -> {
                    if (clampedDelay > 0) {
                        Thread.sleep(clampedDelay);
                    }
                };
            }
            case FAIL -> {
                String error = actionDto.errorMessage() != null && !actionDto.errorMessage().isBlank()
                    ? actionDto.errorMessage().trim()
                    : "Simulated task failure";
                String boundedError = error.length() > MAX_ERROR_MESSAGE_LENGTH ? error.substring(0, MAX_ERROR_MESSAGE_LENGTH) : error;
                return id -> {
                    throw new SimulatedTaskException(boundedError);
                };
            }
            case FAIL_UNTIL_ATTEMPT -> {
                int failUntil = actionDto.failUntilAttempt() != null ? actionDto.failUntilAttempt() : 1;
                String userError = actionDto.errorMessage() != null && !actionDto.errorMessage().isBlank()
                    ? actionDto.errorMessage().trim()
                    : null;
                AtomicInteger attemptCounter = new AtomicInteger(0);
                return id -> {
                    int currentAttempt = attemptCounter.incrementAndGet();
                    if (currentAttempt < failUntil) {
                        String msg = userError != null
                            ? userError
                            : ("Simulated transient failure on attempt " + currentAttempt);
                        throw new SimulatedTaskException(msg.length() > MAX_ERROR_MESSAGE_LENGTH ? msg.substring(0, MAX_ERROR_MESSAGE_LENGTH) : msg);
                    }
                };
            }
            default -> {
                return id -> {};
            }
        }
    }

    public RetryPolicy resolveRetryPolicy(RetryPolicyDto dto) {
        if (dto == null) {
            return RetryPolicy.none();
        }

        int maxAttempts = dto.maxAttempts() != null ? dto.maxAttempts() : 1;
        BackoffStrategy strategy = dto.backoffStrategy() != null ? dto.backoffStrategy() : BackoffStrategy.NONE;
        JitterStrategy jitter = dto.jitterStrategy() != null ? dto.jitterStrategy() : JitterStrategy.NONE;
        long initialDelayMs = dto.initialDelayMs() != null ? dto.initialDelayMs() : 0;
        long maxDelayMs = dto.maxDelayMs() != null ? dto.maxDelayMs() : initialDelayMs;
        double multiplier = dto.backoffMultiplier() != null ? dto.backoffMultiplier() : 2.0;

        if (maxAttempts <= 1 || strategy == BackoffStrategy.NONE) {
            return maxAttempts <= 1
                ? RetryPolicy.none()
                : RetryPolicy.fixed(maxAttempts, Duration.ZERO).withJitter(jitter);
        }

        if (strategy == BackoffStrategy.FIXED) {
            return RetryPolicy.fixed(maxAttempts, Duration.ofMillis(initialDelayMs)).withJitter(jitter);
        }

        return RetryPolicy.exponential(
            maxAttempts,
            Duration.ofMillis(initialDelayMs),
            Duration.ofMillis(maxDelayMs),
            multiplier
        ).withJitter(jitter);
    }
}
