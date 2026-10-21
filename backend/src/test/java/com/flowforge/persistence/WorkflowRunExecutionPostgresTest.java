package com.flowforge.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flowforge.api.TaskActionResolver;
import com.flowforge.api.WorkflowExecutionService;
import com.flowforge.api.dto.ExecuteRunRequest;
import com.flowforge.config.SchedulerProperties;
import com.flowforge.domain.*;
import com.flowforge.persistence.repository.*;
import com.flowforge.scheduler.TaskState;
import com.flowforge.scheduler.WorkflowRunState;
import com.flowforge.service.ProjectAuthorizationService;
import com.flowforge.service.WorkflowRunService;
import com.flowforge.service.exception.ResourceNotFoundException;
import com.flowforge.service.exception.WorkflowExecutionTimeoutException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Authoritative PostgreSQL integration test verifying Phase 1.3.2 durable execution run service
 * and scheduler integration against a real PostgreSQL 16 database.
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({WorkflowRunService.class, WorkflowExecutionService.class, TaskActionResolver.class, SchedulerProperties.class, ProjectAuthorizationService.class})
class WorkflowRunExecutionPostgresTest {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("flowforge_execution_runs_test")
            .withUsername("flowforge_user")
            .withPassword("flowforge_pass");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 20);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.jpa.properties.hibernate.dialect", () -> "org.hibernate.dialect.PostgreSQLDialect");
        registry.add("flowforge.scheduler.max-concurrent-workflows", () -> 4);
        registry.add("flowforge.scheduler.execution-timeout-seconds", () -> 15);
    }

    @BeforeAll
    static void applyMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load();
        int applied = flyway.migrate().migrationsExecuted;
        assertThat(applied).isGreaterThanOrEqualTo(3);
    }

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private WorkflowRepository workflowRepository;

    @Autowired
    private WorkflowVersionRepository workflowVersionRepository;

    @Autowired
    private WorkflowRunRepository workflowRunRepository;

    @Autowired
    private TaskRunRepository taskRunRepository;

    @Autowired
    private WorkflowRunService workflowRunService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private SchedulerProperties properties;

    private WorkflowVersion createTestVersion(String prefix, ObjectNode payload) {
        Project project = projectRepository.save(new Project(
                "Execution Project " + prefix,
                "proj-" + prefix + "-" + UUID.randomUUID(),
                "Integration test project"
        ));

        Workflow workflow = workflowRepository.save(new Workflow(
                project,
                "Execution Workflow " + prefix,
                "wf-" + prefix + "-" + UUID.randomUUID(),
                "Integration test workflow"
        ));

        int nodeCount = payload.has("nodes") ? payload.get("nodes").size() : 0;
        int edgeCount = payload.has("edges") ? payload.get("edges").size() : 0;

        return workflowVersionRepository.save(new WorkflowVersion(
                workflow,
                1,
                "v1.0",
                "Snapshot for execution test",
                payload,
                nodeCount,
                edgeCount,
                true
        ));
    }

    @Test
    @DisplayName("1. Successful execution: persists WorkflowRun and TaskRuns with terminal COMPLETED states, timestamps, and durations in PostgreSQL")
    void successfulExecutionPersistsDurableState() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n1 = nodes.addObject();
        n1.put("id", "task-alpha");
        n1.putObject("data").putObject("parameters").putObject("simulation").put("action", "DELAY").put("delayMs", 50);

        ObjectNode n2 = nodes.addObject();
        n2.put("id", "task-beta");
        n2.putObject("data").put("taskType", "NO_OP");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "task-alpha").put("target", "task-beta");

        WorkflowVersion version = createTestVersion("success", payload);

        WorkflowRun run = workflowRunService.executeVersion(version.getId(), "postgres-test-suite");

        assertThat(run).isNotNull();
        assertThat(run.getId()).isNotNull();
        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(run.getDurationMs()).isNotNull().isGreaterThanOrEqualTo(50L);

        // Verify directly via a fresh database query
        Optional<WorkflowRun> reloadedRun = workflowRunRepository.findById(run.getId());
        assertThat(reloadedRun).isPresent();
        assertThat(reloadedRun.get().getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(reloadedRun.get().getCompletedAt()).isNotNull();
        assertThat(reloadedRun.get().getWorkflowVersion().getId()).isEqualTo(version.getId());

        List<TaskRun> taskRuns = taskRunRepository.findByWorkflowRunId(run.getId());
        assertThat(taskRuns).hasSize(2);
        for (TaskRun tr : taskRuns) {
            assertThat(tr.getStatus()).isEqualTo(TaskState.COMPLETED);
            assertThat(tr.getAttemptCount()).isEqualTo(1);
            assertThat(tr.getStartedAt()).isNotNull();
            assertThat(tr.getCompletedAt()).isNotNull();
            assertThat(tr.getDurationMs()).isNotNull().isGreaterThanOrEqualTo(0L);
            assertThat(tr.getErrorMessage()).isNull();
        }
    }

    @Test
    @DisplayName("2. Task failure: persists FAILED status with sanitized error and CANCELLED downstream task in PostgreSQL")
    void taskFailurePersistsFailureAndCancellation() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n1 = nodes.addObject();
        n1.put("id", "failing-step");
        n1.putObject("data").putObject("parameters").putObject("simulation")
                .put("action", "FAIL")
                .put("errorMessage", "Simulated Postgres failure");

        ObjectNode n2 = nodes.addObject();
        n2.put("id", "dependent-step");
        n2.putObject("data").put("taskType", "NO_OP");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "failing-step").put("target", "dependent-step");

        WorkflowVersion version = createTestVersion("fail", payload);

        WorkflowRun run = workflowRunService.executeVersion(version.getId(), "fail-tester");

        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.FAILED);

        // Reload fresh from database
        Optional<TaskRun> failedTask = taskRunRepository.findByWorkflowRunIdAndTaskId(run.getId(), "failing-step");
        assertThat(failedTask).isPresent();
        assertThat(failedTask.get().getStatus()).isEqualTo(TaskState.FAILED);
        assertThat(failedTask.get().getAttemptCount()).isEqualTo(1);
        assertThat(failedTask.get().getErrorMessage()).isEqualTo("Simulated Postgres failure");

        Optional<TaskRun> cancelledTask = taskRunRepository.findByWorkflowRunIdAndTaskId(run.getId(), "dependent-step");
        assertThat(cancelledTask).isPresent();
        assertThat(cancelledTask.get().getStatus()).isEqualTo(TaskState.CANCELLED);
        assertThat(cancelledTask.get().getStartedAt()).isNull();
        assertThat(cancelledTask.get().getAttemptCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("3. Retry updates same TaskRun row in PostgreSQL without violating unique constraint uq_task_runs_workflow_task")
    void retryUpdatesSameRowWithoutUniqueConstraintViolation() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n = nodes.addObject();
        n.put("id", "flaky-task");
        ObjectNode data = n.putObject("data");
        data.put("maxRetries", 2);
        ObjectNode params = data.putObject("parameters");
        params.putObject("simulation").put("action", "FAIL_UNTIL_ATTEMPT").put("failUntilAttempt", 2);
        params.putObject("retry").put("initialDelayMs", 20);

        payload.putArray("edges");

        WorkflowVersion version = createTestVersion("retry", payload);

        WorkflowRun run = workflowRunService.executeVersion(version.getId(), "retry-runner");

        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);

        // Verify exactly 1 task run row in DB
        Integer taskCountInDb = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM task_runs WHERE workflow_run_id = ?",
                Integer.class,
                run.getId()
        );
        assertThat(taskCountInDb).isEqualTo(1);

        Optional<TaskRun> reloadedTask = taskRunRepository.findByWorkflowRunIdAndTaskId(run.getId(), "flaky-task");
        assertThat(reloadedTask).isPresent();
        assertThat(reloadedTask.get().getAttemptCount()).isEqualTo(2);
        assertThat(reloadedTask.get().getStatus()).isEqualTo(TaskState.COMPLETED);
    }

    @Test
    @DisplayName("4. Missing version throws ResourceNotFoundException and leaves no orphan run records in database")
    void missingVersionLeavesNoOrphanRecords() {
        UUID nonExistentVersionId = UUID.randomUUID();

        long runCountBefore = workflowRunRepository.count();

        assertThatThrownBy(() -> workflowRunService.executeVersion(nonExistentVersionId, "ghost"))
                .isInstanceOf(ResourceNotFoundException.class);

        long runCountAfter = workflowRunRepository.count();
        assertThat(runCountAfter).isEqualTo(runCountBefore);
    }

    @Test
    @DisplayName("5. Multiple independent executions on the same version persist distinct WorkflowRuns and TaskRuns cleanly")
    void multipleExecutionsOnSameVersionPersistCleanly() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "solo-task").putObject("data").put("taskType", "NO_OP");
        payload.putArray("edges");

        WorkflowVersion version = createTestVersion("multi-run", payload);

        WorkflowRun run1 = workflowRunService.executeVersion(version.getId(), "run-1");
        WorkflowRun run2 = workflowRunService.executeVersion(version.getId(), "run-2");

        assertThat(run1.getId()).isNotEqualTo(run2.getId());

        assertThat(workflowRunRepository.countByWorkflowVersionId(version.getId())).isEqualTo(2);

        List<TaskRun> tasks1 = taskRunRepository.findByWorkflowRunId(run1.getId());
        List<TaskRun> tasks2 = taskRunRepository.findByWorkflowRunId(run2.getId());

        assertThat(tasks1).hasSize(1);
        assertThat(tasks2).hasSize(1);
        assertThat(tasks1.get(0).getId()).isNotEqualTo(tasks2.get(0).getId());
    }

    @Test
    @DisplayName("6. Timeout reconciles WorkflowRun and all TaskRuns to CANCELLED in PostgreSQL")
    void timeoutReconcilesRunAndTasksToCancelledInPostgres() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");

        ObjectNode n1 = nodes.addObject();
        n1.put("id", "slow-step");
        n1.putObject("data").putObject("parameters").putObject("simulation")
                .put("action", "DELAY").put("delayMs", 4000);

        ObjectNode n2 = nodes.addObject();
        n2.put("id", "waiting-step");
        n2.putObject("data").put("taskType", "NO_OP");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "slow-step").put("target", "waiting-step");

        WorkflowVersion version = createTestVersion("timeout", payload);

        long oldTimeout = properties.getExecutionTimeoutSeconds();
        try {
            properties.setExecutionTimeoutSeconds(1);

            assertThatThrownBy(() -> workflowRunService.executeVersion(version.getId(), "timeout-tester"))
                    .isInstanceOf(WorkflowExecutionTimeoutException.class);

            // Verify directly in PostgreSQL database
            List<WorkflowRun> runs = workflowRunRepository.findByWorkflowVersionIdOrderByCreatedAtDesc(
                    version.getId(),
                    org.springframework.data.domain.PageRequest.of(0, 10)
            ).getContent();
            assertThat(runs).hasSize(1);
            WorkflowRun run = runs.get(0);

            assertThat(run.getStatus()).isEqualTo(WorkflowRunState.CANCELLED);
            assertThat(run.getCompletedAt()).isNotNull();
            assertThat(run.getDurationMs()).isNotNull().isGreaterThanOrEqualTo(1000L);

            Optional<TaskRun> slowTask = taskRunRepository.findByWorkflowRunIdAndTaskId(run.getId(), "slow-step");
            assertThat(slowTask).isPresent();
            assertThat(slowTask.get().getStatus()).isEqualTo(TaskState.CANCELLED);
            assertThat(slowTask.get().getCompletedAt()).isNotNull();

            Optional<TaskRun> waitingTask = taskRunRepository.findByWorkflowRunIdAndTaskId(run.getId(), "waiting-step");
            assertThat(waitingTask).isPresent();
            assertThat(waitingTask.get().getStatus()).isEqualTo(TaskState.CANCELLED);
            assertThat(waitingTask.get().getStartedAt()).isNull();
            assertThat(waitingTask.get().getCompletedAt()).isNotNull();
        } finally {
            properties.setExecutionTimeoutSeconds(oldTimeout);
        }
    }

    @Test
    @DisplayName("7. Stale task completion callback cannot overwrite terminal CANCELLED task in PostgreSQL")
    void staleTaskCallbackCannotOverwriteCancelledTaskInPostgres() throws Exception {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "late-step").putObject("data").put("taskType", "NO_OP");
        payload.putArray("edges");

        WorkflowVersion version = createTestVersion("late-guard", payload);

        // Pre-create run and task in RUNNING state in PostgreSQL
        WorkflowRun run = new WorkflowRun(version, "guard-tester");
        run.setStatus(WorkflowRunState.RUNNING);
        run.setStartedAt(Instant.now());
        WorkflowRun savedRun = workflowRunRepository.save(run);

        TaskRun taskRun = new TaskRun(savedRun, "late-step");
        taskRun.setStatus(TaskState.RUNNING);
        taskRun.setStartedAt(Instant.now());
        taskRunRepository.save(taskRun);

        java.util.concurrent.CountDownLatch listenerReadDone = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch reconciliationCommitted = new java.util.concurrent.CountDownLatch(1);

        java.util.concurrent.ExecutorService testExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            // Thread 1: In-flight listener callback runs and pauses after reading non-terminal entity
            java.util.concurrent.Future<Boolean> callbackFuture = testExecutor.submit(() ->
                workflowRunService.updateTaskRunSafely(savedRun.getId(), "late-step", tr -> {
                    listenerReadDone.countDown();
                    try {
                        if (!reconciliationCommitted.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
                            throw new RuntimeException("Timed out waiting for reconciliation latch");
                        }
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    tr.setStatus(TaskState.COMPLETED);
                    tr.setCompletedAt(Instant.now());
                    tr.setDurationMs(250L);
                })
            );

            // Wait until listener has loaded the entity and entered the update block
            assertThat(listenerReadDone.await(5, java.util.concurrent.TimeUnit.SECONDS))
                .as("Listener must have read non-terminal state")
                .isTrue();

            // Main Thread: Watchdog timeout reconciles workflow run and all tasks to CANCELLED in PostgreSQL
            workflowRunService.reconcileTerminalRunAndTasks(
                savedRun.getId(),
                WorkflowRunState.CANCELLED,
                Instant.now(),
                "Watchdog timeout triggered"
            );

            // Allow listener to resume and attempt its write
            reconciliationCommitted.countDown();

            Boolean updateResult = callbackFuture.get(5, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(updateResult).as("Late update on reconciled task must be rejected at database level").isFalse();

            // Verify in PostgreSQL: task remains CANCELLED and duration was not mutated to 250ms
            TaskRun reloadedTask = taskRunRepository.findByWorkflowRunIdAndTaskId(savedRun.getId(), "late-step").orElseThrow();
            assertThat(reloadedTask.getStatus()).isEqualTo(TaskState.CANCELLED);
            assertThat(reloadedTask.getDurationMs()).isNotEqualTo(250L);

            WorkflowRun reloadedRun = workflowRunRepository.findById(savedRun.getId()).orElseThrow();
            assertThat(reloadedRun.getStatus()).isEqualTo(WorkflowRunState.CANCELLED);
        } finally {
            testExecutor.shutdownNow();
        }
    }

    @Test
    @DisplayName("8. executeWorkflow resolves latest version, executes and persists run + tasks, and verifies accessibility through read services")
    void executeWorkflowLatestVersionAccessibleViaReadServices() {
        ObjectNode payload1 = objectMapper.createObjectNode();
        payload1.putArray("nodes").addObject().put("id", "step-v1").putObject("data").put("taskType", "NO_OP");
        payload1.putArray("edges");

        WorkflowVersion v1 = createTestVersion("latest-res", payload1);
        Workflow workflow = v1.getWorkflow();

        ObjectNode payload2 = objectMapper.createObjectNode();
        payload2.putArray("nodes").addObject().put("id", "step-v2").putObject("data").put("taskType", "NO_OP");
        payload2.putArray("edges");

        WorkflowVersion v2 = workflowVersionRepository.save(new WorkflowVersion(
                workflow,
                2,
                "v2.0",
                "Second version snapshot",
                payload2,
                1,
                0,
                true
        ));

        // Execute without specifying versionNumber -> must resolve v2 (latest)
        ExecuteRunRequest request = new ExecuteRunRequest(null, "scheduler-daemon", 2);
        WorkflowRun run = workflowRunService.executeWorkflow(workflow.getId(), request);

        assertThat(run).isNotNull();
        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(run.getWorkflowVersion().getId()).isEqualTo(v2.getId());
        assertThat(run.getWorkflowVersion().getVersionNumber()).isEqualTo(2);
        assertThat(run.getTriggeredBy()).isEqualTo("scheduler-daemon");

        // Verify accessible via getRunById
        WorkflowRun fetchedRun = workflowRunService.getRunById(run.getId());
        assertThat(fetchedRun.getId()).isEqualTo(run.getId());
        assertThat(fetchedRun.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);

        // Verify accessible via listTaskRunsForRun
        List<TaskRun> tasks = workflowRunService.listTaskRunsForRun(run.getId());
        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getTaskId()).isEqualTo("step-v2");
        assertThat(tasks.get(0).getStatus()).isEqualTo(TaskState.COMPLETED);

        // Verify accessible via listRunsForWorkflow
        Page<WorkflowRun> page = workflowRunService.listRunsForWorkflow(workflow.getId(), PageRequest.of(0, 20));
        assertThat(page.getTotalElements()).isGreaterThanOrEqualTo(1);
        assertThat(page.getContent()).extracting(WorkflowRun::getId).contains(run.getId());
    }

    @Test
    @DisplayName("9. executeWorkflow with explicit version executes target version even when newer version exists")
    void executeWorkflowExplicitVersionInPostgres() {
        ObjectNode payload1 = objectMapper.createObjectNode();
        payload1.putArray("nodes").addObject().put("id", "step-v1-explicit").putObject("data").put("taskType", "NO_OP");
        payload1.putArray("edges");

        WorkflowVersion v1 = createTestVersion("explicit-res", payload1);
        Workflow workflow = v1.getWorkflow();

        ObjectNode payload2 = objectMapper.createObjectNode();
        payload2.putArray("nodes").addObject().put("id", "step-v2-explicit").putObject("data").put("taskType", "NO_OP");
        payload2.putArray("edges");

        workflowVersionRepository.save(new WorkflowVersion(
                workflow,
                2,
                "v2.0",
                "Second version snapshot",
                payload2,
                1,
                0,
                true
        ));

        // Execute specifying versionNumber = 1 explicitly
        ExecuteRunRequest request = new ExecuteRunRequest(1, "qa-runner", null);
        WorkflowRun run = workflowRunService.executeWorkflow(workflow.getId(), request);

        assertThat(run).isNotNull();
        assertThat(run.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(run.getWorkflowVersion().getId()).isEqualTo(v1.getId());
        assertThat(run.getWorkflowVersion().getVersionNumber()).isEqualTo(1);
        assertThat(run.getTriggeredBy()).isEqualTo("qa-runner");

        List<TaskRun> tasks = workflowRunService.listTaskRunsForRun(run.getId());
        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getTaskId()).isEqualTo("step-v1-explicit");
    }

    @Test
    @DisplayName("10. executeWorkflow throws ResourceNotFoundException for missing workflow, missing version, or cross-workflow version")
    void executeWorkflowNotFoundSafeguards() {
        UUID unknownWorkflowId = UUID.randomUUID();
        assertThatThrownBy(() -> workflowRunService.executeWorkflow(unknownWorkflowId, new ExecuteRunRequest()))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow not found: " + unknownWorkflowId);

        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "step-wf1").putObject("data").put("taskType", "NO_OP");
        payload.putArray("edges");
        WorkflowVersion v1 = createTestVersion("wf1-guard", payload);
        Workflow wf1 = v1.getWorkflow();

        // Missing version number 99 on wf1
        assertThatThrownBy(() -> workflowRunService.executeWorkflow(wf1.getId(), new ExecuteRunRequest(99, null, null)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow version 99 not found for workflow " + wf1.getId());

        // Create second workflow wf2
        ObjectNode payload2 = objectMapper.createObjectNode();
        payload2.putArray("nodes").addObject().put("id", "step-wf2").putObject("data").put("taskType", "NO_OP");
        payload2.putArray("edges");
        WorkflowVersion wf2v1 = createTestVersion("wf2-guard", payload2);
        Workflow wf2 = wf2v1.getWorkflow();

        // wf2 has version 1, but wf1 only has version 1. If we create version 2 on wf2:
        workflowVersionRepository.save(new WorkflowVersion(
                wf2,
                2,
                "v2.0",
                "wf2 v2",
                payload2,
                1,
                0,
                true
        ));

        // Version 2 exists on wf2, but NOT on wf1. Calling wf1 with versionNumber=2 must fail with 404!
        assertThatThrownBy(() -> workflowRunService.executeWorkflow(wf1.getId(), new ExecuteRunRequest(2, null, null)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow version 2 not found for workflow " + wf1.getId());
    }
}

