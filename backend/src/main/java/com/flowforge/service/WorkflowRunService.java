package com.flowforge.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.flowforge.api.TaskActionResolver;
import com.flowforge.api.TaskErrorSanitizer;
import com.flowforge.api.WorkflowExecutionService;
import com.flowforge.api.dto.*;
import com.flowforge.config.SchedulerProperties;
import com.flowforge.core.*;
import com.flowforge.domain.TaskRun;
import com.flowforge.domain.WorkflowRun;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.persistence.repository.TaskRunRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowRunRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import com.flowforge.scheduler.*;
import com.flowforge.service.exception.ResourceNotFoundException;
import com.flowforge.service.exception.WorkflowCapacityExhaustedException;
import com.flowforge.service.exception.WorkflowExecutionTimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * Service orchestrating durable workflow executions against immutable WorkflowVersion snapshots.
 * Enforces server capacity gating, persists initial WorkflowRun and TaskRun entities,
 * updates task lifecycle transitions as execution progresses, and reconciles final terminal states
 * in discrete, short-lived database transactions.
 */
@Service
public class WorkflowRunService {

    private static final Logger log = LoggerFactory.getLogger(WorkflowRunService.class);

    private final WorkflowRepository workflowRepository;
    private final WorkflowVersionRepository workflowVersionRepository;
    private final WorkflowRunRepository workflowRunRepository;
    private final TaskRunRepository taskRunRepository;
    private final WorkflowExecutionService workflowExecutionService;
    private final TaskActionResolver taskActionResolver;
    private final SchedulerProperties properties;
    private final TransactionTemplate transactionTemplate;
    private final ProjectAuthorizationService authorizationService;

    public WorkflowRunService(
        WorkflowRepository workflowRepository,
        WorkflowVersionRepository workflowVersionRepository,
        WorkflowRunRepository workflowRunRepository,
        TaskRunRepository taskRunRepository,
        WorkflowExecutionService workflowExecutionService,
        TaskActionResolver taskActionResolver,
        SchedulerProperties properties,
        PlatformTransactionManager transactionManager
    ) {
        this(
            workflowRepository,
            workflowVersionRepository,
            workflowRunRepository,
            taskRunRepository,
            workflowExecutionService,
            taskActionResolver,
            properties,
            transactionManager,
            null
        );
    }

    @Autowired
    public WorkflowRunService(
        WorkflowRepository workflowRepository,
        WorkflowVersionRepository workflowVersionRepository,
        WorkflowRunRepository workflowRunRepository,
        TaskRunRepository taskRunRepository,
        WorkflowExecutionService workflowExecutionService,
        TaskActionResolver taskActionResolver,
        SchedulerProperties properties,
        PlatformTransactionManager transactionManager,
        ProjectAuthorizationService authorizationService
    ) {
        this.workflowRepository = workflowRepository;
        this.workflowVersionRepository = workflowVersionRepository;
        this.workflowRunRepository = workflowRunRepository;
        this.taskRunRepository = taskRunRepository;
        this.workflowExecutionService = workflowExecutionService;
        this.taskActionResolver = taskActionResolver;
        this.properties = properties;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.authorizationService = authorizationService;
    }

