package com.flowforge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flowforge.api.TaskActionResolver;
import com.flowforge.api.WorkflowExecutionService;
import com.flowforge.config.SchedulerProperties;
import com.flowforge.core.InvalidDagException;
import com.flowforge.domain.*;
import com.flowforge.persistence.repository.TaskRunRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowRunRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import com.flowforge.scheduler.TaskState;
import com.flowforge.scheduler.WorkflowRunState;
import com.flowforge.service.exception.ResourceNotFoundException;
import com.flowforge.service.exception.WorkflowCapacityExhaustedException;
import com.flowforge.service.exception.WorkflowExecutionTimeoutException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import com.flowforge.api.dto.ExecuteRunRequest;
import com.flowforge.api.dto.TaskDefinitionDto;
import com.flowforge.scheduler.RetryPolicy;
import com.flowforge.scheduler.TaskExecutionListener;
import com.flowforge.scheduler.TaskRegistry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class WorkflowRunServiceTest {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    private WorkflowRepository workflowRepository;
    private WorkflowVersionRepository workflowVersionRepository;
    private WorkflowRunRepository workflowRunRepository;
    private TaskRunRepository taskRunRepository;
    private SchedulerProperties properties;
    private TaskActionResolver taskActionResolver;
    private WorkflowExecutionService executionService;
    private PlatformTransactionManager transactionManager;
    private WorkflowRunService runService;

    // In-memory backing stores to simulate real transactional repository behavior
    private Map<UUID, WorkflowVersion> versionStore;
    private Map<UUID, WorkflowRun> runStore;
    private Map<String, TaskRun> taskRunStore;

    @BeforeEach
    void setUp() {
        versionStore = new ConcurrentHashMap<>();
        runStore = new ConcurrentHashMap<>();
        taskRunStore = new ConcurrentHashMap<>();

        workflowRepository = mock(WorkflowRepository.class);
        workflowVersionRepository = mock(WorkflowVersionRepository.class);
        workflowRunRepository = mock(WorkflowRunRepository.class);
        taskRunRepository = mock(TaskRunRepository.class);

        when(workflowVersionRepository.findById(any(UUID.class)))
            .thenAnswer(inv -> Optional.ofNullable(versionStore.get(inv.getArgument(0))));

        when(workflowVersionRepository.findByWorkflowIdAndVersionNumber(any(UUID.class), anyInt()))
            .thenAnswer(inv -> {
                UUID wfId = inv.getArgument(0);
                int vNum = inv.getArgument(1);
                return versionStore.values().stream()
                    .filter(v -> v.getWorkflow() != null && wfId.equals(v.getWorkflow().getId()) && v.getVersionNumber() == vNum)
                    .findFirst();
            });

        when(workflowVersionRepository.findFirstByWorkflowIdOrderByVersionNumberDesc(any(UUID.class)))
            .thenAnswer(inv -> {
                UUID wfId = inv.getArgument(0);
                return versionStore.values().stream()
                    .filter(v -> v.getWorkflow() != null && wfId.equals(v.getWorkflow().getId()))
                    .max(Comparator.comparingInt(WorkflowVersion::getVersionNumber));
            });

        when(workflowRunRepository.save(any(WorkflowRun.class))).thenAnswer(inv -> {
            WorkflowRun run = inv.getArgument(0);
            if (run.getId() == null) {
                run.setId(UUID.randomUUID());
            }
            runStore.put(run.getId(), run);
            return run;
        });

        when(workflowRunRepository.findById(any(UUID.class)))
            .thenAnswer(inv -> Optional.ofNullable(runStore.get(inv.getArgument(0))));

        when(workflowRunRepository.findByIdWithDetails(any(UUID.class)))
            .thenAnswer(inv -> Optional.ofNullable(runStore.get(inv.getArgument(0))));

        when(workflowRunRepository.existsById(any(UUID.class)))
            .thenAnswer(inv -> runStore.containsKey(inv.getArgument(0)));

        when(taskRunRepository.save(any(TaskRun.class))).thenAnswer(inv -> {
            TaskRun tr = inv.getArgument(0);
            if (tr.getId() == null) {
                tr.setId(UUID.randomUUID());
            }
            taskRunStore.put(tr.getWorkflowRun().getId() + ":" + tr.getTaskId(), tr);
            return tr;
        });

        when(taskRunRepository.findByWorkflowRunIdAndTaskId(any(UUID.class), anyString()))
            .thenAnswer(inv -> Optional.ofNullable(taskRunStore.get(inv.getArgument(0) + ":" + inv.getArgument(1))));

        when(taskRunRepository.findByWorkflowRunId(any(UUID.class))).thenAnswer(inv -> {
            UUID runId = inv.getArgument(0);
            return taskRunStore.values().stream()
                .filter(tr -> tr.getWorkflowRun().getId().equals(runId))
                .toList();
        });

        when(taskRunRepository.findByWorkflowRunIdOrderByCreatedAtAscIdAsc(any(UUID.class))).thenAnswer(inv -> {
            UUID runId = inv.getArgument(0);
            return taskRunStore.values().stream()
                .filter(tr -> tr.getWorkflowRun().getId().equals(runId))
                .sorted(Comparator.comparing(TaskRun::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                    .thenComparing(TaskRun::getId, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        });

        when(taskRunRepository.updateTaskRunIfNonTerminal(
            any(UUID.class), anyString(), any(TaskState.class), any(), any(), any(), any(), any()
        )).thenAnswer(inv -> {
            UUID runId = inv.getArgument(0);
            String taskId = inv.getArgument(1);
            TaskState newStatus = inv.getArgument(2);
            Integer attempts = inv.getArgument(3);
            Instant startedAt = inv.getArgument(4);
            Instant completedAt = inv.getArgument(5);
            Long durationMs = inv.getArgument(6);
            String errorMsg = inv.getArgument(7);

            WorkflowRun run = runStore.get(runId);
            if (run == null || run.getStatus().isTerminal()) {
                return 0;
            }
            TaskRun tr = taskRunStore.get(runId + ":" + taskId);
            if (tr == null || tr.getStatus().isTerminal()) {
                return 0;
            }
            tr.setStatus(newStatus);
            if (attempts != null) tr.setAttemptCount(attempts);
            if (startedAt != null && tr.getStartedAt() == null) tr.setStartedAt(startedAt);
            if (completedAt != null) tr.setCompletedAt(completedAt);
            if (durationMs != null) tr.setDurationMs(durationMs);
            tr.setErrorMessage(errorMsg);
            return 1;
        });

        properties = new SchedulerProperties();
        properties.setMaxConcurrentWorkflows(2);
        properties.setExecutionTimeoutSeconds(5);

        taskActionResolver = new TaskActionResolver();
        executionService = new WorkflowExecutionService(properties, taskActionResolver);

        transactionManager = mock(PlatformTransactionManager.class);
        when(transactionManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());

        runService = new WorkflowRunService(
            workflowRepository,
            workflowVersionRepository,
            workflowRunRepository,
            taskRunRepository,
            executionService,
            taskActionResolver,
            properties,
            transactionManager
        );
    }

    @AfterEach
    void tearDown() {
        executionService.shutdown();
    }

    private WorkflowVersion createTestVersion(boolean isValidDag, ObjectNode payload) {
        Project project = new Project("Test Project", "test-proj", "Test");
        project.setId(UUID.randomUUID());
        Workflow workflow = new Workflow(project, "Test Workflow", "test-wf", "Test");
        workflow.setId(UUID.randomUUID());
        UUID versionId = UUID.randomUUID();
        WorkflowVersion version = new WorkflowVersion(
            versionId,
            workflow,
            1,
            "v1.0",
            "Snapshot 1",
            payload,
            payload.has("nodes") ? payload.get("nodes").size() : 0,
            payload.has("edges") ? payload.get("edges").size() : 0,
            isValidDag
        );
        versionStore.put(versionId, version);
        return version;
    }

    @Test
    @DisplayName("1. Successful run: persists WorkflowRun and TaskRun entities with COMPLETED states, attempt count, and duration")
    void executeVersion_successfulRun() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "task-A").putObject("data").put("taskType", "NO_OP");
        nodes.addObject().put("id", "task-B").putObject("data").put("taskType", "NO_OP");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "task-A").put("target", "task-B");

        WorkflowVersion version = createTestVersion(true, payload);

        WorkflowRun result = runService.executeVersion(version.getId(), "user-alice");

        assertThat(result).isNotNull();
        assertThat(result.getId()).isNotNull();
        assertThat(result.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(result.getTriggeredBy()).isEqualTo("user-alice");
        assertThat(result.getStartedAt()).isNotNull();
        assertThat(result.getCompletedAt()).isNotNull();
        assertThat(result.getDurationMs()).isNotNull().isGreaterThanOrEqualTo(0L);

        List<TaskRun> tasks = runService.listTaskRunsForRun(result.getId());
        assertThat(tasks).hasSize(2);
        for (TaskRun tr : tasks) {
            assertThat(tr.getStatus()).isEqualTo(TaskState.COMPLETED);
            assertThat(tr.getAttemptCount()).isEqualTo(1);
            assertThat(tr.getStartedAt()).isNotNull();
            assertThat(tr.getCompletedAt()).isNotNull();
            assertThat(tr.getDurationMs()).isNotNull().isGreaterThanOrEqualTo(0L);
            assertThat(tr.getErrorMessage()).isNull();
        }

        // Verify permit was safely released
        assertThat(executionService.getSemaphore().availablePermits()).isEqualTo(properties.getMaxConcurrentWorkflows());
    }

    @Test
    @DisplayName("2. Task failure: persists FAILED status, sanitized error, and CANCELLED for downstream task")
    void executeVersion_taskFailureWithSanitizedError() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n1 = nodes.addObject();
        n1.put("id", "fail-task");
        ObjectNode p1 = n1.putObject("data").putObject("parameters").putObject("simulation");
        p1.put("action", "FAIL");
        p1.put("errorMessage", "Simulated database connection failure");

        ObjectNode n2 = nodes.addObject();
        n2.put("id", "downstream-task");
        n2.putObject("data").put("taskType", "NO_OP");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "fail-task").put("target", "downstream-task");

        WorkflowVersion version = createTestVersion(true, payload);

        WorkflowRun run = runService.executeVersion(version.getId(), "automated-ci");

        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.FAILED);
        assertThat(run.getDurationMs()).isNotNull().isGreaterThanOrEqualTo(0L);

        TaskRun failRun = taskRunStore.get(run.getId() + ":fail-task");
        assertThat(failRun).isNotNull();
        assertThat(failRun.getStatus()).isEqualTo(TaskState.FAILED);
        assertThat(failRun.getAttemptCount()).isEqualTo(1);
        assertThat(failRun.getErrorMessage()).isEqualTo("Simulated database connection failure");
        assertThat(failRun.getStartedAt()).isNotNull();
        assertThat(failRun.getCompletedAt()).isNotNull();

        TaskRun downstreamRun = taskRunStore.get(run.getId() + ":downstream-task");
        assertThat(downstreamRun).isNotNull();
        assertThat(downstreamRun.getStatus()).isEqualTo(TaskState.CANCELLED);
        assertThat(downstreamRun.getStartedAt()).isNull(); // Never began running
        assertThat(downstreamRun.getAttemptCount()).isEqualTo(1); // Default schema minimum
        assertThat(downstreamRun.getErrorMessage()).isNull();
    }

    @Test
    @DisplayName("3. Retry success: updates attempt count on the same durable TaskRun without creating duplicates")
    void executeVersion_retrySuccess() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n = nodes.addObject();
        n.put("id", "retry-task");
        ObjectNode data = n.putObject("data");
        data.put("maxRetries", 2); // 3 total attempts
        ObjectNode params = data.putObject("parameters");
        ObjectNode sim = params.putObject("simulation");
        sim.put("action", "FAIL_UNTIL_ATTEMPT");
        sim.put("failUntilAttempt", 2); // Fails on attempt 1, succeeds on attempt 2
        params.putObject("retry").put("initialDelayMs", 20);

        payload.putArray("edges");

        WorkflowVersion version = createTestVersion(true, payload);

        WorkflowRun run = runService.executeVersion(version.getId(), "retry-tester");

        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);

        TaskRun taskRun = taskRunStore.get(run.getId() + ":retry-task");
        assertThat(taskRun).isNotNull();
        assertThat(taskRun.getStatus()).isEqualTo(TaskState.COMPLETED);
        assertThat(taskRun.getAttemptCount()).isEqualTo(2); // 2 attempts observed
        assertThat(taskRun.getErrorMessage()).isNull(); // Final state has no error
    }

    @Test
    @DisplayName("4. Retry exhaustion: updates attempt count to total attempts made and sets FAILED with sanitized error")
    void executeVersion_retryExhaustion() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n = nodes.addObject();
        n.put("id", "exhaust-task");
        ObjectNode data = n.putObject("data");
        data.put("maxRetries", 1); // 2 total attempts allowed
        ObjectNode params = data.putObject("parameters");
        ObjectNode sim = params.putObject("simulation");
        sim.put("action", "FAIL_UNTIL_ATTEMPT");
        sim.put("failUntilAttempt", 3); // Needs 3 attempts to succeed, so 2 will exhaust
        sim.put("errorMessage", "Persistent network glitch");
        params.putObject("retry").put("initialDelayMs", 10);

        payload.putArray("edges");

        WorkflowVersion version = createTestVersion(true, payload);

        WorkflowRun run = runService.executeVersion(version.getId(), "exhaust-tester");

        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.FAILED);

        TaskRun taskRun = taskRunStore.get(run.getId() + ":exhaust-task");
        assertThat(taskRun).isNotNull();
        assertThat(taskRun.getStatus()).isEqualTo(TaskState.FAILED);
        assertThat(taskRun.getAttemptCount()).isEqualTo(2);
        assertThat(taskRun.getErrorMessage()).isEqualTo("Persistent network glitch");
    }

    @Test
    @DisplayName("5. Missing version throws ResourceNotFoundException and creates no WorkflowRun record")
    void executeVersion_missingVersionThrowsNotFound() {
        UUID nonExistentId = UUID.randomUUID();

        assertThatThrownBy(() -> runService.executeVersion(nonExistentId, "tester"))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow version not found");

        assertThat(runStore).isEmpty();
        assertThat(taskRunStore).isEmpty();
        assertThat(executionService.getSemaphore().availablePermits()).isEqualTo(properties.getMaxConcurrentWorkflows());
    }

    @Test
    @DisplayName("6. Invalid DAG version throws InvalidDagException and creates no WorkflowRun record")
    void executeVersion_invalidDagVersionThrowsInvalidDagException() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "A");
        nodes.addObject().put("id", "B");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "A").put("target", "B");
        edges.addObject().put("source", "B").put("target", "A"); // Cycle

        WorkflowVersion invalidVersion = createTestVersion(false, payload);

        assertThatThrownBy(() -> runService.executeVersion(invalidVersion.getId(), "tester"))
            .isInstanceOf(InvalidDagException.class)
            .hasMessageContaining("Cannot execute workflow version with invalid DAG");

        assertThat(runStore).isEmpty();
        assertThat(taskRunStore).isEmpty();
        assertThat(executionService.getSemaphore().availablePermits()).isEqualTo(properties.getMaxConcurrentWorkflows());
    }

    @Test
    @DisplayName("7. Persistence failure before execution releases permit and aborts execution without scheduling")
    void executeVersion_persistenceFailureBeforeExecution() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "task-1");
        payload.putArray("edges");
        WorkflowVersion version = createTestVersion(true, payload);

        // Force workflowRunRepository.save to fail
        doThrow(new DataIntegrityViolationException("Database constraint failure"))
            .when(workflowRunRepository).save(any(WorkflowRun.class));

        assertThatThrownBy(() -> runService.executeVersion(version.getId(), "tester"))
            .isInstanceOf(DataIntegrityViolationException.class);

        // Verify permit was not leaked
        assertThat(executionService.getSemaphore().availablePermits()).isEqualTo(properties.getMaxConcurrentWorkflows());
    }

    @Test
    @DisplayName("8. Capacity exhaustion throws WorkflowCapacityExhaustedException without creating a run record")
    void executeVersion_capacityExhaustedThrowsException() {
        // Drain all permits
        executionService.getSemaphore().acquireUninterruptibly(properties.getMaxConcurrentWorkflows());

        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "t1");
        payload.putArray("edges");
        WorkflowVersion version = createTestVersion(true, payload);

        try {
            assertThatThrownBy(() -> runService.executeVersion(version.getId(), "caller"))
                .isInstanceOf(WorkflowCapacityExhaustedException.class)
                .hasMessageContaining("capacity is exhausted");

            assertThat(runStore).isEmpty();
        } finally {
            executionService.getSemaphore().release(properties.getMaxConcurrentWorkflows());
        }
    }

    @Test
    @DisplayName("9. Timeout throws WorkflowExecutionTimeoutException and reconciles WorkflowRun and all TaskRuns to CANCELLED")
    void executeVersion_timeoutUpdatesRunStateAndThrows() {
        SchedulerProperties timeoutProps = new SchedulerProperties();
        timeoutProps.setMaxConcurrentWorkflows(1);
        timeoutProps.setExecutionTimeoutSeconds(1); // 1s timeout

        WorkflowExecutionService timeoutExecutionService = new WorkflowExecutionService(timeoutProps, taskActionResolver);
        WorkflowRunService timeoutRunService = new WorkflowRunService(
            workflowRepository,
            workflowVersionRepository,
            workflowRunRepository,
            taskRunRepository,
            timeoutExecutionService,
            taskActionResolver,
            timeoutProps,
            transactionManager
        );

        try {
            ObjectNode payload = objectMapper.createObjectNode();
            ArrayNode nodes = payload.putArray("nodes");
            ObjectNode n1 = nodes.addObject();
            n1.put("id", "slow-task");
            n1.putObject("data").putObject("parameters").putObject("simulation").put("action", "DELAY").put("delayMs", 3000);

            ObjectNode n2 = nodes.addObject();
            n2.put("id", "downstream-task");
            n2.putObject("data").put("taskType", "NO_OP");

            ArrayNode edges = payload.putArray("edges");
            edges.addObject().put("source", "slow-task").put("target", "downstream-task");

            WorkflowVersion version = createTestVersion(true, payload);

            assertThatThrownBy(() -> timeoutRunService.executeVersion(version.getId(), "timeout-test"))
                .isInstanceOf(WorkflowExecutionTimeoutException.class)
                .hasMessageContaining("exceeded maximum synchronous limit");

            // Verify WorkflowRun was marked CANCELLED with completedAt
            WorkflowRun run = runStore.values().iterator().next();
            assertThat(run.getStatus()).isEqualTo(WorkflowRunState.CANCELLED);
            assertThat(run.getCompletedAt()).isNotNull();
            assertThat(run.getDurationMs()).isNotNull();

            // Verify both slow-task and downstream-task were reconciled to CANCELLED
            TaskRun slowTask = taskRunStore.get(run.getId() + ":slow-task");
            assertThat(slowTask).isNotNull();
            assertThat(slowTask.getStatus()).isEqualTo(TaskState.CANCELLED);
            assertThat(slowTask.getCompletedAt()).isNotNull();
            assertThat(slowTask.getErrorMessage()).contains("Workflow execution exceeded maximum synchronous limit");

            TaskRun downstreamTask = taskRunStore.get(run.getId() + ":downstream-task");
            assertThat(downstreamTask).isNotNull();
            assertThat(downstreamTask.getStatus()).isEqualTo(TaskState.CANCELLED);
            assertThat(downstreamTask.getStartedAt()).isNull();
            assertThat(downstreamTask.getCompletedAt()).isNotNull();
        } finally {
            timeoutExecutionService.shutdown();
        }
    }

    @Test
    @DisplayName("10. Terminal state persistence failure triggers bounded recovery and does not claim durable success")
    void executeVersion_terminalPersistenceFailureThrows() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "t1");
        payload.putArray("edges");
        WorkflowVersion version = createTestVersion(true, payload);

        AtomicInteger saveCount = new AtomicInteger(0);
        doAnswer(inv -> {
            WorkflowRun r = inv.getArgument(0);
            int count = saveCount.incrementAndGet();
            if (count == 1) {
                // Initial creation save
                r.setId(UUID.randomUUID());
                runStore.put(r.getId(), r);
                return r;
            } else if (count == 2) {
                // Terminal reconciliation save fails
                throw new DataIntegrityViolationException("Connection lost during terminal save");
            } else {
                // Bounded recovery save succeeds
                runStore.put(r.getId(), r);
                return r;
            }
        }).when(workflowRunRepository).save(any(WorkflowRun.class));

        assertThatThrownBy(() -> runService.executeVersion(version.getId(), "test"))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasMessageContaining("Connection lost during terminal save");

        // Verify recovery marked the run terminal
        WorkflowRun run = runStore.values().iterator().next();
        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(run.getCompletedAt()).isNotNull();
    }

    @Test
    @DisplayName("11. Query helper methods operate cleanly on repositories")
    void queryMethods() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);
        runStore.put(runId, run);

        assertThat(runService.getRun(runId)).isPresent();
        assertThat(runService.getRun(UUID.randomUUID())).isEmpty();

        UUID versionId = UUID.randomUUID();
        when(workflowRunRepository.findByWorkflowVersionIdOrderByCreatedAtDesc(eq(versionId), any()))
            .thenReturn(new PageImpl<>(List.of(run)));

        var paged = runService.listRunsForVersion(versionId, PageRequest.of(0, 10));
        assertThat(paged.getContent()).hasSize(1);
    }

    @Test
    @DisplayName("12. Late task completion callback cannot overwrite CANCELLED task after timeout")
    void lateTaskCompletionCallbackCannotOverwriteTerminalCancelledState() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);
        run.setStatus(WorkflowRunState.CANCELLED);
        runStore.put(runId, run);

        TaskRun taskRun = new TaskRun(run, "task-late");
        taskRun.setStatus(TaskState.CANCELLED);
        taskRun.setCompletedAt(Instant.now());
        taskRunStore.put(runId + ":task-late", taskRun);

        // Attempt late callback to mark the task COMPLETED
        boolean updated = runService.updateTaskRunSafely(runId, "task-late", tr -> {
            tr.setStatus(TaskState.COMPLETED);
            tr.setCompletedAt(Instant.now());
            tr.setDurationMs(150L);
        });

        assertThat(updated).as("Late update on terminal run/task must be rejected").isFalse();

        // Verify task remained CANCELLED and duration was not mutated to 150L
        TaskRun reloaded = taskRunStore.get(runId + ":task-late");
        assertThat(reloaded.getStatus()).isEqualTo(TaskState.CANCELLED);
        assertThat(reloaded.getDurationMs()).isNull();
    }

    @Test
    @DisplayName("13. Interrupt-insensitive action completing after timeout cannot corrupt terminal state")
    void interruptInsensitiveTaskCannotCorruptTerminalState() throws Exception {
        SchedulerProperties timeoutProps = new SchedulerProperties();
        timeoutProps.setMaxConcurrentWorkflows(1);
        timeoutProps.setExecutionTimeoutSeconds(1); // 1s timeout

        TaskActionResolver customResolver = new TaskActionResolver() {
            @Override
            public TaskRegistry resolveRegistry(List<TaskDefinitionDto> tasks) {
                TaskRegistry registry = new TaskRegistry();
                for (TaskDefinitionDto task : tasks) {
                    if ("stubborn-task".equals(task.id())) {
                        registry.register(task.id(), id -> {
                            long deadline = System.currentTimeMillis() + 1500;
                            while (System.currentTimeMillis() < deadline) {
                                try {
                                    Thread.sleep(100);
                                } catch (InterruptedException ignored) {
                                    // Interrupt-insensitive: ignores interrupt signal
                                }
                            }
                        }, RetryPolicy.none());
                    } else {
                        registry.register(task.id(), id -> {}, RetryPolicy.none());
                    }
                }
                return registry;
            }
        };

        WorkflowExecutionService timeoutExecutionService = new WorkflowExecutionService(timeoutProps, customResolver);
        WorkflowRunService timeoutRunService = new WorkflowRunService(
            workflowRepository,
            workflowVersionRepository,
            workflowRunRepository,
            taskRunRepository,
            timeoutExecutionService,
            customResolver,
            timeoutProps,
            transactionManager
        );

        try {
            ObjectNode payload = objectMapper.createObjectNode();
            ArrayNode nodes = payload.putArray("nodes");
            nodes.addObject().put("id", "stubborn-task");
            nodes.addObject().put("id", "downstream-task");
            ArrayNode edges = payload.putArray("edges");
            edges.addObject().put("source", "stubborn-task").put("target", "downstream-task");

            WorkflowVersion version = createTestVersion(true, payload);

            assertThatThrownBy(() -> timeoutRunService.executeVersion(version.getId(), "stubborn-test"))
                .isInstanceOf(WorkflowExecutionTimeoutException.class);

            WorkflowRun run = runStore.values().iterator().next();
            assertThat(run.getStatus()).isEqualTo(WorkflowRunState.CANCELLED);

            TaskRun stubbornTask = taskRunStore.get(run.getId() + ":stubborn-task");
            assertThat(stubbornTask.getStatus()).isEqualTo(TaskState.CANCELLED);

            TaskRun downstreamTask = taskRunStore.get(run.getId() + ":downstream-task");
            assertThat(downstreamTask.getStatus()).isEqualTo(TaskState.CANCELLED);

            // Wait for the stubborn task background thread to finish its extra 500ms
            Thread.sleep(800);

            // Verify late finish DID NOT overwrite stubborn-task to COMPLETED
            TaskRun refreshedStubborn = taskRunStore.get(run.getId() + ":stubborn-task");
            assertThat(refreshedStubborn.getStatus()).isEqualTo(TaskState.CANCELLED);
        } finally {
            timeoutExecutionService.shutdown();
        }
    }

    @Test
    @DisplayName("14. When bounded recovery also fails, persistence error is propagated without claiming success")
    void executeVersion_recoveryFailurePropagatesOriginalError() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "t1");
        payload.putArray("edges");
        WorkflowVersion version = createTestVersion(true, payload);

        AtomicInteger saveCount = new AtomicInteger(0);
        doAnswer(inv -> {
            WorkflowRun r = inv.getArgument(0);
            int count = saveCount.incrementAndGet();
            if (count == 1) {
                r.setId(UUID.randomUUID());
                runStore.put(r.getId(), r);
                return r;
            }
            // Both reconciliation save and recovery save fail
            throw new DataIntegrityViolationException("Database totally down");
        }).when(workflowRunRepository).save(any(WorkflowRun.class));

        assertThatThrownBy(() -> runService.executeVersion(version.getId(), "test"))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasMessageContaining("Database totally down");
    }

    @Test
    @DisplayName("15. Timeout reconciliation primary failure triggers bounded recovery and successfully marks run terminal")
    void reconcileTerminalRunAndTasks_primaryFailureFollowedByRecoverySuccess() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);
        run.setStatus(WorkflowRunState.RUNNING);
        runStore.put(runId, run);

        AtomicInteger saveCalls = new AtomicInteger(0);
        doAnswer(inv -> {
            int call = saveCalls.incrementAndGet();
            if (call == 1) {
                // Primary save fails
                throw new DataIntegrityViolationException("Primary reconciliation connection timeout");
            }
            // Recovery save succeeds
            WorkflowRun r = inv.getArgument(0);
            runStore.put(r.getId(), r);
            return r;
        }).when(workflowRunRepository).save(any(WorkflowRun.class));

        // Reconcile terminal state
        runService.reconcileTerminalRunAndTasks(runId, WorkflowRunState.CANCELLED, Instant.now(), "Timeout test");

        // Verify recovery succeeded in marking the run CANCELLED
        assertThat(runStore.get(runId).getStatus()).isEqualTo(WorkflowRunState.CANCELLED);
    }

    @Test
    @DisplayName("16. Timeout reconciliation primary failure AND recovery failure propagates exception")
    void reconcileTerminalRunAndTasks_primaryAndRecoveryBothFail_propagatesException() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);
        run.setStatus(WorkflowRunState.RUNNING);
        runStore.put(runId, run);

        // Both primary save and recovery save fail
        doThrow(new DataIntegrityViolationException("Fatal PostgreSQL failure"))
            .when(workflowRunRepository).save(any(WorkflowRun.class));

        assertThatThrownBy(() ->
            runService.reconcileTerminalRunAndTasks(runId, WorkflowRunState.CANCELLED, Instant.now(), "Timeout test")
        )
            .isInstanceOf(RuntimeException.class)
            .hasMessageContaining("both failed for run " + runId);
    }

    @Test
    @DisplayName("17. listRunsForWorkflow throws ResourceNotFoundException when workflow does not exist")
    void listRunsForWorkflow_nonexistentWorkflow_throwsNotFound() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(false);

        assertThatThrownBy(() -> runService.listRunsForWorkflow(workflowId, PageRequest.of(0, 10)))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow not found: " + workflowId);
    }

    @Test
    @DisplayName("18. listRunsForWorkflow returns paged runs from repository when workflow exists")
    void listRunsForWorkflow_existingWorkflow_returnsPage() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);

        WorkflowRun run = new WorkflowRun();
        run.setId(UUID.randomUUID());
        PageRequest pageRequest = PageRequest.of(0, 10);
        when(workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflowId, pageRequest))
            .thenReturn(new PageImpl<>(List.of(run), pageRequest, 1));

        var result = runService.listRunsForWorkflow(workflowId, pageRequest);

        assertThat(result).isNotNull();
        assertThat(result.getTotalElements()).isEqualTo(1);
        assertThat(result.getContent()).containsExactly(run);
        verify(workflowRunRepository).findByWorkflowIdOrderByCreatedAtDesc(workflowId, pageRequest);
    }

    @Test
    @DisplayName("19. listRunsForWorkflow throws NullPointerException on null workflowId or pageable")
    void listRunsForWorkflow_nullArguments_throwNPE() {
        assertThatThrownBy(() -> runService.listRunsForWorkflow(null, PageRequest.of(0, 10)))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("Workflow ID must not be null");

        assertThatThrownBy(() -> runService.listRunsForWorkflow(UUID.randomUUID(), null))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("Pageable must not be null");
    }

    @Test
    @DisplayName("20. getRunById returns run when it exists")
    void getRunById_existingRun_returnsRun() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);
        runStore.put(runId, run);

        WorkflowRun result = runService.getRunById(runId);

        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo(runId);
    }

    @Test
    @DisplayName("21. getRunById throws ResourceNotFoundException when run does not exist")
    void getRunById_unknownRun_throwsNotFound() {
        UUID runId = UUID.randomUUID();

        assertThatThrownBy(() -> runService.getRunById(runId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow run not found: " + runId);
    }

    @Test
    @DisplayName("22. getRunById throws NullPointerException when runId is null")
    void getRunById_nullId_throwsNPE() {
        assertThatThrownBy(() -> runService.getRunById(null))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("Run ID must not be null");
    }

    @Test
    @DisplayName("23. listTaskRunsForRun returns deterministic task runs when parent run exists")
    void listTaskRunsForRun_existingRun_returnsTasks() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);
        runStore.put(runId, run);

        TaskRun tr1 = new TaskRun(UUID.randomUUID(), run, "task-1", TaskState.COMPLETED, 1, Instant.now(), Instant.now(), 10L, null);
        tr1.setCreatedAt(Instant.now().minusSeconds(1));
        TaskRun tr2 = new TaskRun(UUID.randomUUID(), run, "task-2", TaskState.PENDING, 1, null, null, null, null);
        tr2.setCreatedAt(Instant.now());
        taskRunStore.put(runId + ":task-1", tr1);
        taskRunStore.put(runId + ":task-2", tr2);

        List<TaskRun> tasks = runService.listTaskRunsForRun(runId);

        assertThat(tasks).hasSize(2);
        assertThat(tasks.get(0).getTaskId()).isEqualTo("task-1");
        assertThat(tasks.get(1).getTaskId()).isEqualTo("task-2");
    }

    @Test
    @DisplayName("24. listTaskRunsForRun throws ResourceNotFoundException when parent run does not exist")
    void listTaskRunsForRun_unknownRun_throwsNotFound() {
        UUID runId = UUID.randomUUID();

        assertThatThrownBy(() -> runService.listTaskRunsForRun(runId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow run not found: " + runId);
    }

    @Test
    @DisplayName("25. listRunsForWorkflow clamps page size to maximum 100")
    void listRunsForWorkflow_clampsPageSizeTo100() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);
        when(workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(eq(workflowId), any(Pageable.class)))
            .thenAnswer(inv -> {
                Pageable p = inv.getArgument(1);
                assertThat(p.getPageSize()).isEqualTo(100);
                return new PageImpl<>(List.of(), p, 0);
            });

        runService.listRunsForWorkflow(workflowId, PageRequest.of(0, 500));
        verify(workflowRunRepository).findByWorkflowIdOrderByCreatedAtDesc(eq(workflowId), any(Pageable.class));
    }

    @Test
    @DisplayName("26. executeWorkflow with explicit versionNumber resolves and executes that version")
    void executeWorkflow_explicitVersion_executesTargetVersion() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "t1");
        payload.putArray("edges");

        WorkflowVersion version = createTestVersion(true, payload);
        UUID workflowId = version.getWorkflow().getId();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);

        ExecuteRunRequest request = new ExecuteRunRequest(version.getVersionNumber(), "test-runner", 2);
        WorkflowRun run = runService.executeWorkflow(workflowId, request);

        assertThat(run).isNotNull();
        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(run.getWorkflowVersion().getId()).isEqualTo(version.getId());
        assertThat(run.getTriggeredBy()).isEqualTo("test-runner");
    }

    @Test
    @DisplayName("27. executeWorkflow with null versionNumber resolves and executes latest version")
    void executeWorkflow_nullVersion_executesLatest() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "t-latest");
        payload.putArray("edges");

        WorkflowVersion version = createTestVersion(true, payload);
        UUID workflowId = version.getWorkflow().getId();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);

        ExecuteRunRequest request = new ExecuteRunRequest(null, null, null);
        WorkflowRun run = runService.executeWorkflow(workflowId, request);

        assertThat(run).isNotNull();
        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(run.getWorkflowVersion().getId()).isEqualTo(version.getId());
        assertThat(run.getTriggeredBy()).isEqualTo("manual"); // default fallback
    }

    @Test
    @DisplayName("28. executeWorkflow throws ResourceNotFoundException when workflow does not exist")
    void executeWorkflow_unknownWorkflow_throwsNotFound() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(false);

        assertThatThrownBy(() -> runService.executeWorkflow(workflowId, new ExecuteRunRequest()))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow not found: " + workflowId);
    }

    @Test
    @DisplayName("29. executeWorkflow throws ResourceNotFoundException when specific version does not exist")
    void executeWorkflow_unknownVersion_throwsNotFound() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);

        assertThatThrownBy(() -> runService.executeWorkflow(workflowId, new ExecuteRunRequest(99, "api", 1)))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow version 99 not found for workflow " + workflowId);
    }

    @Test
    @DisplayName("30. executeWorkflow throws ResourceNotFoundException when workflow has no saved versions")
    void executeWorkflow_noSavedVersions_throwsNotFound() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);

        assertThatThrownBy(() -> runService.executeWorkflow(workflowId, new ExecuteRunRequest()))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Workflow has no saved versions");
    }

    @Test
    @DisplayName("31. executeWorkflow throws NullPointerException on null workflowId")
    void executeWorkflow_nullWorkflowId_throwsNPE() {
        assertThatThrownBy(() -> runService.executeWorkflow(null, new ExecuteRunRequest()))
            .isInstanceOf(NullPointerException.class)
            .hasMessageContaining("Workflow ID must not be null");
    }
}