    /**
     * Executes a workflow by resolving its specified version (or latest published version if omitted)
     * within bounded server capacity and synchronous timeout.
     * Requires DEVELOPER or ADMIN role on the parent project.
     *
     * @param workflowId parent workflow UUID
     * @param request execution parameters (versionNumber, triggeredBy, concurrency)
     * @return persisted WorkflowRun in terminal state
     * @throws ResourceNotFoundException if workflowId does not exist or requested version does not exist
     */
    public WorkflowRun executeWorkflow(UUID workflowId, ExecuteRunRequest request) {
        Objects.requireNonNull(workflowId, "Workflow ID must not be null");
        if (authorizationService != null) {
            com.flowforge.domain.Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found: " + workflowId));
            authorizationService.requireExecuteAccess(workflow.getProject().getId());
        } else {
            if (!workflowRepository.existsById(workflowId)) {
                throw new ResourceNotFoundException("Workflow not found: " + workflowId);
            }
        }

        Integer versionNumber = request != null ? request.versionNumber() : null;
        WorkflowVersion version;
        if (versionNumber != null) {
            version = workflowVersionRepository.findByWorkflowIdAndVersionNumber(workflowId, versionNumber)
                .orElseThrow(() -> new ResourceNotFoundException(
                    "Workflow version " + versionNumber + " not found for workflow " + workflowId));
        } else {
            version = workflowVersionRepository.findFirstByWorkflowIdOrderByVersionNumberDesc(workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow has no saved versions"));
        }

        String triggeredBy = (request != null && request.triggeredBy() != null && !request.triggeredBy().isBlank())
            ? request.triggeredBy().trim()
            : "manual";

        Integer concurrency = request != null ? request.concurrency() : null;

        return executeVersion(version.getId(), triggeredBy, concurrency);
    }

    /**
     * Executes a specific immutable WorkflowVersion snapshot with default concurrency.
     *
     * @param workflowVersionId UUID of the persisted version snapshot
     * @param triggeredBy identifier of trigger source (e.g. "manual", "api")
     * @return persisted WorkflowRun in terminal state
     */
    public WorkflowRun executeVersion(UUID workflowVersionId, String triggeredBy) {
        return executeVersion(workflowVersionId, triggeredBy, null);
    }

    /**
     * Executes a specific immutable WorkflowVersion snapshot within bounded concurrency and timeout.
     *
     * @param workflowVersionId UUID of the persisted version snapshot
     * @param triggeredBy identifier of trigger source (e.g. "manual", "api")
     * @param requestedConcurrency optional concurrency limit override (1..4)
     * @return persisted WorkflowRun in terminal state
     * @throws ResourceNotFoundException if workflowVersionId does not exist
     * @throws InvalidDagException if the version snapshot is an invalid DAG draft
     * @throws WorkflowCapacityExhaustedException if server execution capacity is saturated
     * @throws WorkflowExecutionTimeoutException if execution exceeds synchronous timeout limit
     */
    public WorkflowRun executeVersion(UUID workflowVersionId, String triggeredBy, Integer requestedConcurrency) {
        Objects.requireNonNull(workflowVersionId, "Workflow version ID must not be null");

        // 1. Snapshot lookup & DAG validation before admission or persistence
        WorkflowVersion version = workflowVersionRepository.findById(workflowVersionId)
            .orElseThrow(() -> new ResourceNotFoundException("Workflow version not found: " + workflowVersionId));

        List<TaskDefinitionDto> taskDefs = extractTaskDefinitions(version.getGraphPayload());
        List<EdgeDto> edgeDtos = extractEdges(version.getGraphPayload());

        TaskGraph graph = workflowExecutionService.buildTaskGraph(taskDefs, edgeDtos);
        DagValidationResult validation = DagEngine.validate(graph);
        if (Boolean.FALSE.equals(version.getIsValidDag()) || !validation.isValid()) {
            throw new InvalidDagException(
                "Cannot execute workflow version with invalid DAG: " + workflowVersionId
                    + (validation.errors().isEmpty() ? "" : " - " + String.join("; ", validation.errors())),
                validation
            );
        }

        TaskRegistry registry = taskActionResolver.resolveRegistry(taskDefs);

        int concurrency = workflowExecutionService.clampConcurrency(requestedConcurrency);
        long timeout = properties.getExecutionTimeoutSeconds();
        TimeUnit unit = TimeUnit.SECONDS;

        // 2. Admission Gate (shared capacity semaphore)
        boolean acquired = workflowExecutionService.getSemaphore().tryAcquire();
        if (!acquired) {
            throw new WorkflowCapacityExhaustedException(
                "Server workflow execution capacity is exhausted (max "
                    + properties.getMaxConcurrentWorkflows()
                    + " concurrent workflows). Please retry shortly."
            );
        }

        // 3. Initialize Durable State in discrete Transaction 1
        UUID runId;
        try {
            runId = transactionTemplate.execute(status -> {
                WorkflowRun run = new WorkflowRun(version, triggeredBy);
                run.setStatus(WorkflowRunState.RUNNING);
                run.setStartedAt(Instant.now());
                WorkflowRun savedRun = workflowRunRepository.save(run);

                for (TaskDefinitionDto taskDef : taskDefs) {
                    TaskRun taskRun = new TaskRun(savedRun, taskDef.id().trim());
                    taskRun.setStatus(TaskState.PENDING);
                    taskRun.setAttemptCount(1);
                    taskRunRepository.save(taskRun);
                }
                return savedRun.getId();
            });
        } catch (Throwable t) {
            // Roll back capacity permit if database initialization failed
            workflowExecutionService.getSemaphore().release();
            log.error("Failed to initialize durable workflow run for version {}", workflowVersionId, t);
            throw t;
        }

        // 4. Construct live listener for real-time task lifecycle persistence
        TaskExecutionListener listener = new TaskExecutionListener() {
            @Override
            public void onTaskStarted(String taskId, int attemptCount, Instant startedAt) {
                updateTaskRunSafely(runId, taskId, tr -> {
                    tr.setStatus(TaskState.RUNNING);
                    if (tr.getStartedAt() == null) {
                        tr.setStartedAt(startedAt);
                    }
                    tr.setAttemptCount(Math.max(1, attemptCount));
                });
            }

            @Override
            public void onTaskCompleted(String taskId, int attemptCount, Instant startedAt, Instant completedAt, Long durationMs) {
                updateTaskRunSafely(runId, taskId, tr -> {
                    tr.setStatus(TaskState.COMPLETED);
                    if (tr.getStartedAt() == null) {
                        tr.setStartedAt(startedAt);
                    }
                    tr.setCompletedAt(completedAt);
                    tr.setDurationMs(durationMs);
                    tr.setAttemptCount(Math.max(1, attemptCount));
                    tr.setErrorMessage(null);
                });
            }

            @Override
            public void onTaskFailed(String taskId, int attemptCount, Instant startedAt, Instant completedAt, Long durationMs, Throwable error) {
                String sanitized = TaskErrorSanitizer.sanitize(error);
                updateTaskRunSafely(runId, taskId, tr -> {
                    tr.setStatus(TaskState.FAILED);
                    if (tr.getStartedAt() == null) {
                        tr.setStartedAt(startedAt);
                    }
                    tr.setCompletedAt(completedAt);
                    tr.setDurationMs(durationMs);
                    tr.setAttemptCount(Math.max(1, attemptCount));
                    tr.setErrorMessage(sanitized);
                });
            }

            @Override
            public void onTaskRetrying(String taskId, int attemptCount, Throwable error, Duration nextDelay) {
                updateTaskRunSafely(runId, taskId, tr -> {
                    tr.setStatus(TaskState.PENDING);
                    tr.setAttemptCount(Math.max(1, attemptCount));
                });
            }

            @Override
            public void onTaskCancelled(String taskId, Instant completedAt) {
                updateTaskRunSafely(runId, taskId, tr -> {
                    tr.setStatus(TaskState.CANCELLED);
                    tr.setCompletedAt(completedAt);
                });
            }
        };

        // 5. Dispatch execution under acquired permit (NO active DB transaction during execution)
        WorkflowExecutionResult result;
        try {
            result = workflowExecutionService.executeGraphUnderPermit(
                graph,
                registry,
                concurrency,
                timeout,
                unit,
                listener,
                null
            );
        } catch (TimeoutException e) {
            reconcileTerminalRunAndTasks(
                runId,
                WorkflowRunState.CANCELLED,
                Instant.now(),
                "Workflow execution exceeded maximum synchronous limit of " + timeout + " " + unit.name().toLowerCase()
            );
            throw new WorkflowExecutionTimeoutException(
                "Workflow execution exceeded maximum synchronous limit of " + timeout + " " + unit.name().toLowerCase(),
                e
            );
        } catch (Throwable t) {
            reconcileTerminalRunAndTasks(
                runId,
                WorkflowRunState.FAILED,
                Instant.now(),
                "Workflow execution failed: " + TaskErrorSanitizer.sanitize(t)
            );
            if (t instanceof RuntimeException re) {
                throw re;
            }
            throw new RuntimeException("Workflow execution failed", t);
        }

        // 6. Terminal Reconciliation in discrete Transaction 2
        try {
            return transactionTemplate.execute(status -> {
                WorkflowRun run = workflowRunRepository.findByIdWithDetails(runId)
                    .orElseGet(() -> workflowRunRepository.findById(runId)
                        .orElseThrow(() -> new IllegalStateException("WorkflowRun not found: " + runId)));

                // Reconcile all tasks to match final execution results
                for (Map.Entry<String, TaskExecutionResult> entry : result.taskResults().entrySet()) {
                    String taskId = entry.getKey();
                    TaskExecutionResult taskResult = entry.getValue();
                    TaskRun taskRun = taskRunRepository.findByWorkflowRunIdAndTaskId(runId, taskId).orElse(null);
                    if (taskRun != null) {
                        taskRun.setStatus(taskResult.state());
                        taskRun.setStartedAt(taskResult.startedAt());
                        taskRun.setCompletedAt(taskResult.completedAt());
                        if (taskResult.startedAt() != null && taskResult.completedAt() != null) {
                            taskRun.setDurationMs(Math.max(0L, Duration.between(taskResult.startedAt(), taskResult.completedAt()).toMillis()));
                        }
                        taskRun.setAttemptCount(Math.max(1, taskResult.attemptCount()));
                        taskRun.setErrorMessage(TaskErrorSanitizer.sanitize(taskResult.error()));
                        taskRunRepository.save(taskRun);
                    }
                }

                run.setStatus(result.state());
                run.setCompletedAt(result.completedAt());
                if (run.getStartedAt() != null && result.completedAt() != null) {
                    run.setDurationMs(Math.max(0L, Duration.between(run.getStartedAt(), result.completedAt()).toMillis()));
                }
                return workflowRunRepository.save(run);
            });
        } catch (Throwable terminalPersistenceError) {
            log.error(
                "Failed to reconcile terminal state for workflow run {}. Attempting bounded best-effort recovery.",
                runId, terminalPersistenceError
            );
            try {
                attemptTerminalRecovery(runId, result.state(), Instant.now());
            } catch (Throwable recoveryError) {
                if (recoveryError != terminalPersistenceError) {
                    terminalPersistenceError.addSuppressed(recoveryError);
                }
            }
            throw terminalPersistenceError;
        }
    }

    public boolean updateTaskRunSafely(UUID runId, String taskId, Consumer<TaskRun> updater) {
        try {
            return Boolean.TRUE.equals(transactionTemplate.execute(status -> {
                WorkflowRun run = workflowRunRepository.findById(runId).orElse(null);
                if (run == null || run.getStatus().isTerminal()) {
                    log.debug("Skipping task update for task {} in run {}: workflow is already terminal ({})",
                        taskId, runId, run != null ? run.getStatus() : "null");
                    return false;
                }

                TaskRun taskRun = taskRunRepository.findByWorkflowRunIdAndTaskId(runId, taskId).orElse(null);
                if (taskRun == null || taskRun.getStatus().isTerminal()) {
                    log.debug("Skipping task update for task {} in run {}: task is already terminal ({})",
                        taskId, runId, taskRun != null ? taskRun.getStatus() : "null");
                    return false;
                }

                // Create detached snapshot to prevent premature JPA dirty-checking flushes if conditional update is rejected
                TaskRun snapshot = new TaskRun(
                    taskRun.getId(),
                    run,
                    taskRun.getTaskId(),
                    taskRun.getStatus(),
                    taskRun.getAttemptCount(),
                    taskRun.getStartedAt(),
                    taskRun.getCompletedAt(),
                    taskRun.getDurationMs(),
                    taskRun.getErrorMessage()
                );

                updater.accept(snapshot);

                // Atomic conditional database update checking both task and parent run non-terminal status
                int updated = taskRunRepository.updateTaskRunIfNonTerminal(
                    runId,
                    taskId,
                    snapshot.getStatus(),
                    snapshot.getAttemptCount(),
                    snapshot.getStartedAt(),
                    snapshot.getCompletedAt(),
                    snapshot.getDurationMs(),
                    snapshot.getErrorMessage()
                );

                if (updated == 0) {
                    status.setRollbackOnly();
                    log.debug("Conditional update matched 0 rows for task {} in run {}: terminal state detected", taskId, runId);
                    return false;
                }
                return true;
            }));
        } catch (Throwable t) {
            log.warn("Failed to persist task run update for task {} in run {}: {}", taskId, runId, t.getMessage());
            return false;
        }
    }

    public void reconcileTerminalRunAndTasks(
        UUID runId,
        WorkflowRunState terminalWorkflowState,
        Instant completedAt,
        String taskErrorMessage
    ) {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                WorkflowRun run = workflowRunRepository.findById(runId).orElse(null);
                if (run != null && !run.getStatus().isTerminal()) {
                    run.setStatus(terminalWorkflowState);
                    run.setCompletedAt(completedAt);
                    if (run.getStartedAt() != null) {
                        run.setDurationMs(Math.max(0L, Duration.between(run.getStartedAt(), completedAt).toMillis()));
                    }
                    workflowRunRepository.save(run);
                }

                List<TaskRun> taskRuns = taskRunRepository.findByWorkflowRunId(runId);
                for (TaskRun tr : taskRuns) {
                    if (!tr.getStatus().isTerminal()) {
                        tr.setStatus(TaskState.CANCELLED);
                        tr.setCompletedAt(completedAt);
                        if (tr.getStartedAt() != null) {
                            tr.setDurationMs(Math.max(0L, Duration.between(tr.getStartedAt(), completedAt).toMillis()));
                        } else {
                            tr.setDurationMs(0L);
                        }
                        if (tr.getErrorMessage() == null && taskErrorMessage != null) {
                            tr.setErrorMessage(taskErrorMessage);
                        }
                        taskRunRepository.save(tr);
                    } else if (tr.getStatus() == TaskState.CANCELLED && tr.getErrorMessage() == null && taskErrorMessage != null) {
                        tr.setErrorMessage(taskErrorMessage);
                        taskRunRepository.save(tr);
                    }
                }
            });
        } catch (Throwable primaryError) {
            log.error("Failed to reconcile terminal state {} for run {}. Attempting bounded recovery: {}",
                terminalWorkflowState, runId, primaryError.getMessage(), primaryError);
            try {
                attemptTerminalRecovery(runId, terminalWorkflowState, completedAt);
            } catch (Throwable recoveryError) {
                RuntimeException failure = new RuntimeException("Primary terminal reconciliation and recovery both failed for run " + runId, recoveryError);
                if (recoveryError != primaryError) {
                    failure.addSuppressed(primaryError);
                }
                throw failure;
            }
        }
    }

    public void attemptTerminalRecovery(UUID runId, WorkflowRunState targetState, Instant completedAt) {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                workflowRunRepository.findById(runId).ifPresent(run -> {
                    run.setStatus(targetState != null ? targetState : WorkflowRunState.FAILED);
                    run.setCompletedAt(completedAt);
                    if (run.getStartedAt() != null) {
                        run.setDurationMs(Math.max(0L, Duration.between(run.getStartedAt(), completedAt).toMillis()));
                    }
                    workflowRunRepository.save(run);
                });
            });
        } catch (Throwable recoveryError) {
            log.error(
                "CRITICAL: Failed to mark workflow run {} as terminal during best-effort recovery. "
                    + "Workflow run remains in non-terminal state in database: {}",
                runId, recoveryError.getMessage(), recoveryError
            );
            throw recoveryError;
        }
    }

    /**
     * Extracts TaskDefinitionDto instances from a persisted graph payload (supporting both canvas and DTO formats).
     */
    public List<TaskDefinitionDto> extractTaskDefinitions(JsonNode graphPayload) {
        if (graphPayload == null || !graphPayload.isObject()) {
            return Collections.emptyList();
        }

        JsonNode nodes = graphPayload.get("nodes");
        if (nodes == null || !nodes.isArray()) {
            nodes = graphPayload.get("tasks");
        }
        if (nodes == null || !nodes.isArray()) {
            return Collections.emptyList();
        }

        List<TaskDefinitionDto> tasks = new ArrayList<>();
        for (JsonNode node : nodes) {
            if (!node.isObject()) continue;
            JsonNode idNode = node.get("id");
            if (idNode == null || idNode.isNull() || idNode.asText().isBlank()) continue;
            String id = idNode.asText().trim();

            TaskActionDto action = null;
            RetryPolicyDto retryPolicy = null;

            // 1. Direct DTO format
            if (node.has("action") && node.get("action").isObject()) {
                JsonNode aNode = node.get("action");
                TaskActionType type = TaskActionType.NO_OP;
                if (aNode.has("type") && !aNode.get("type").isNull()) {
                    try {
                        type = TaskActionType.valueOf(aNode.get("type").asText().trim().toUpperCase());
                    } catch (IllegalArgumentException ignored) {}
                }
                Long delayMs = aNode.has("delayMs") && aNode.get("delayMs").isNumber() ? aNode.get("delayMs").asLong() : null;
                Integer failUntil = aNode.has("failUntilAttempt") && aNode.get("failUntilAttempt").isNumber() ? aNode.get("failUntilAttempt").asInt() : null;
                String errMsg = aNode.has("errorMessage") && aNode.get("errorMessage").isTextual() ? aNode.get("errorMessage").asText().trim() : null;
                action = new TaskActionDto(type, delayMs, failUntil, errMsg);
            }

            if (node.has("retryPolicy") && node.get("retryPolicy").isObject()) {
                JsonNode rNode = node.get("retryPolicy");
                Integer maxAttempts = rNode.has("maxAttempts") && rNode.get("maxAttempts").isNumber() ? rNode.get("maxAttempts").asInt() : 1;
                BackoffStrategy strategy = BackoffStrategy.NONE;
                if (rNode.has("backoffStrategy") && !rNode.get("backoffStrategy").isNull()) {
                    try {
                        strategy = BackoffStrategy.valueOf(rNode.get("backoffStrategy").asText().trim().toUpperCase());
                    } catch (IllegalArgumentException ignored) {}
                }
                Long initialDelay = rNode.has("initialDelayMs") && rNode.get("initialDelayMs").isNumber() ? rNode.get("initialDelayMs").asLong() : 0L;
                Long maxDelay = rNode.has("maxDelayMs") && rNode.get("maxDelayMs").isNumber() ? rNode.get("maxDelayMs").asLong() : null;
                Double multiplier = rNode.has("backoffMultiplier") && rNode.get("backoffMultiplier").isNumber() ? rNode.get("backoffMultiplier").asDouble() : null;
                JitterStrategy jitter = JitterStrategy.NONE;
                if (rNode.has("jitterStrategy") && !rNode.get("jitterStrategy").isNull()) {
                    try {
                        jitter = JitterStrategy.valueOf(rNode.get("jitterStrategy").asText().trim().toUpperCase());
                    } catch (IllegalArgumentException ignored) {}
                }
                retryPolicy = new RetryPolicyDto(maxAttempts, strategy, initialDelay, maxDelay, multiplier, jitter);
            }

            // 2. React Flow canvas format (node.data)
            JsonNode data = node.get("data");
            if (data != null && data.isObject()) {
                if (action == null) {
                    action = extractActionFromData(data);
                }
                if (retryPolicy == null) {
                    retryPolicy = extractRetryFromData(data);
                }
            }

            if (action == null) {
                action = new TaskActionDto(TaskActionType.NO_OP, null, null, null);
            }
            if (retryPolicy == null) {
                retryPolicy = new RetryPolicyDto(1, BackoffStrategy.NONE, 0L, null, null, null);
            }

            tasks.add(new TaskDefinitionDto(id, action, retryPolicy));
        }

        return tasks;
    }

    private TaskActionDto extractActionFromData(JsonNode data) {
        JsonNode params = data.get("parameters");
        if (params != null && params.isObject()) {
            JsonNode sim = params.get("simulation");
            if (sim != null && sim.isObject()) {
                return parseActionNode(sim);
            }
            if (params.has("action") || params.has("type")) {
                return parseActionNode(params);
            }
        }

        String taskType = data.path("taskType").asText("");
        if ("DELAY_WAIT".equalsIgnoreCase(taskType)) {
            long delay = 500L;
            if (params != null && params.isObject()) {
                if (params.has("delayMs") && params.get("delayMs").isNumber()) {
                    delay = params.get("delayMs").asLong();
                } else if (params.has("delay") && params.get("delay").isNumber()) {
                    delay = params.get("delay").asLong();
                }
            }
            return new TaskActionDto(TaskActionType.DELAY, Math.min(5000L, Math.max(0L, delay)), null, null);
        }

        return new TaskActionDto(TaskActionType.NO_OP, null, null, null);
    }

    private TaskActionDto parseActionNode(JsonNode node) {
        JsonNode actNode = node.has("action") ? node.get("action") : node.get("type");
        TaskActionType type = TaskActionType.NO_OP;
        if (actNode != null && !actNode.isNull()) {
            try {
                type = TaskActionType.valueOf(actNode.asText().trim().toUpperCase());
            } catch (IllegalArgumentException ignored) {}
        }

        Long delayMs = null;
        if (node.has("delayMs") && node.get("delayMs").isNumber()) {
            delayMs = node.get("delayMs").asLong();
        } else if (node.has("delay") && node.get("delay").isNumber()) {
            delayMs = node.get("delay").asLong();
        }

        Integer failUntil = null;
        if (node.has("failUntilAttempt") && node.get("failUntilAttempt").isNumber()) {
            failUntil = node.get("failUntilAttempt").asInt();
        } else if (node.has("threshold") && node.get("threshold").isNumber()) {
            failUntil = node.get("threshold").asInt();
        }

        String errorMsg = null;
        if (node.has("errorMessage") && !node.get("errorMessage").isNull()) {
            errorMsg = node.get("errorMessage").asText().trim();
        } else if (node.has("error") && !node.get("error").isNull()) {
            errorMsg = node.get("error").asText().trim();
        }

        return new TaskActionDto(type, delayMs, failUntil, errorMsg);
    }

    private RetryPolicyDto extractRetryFromData(JsonNode data) {
        int maxRetries = 0;
        if (data.has("maxRetries") && data.get("maxRetries").isNumber()) {
            maxRetries = data.get("maxRetries").asInt();
        }

        JsonNode params = data.get("parameters");
        Long initialDelayMs = null;
        if (params != null && params.isObject()) {
            JsonNode retry = params.get("retry");
            if (retry != null && retry.isObject()) {
                if (retry.has("initialDelayMs") && retry.get("initialDelayMs").isNumber()) {
                    initialDelayMs = retry.get("initialDelayMs").asLong();
                } else if (retry.has("retryInitialDelayMs") && retry.get("retryInitialDelayMs").isNumber()) {
                    initialDelayMs = retry.get("retryInitialDelayMs").asLong();
                }
            } else if (params.has("retryInitialDelayMs") && params.get("retryInitialDelayMs").isNumber()) {
                initialDelayMs = params.get("retryInitialDelayMs").asLong();
            } else if (params.has("initialDelayMs") && params.get("initialDelayMs").isNumber()) {
                initialDelayMs = params.get("initialDelayMs").asLong();
            }
        }

        if (maxRetries > 0) {
            int maxAttempts = Math.min(5, maxRetries + 1);
            long delay = initialDelayMs != null ? Math.min(2000L, Math.max(0L, initialDelayMs)) : 50L;
            return new RetryPolicyDto(maxAttempts, BackoffStrategy.FIXED, delay, null, null, null);
        }

        return new RetryPolicyDto(1, BackoffStrategy.NONE, 0L, null, null, null);
    }

    /**
     * Extracts EdgeDto instances from a persisted graph payload.
     */
    public List<EdgeDto> extractEdges(JsonNode graphPayload) {
        if (graphPayload == null || !graphPayload.isObject()) {
            return Collections.emptyList();
        }
        JsonNode edges = graphPayload.get("edges");
        if (edges == null || !edges.isArray()) {
            return Collections.emptyList();
        }

        List<EdgeDto> edgeList = new ArrayList<>();
        for (JsonNode edge : edges) {
            if (!edge.isObject()) continue;
            JsonNode srcNode = edge.get("source");
            JsonNode tgtNode = edge.get("target");
            if (srcNode == null || srcNode.isNull() || tgtNode == null || tgtNode.isNull()) continue;
            String src = srcNode.asText().trim();
            String tgt = tgtNode.asText().trim();
            if (!src.isEmpty() && !tgt.isEmpty()) {
                edgeList.add(new EdgeDto(src, tgt));
            }
        }
        return edgeList;
    }

    @Transactional(readOnly = true)
    public Optional<WorkflowRun> getRun(UUID runId) {
        Objects.requireNonNull(runId, "Run ID must not be null");
        return workflowRunRepository.findById(runId);
    }

    @Transactional(readOnly = true)
    public WorkflowRun getRunById(UUID runId) {
        Objects.requireNonNull(runId, "Run ID must not be null");
        WorkflowRun run = workflowRunRepository.findByIdWithDetails(runId)
            .orElseThrow(() -> new ResourceNotFoundException("Workflow run not found: " + runId));
        if (authorizationService != null) {
            authorizationService.requireReadAccess(run.getWorkflowVersion().getWorkflow().getProject().getId());
        }
        return run;
    }

    @Transactional(readOnly = true)
    public Page<WorkflowRun> listRunsForVersion(UUID workflowVersionId, Pageable pageable) {
        Objects.requireNonNull(workflowVersionId, "Workflow version ID must not be null");
        if (authorizationService != null) {
            WorkflowVersion version = workflowVersionRepository.findById(workflowVersionId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow version not found: " + workflowVersionId));
            authorizationService.requireReadAccess(version.getWorkflow().getProject().getId());
        }
        return workflowRunRepository.findByWorkflowVersionIdOrderByCreatedAtDesc(workflowVersionId, pageable);
    }

    @Transactional(readOnly = true)
    public List<TaskRun> listTaskRunsForRun(UUID runId) {
        Objects.requireNonNull(runId, "Run ID must not be null");
        if (authorizationService != null) {
            WorkflowRun run = workflowRunRepository.findByIdWithDetails(runId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow run not found: " + runId));
            authorizationService.requireReadAccess(run.getWorkflowVersion().getWorkflow().getProject().getId());
        } else {
            if (!workflowRunRepository.existsById(runId)) {
                throw new ResourceNotFoundException("Workflow run not found: " + runId);
            }
        }
        return taskRunRepository.findByWorkflowRunIdOrderByCreatedAtAscIdAsc(runId);
    }

    @Transactional(readOnly = true)
    public Page<WorkflowRun> listRunsForWorkflow(UUID workflowId, Pageable pageable) {
        Objects.requireNonNull(workflowId, "Workflow ID must not be null");
        Objects.requireNonNull(pageable, "Pageable must not be null");
        if (authorizationService != null) {
            com.flowforge.domain.Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found: " + workflowId));
            authorizationService.requireReadAccess(workflow.getProject().getId());
        } else {
            if (!workflowRepository.existsById(workflowId)) {
                throw new ResourceNotFoundException("Workflow not found: " + workflowId);
            }
        }
        Pageable effectivePageable = pageable.getPageSize() > 100
            ? org.springframework.data.domain.PageRequest.of(Math.max(0, pageable.getPageNumber()), 100, pageable.getSort())
            : pageable;
        return workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflowId, effectivePageable);
    }
}
