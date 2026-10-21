package com.flowforge.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flowforge.domain.*;
import com.flowforge.persistence.repository.*;
import com.flowforge.scheduler.TaskState;
import com.flowforge.scheduler.WorkflowRunState;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Authoritative PostgreSQL integration test verifying Substep 1.3.1 schema migrations,
 * WorkflowRun and TaskRun entities, repositories, foreign key RESTRICT rules,
 * status check constraints, and immutability preservation.
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class WorkflowRunPersistencePostgresTest {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("flowforge_runs_test")
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
    }

    @BeforeAll
    static void applyMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load();
        int applied = flyway.migrate().migrationsExecuted;
        assertThat(applied).isGreaterThanOrEqualTo(3);
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("4");
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
    private JdbcTemplate jdbcTemplate;

    private WorkflowVersion createTestWorkflowVersion(String slugPrefix) {
        Project project = projectRepository.save(new Project(
                "Run Test Project " + slugPrefix,
                slugPrefix + "-slug-" + UUID.randomUUID(),
                "Integration test project for run persistence"
        ));

        Workflow workflow = workflowRepository.save(new Workflow(
                project,
                "Run Test Workflow " + slugPrefix,
                "wf-" + slugPrefix + "-" + UUID.randomUUID(),
                "Integration test workflow"
        ));

        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        ObjectNode n1 = nodes.addObject();
        n1.put("id", "task-1");
        n1.put("type", "customTask");
        ObjectNode n1Data = n1.putObject("data");
        n1Data.put("label", "Task 1");

        ObjectNode n2 = nodes.addObject();
        n2.put("id", "task-2");
        n2.put("type", "customTask");
        ObjectNode n2Data = n2.putObject("data");
        n2Data.put("label", "Task 2");

        ArrayNode edges = payload.putArray("edges");
        ObjectNode edge = edges.addObject();
        edge.put("id", "e1-2");
        edge.put("source", "task-1");
        edge.put("target", "task-2");

        return workflowVersionRepository.save(new WorkflowVersion(
                workflow,
                1,
                "v1.0",
                "Initial snapshot",
                payload,
                2,
                1,
                true
        ));
    }

    @Test
    @DisplayName("1. Flyway V1, V2, and V3 apply cleanly and create workflow_runs and task_runs tables")
    void flywayMigrationsApplyCleanly() {
        Integer runsTableCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'workflow_runs'",
                Integer.class
        );
        assertThat(runsTableCount).isEqualTo(1);

        Integer taskRunsTableCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'task_runs'",
                Integer.class
        );
        assertThat(taskRunsTableCount).isEqualTo(1);
    }

    @Test
    @DisplayName("2. WorkflowRun persists and correctly references a persisted WorkflowVersion")
    void workflowRunPersistsAndReferencesVersion() {
        WorkflowVersion version = createTestWorkflowVersion("run-ref");

        Instant startedAt = Instant.now().minusSeconds(10);
        Instant completedAt = Instant.now();
        long durationMs = 10000L;

        WorkflowRun run = new WorkflowRun(
                null,
                version,
                WorkflowRunState.COMPLETED,
                startedAt,
                completedAt,
                durationMs,
                "manual-trigger"
        );
        WorkflowRun saved = workflowRunRepository.save(run);

        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(saved.getTriggeredBy()).isEqualTo("manual-trigger");
        assertThat(saved.getDurationMs()).isEqualTo(10000L);
        assertThat(saved.getWorkflowVersion().getId()).isEqualTo(version.getId());

        Optional<WorkflowRun> reloaded = workflowRunRepository.findById(saved.getId());
        assertThat(reloaded).isPresent();
        assertThat(reloaded.get().getWorkflowVersion().getId()).isEqualTo(version.getId());
        assertThat(reloaded.get().getStatus()).isEqualTo(WorkflowRunState.COMPLETED);
    }

    @Test
    @DisplayName("3. TaskRuns persist against a WorkflowRun with status, attempt count, and error message")
    void taskRunsPersistAgainstWorkflowRun() {
        WorkflowVersion version = createTestWorkflowVersion("task-run-ref");
        WorkflowRun run = workflowRunRepository.save(new WorkflowRun(version, "auto-trigger"));

        Instant t1Start = Instant.now().minusSeconds(5);
        Instant t1End = Instant.now().minusSeconds(2);

        TaskRun taskRun1 = new TaskRun(
                null,
                run,
                "task-1",
                TaskState.COMPLETED,
                1,
                t1Start,
                t1End,
                3000L,
                null
        );

        TaskRun taskRun2 = new TaskRun(
                null,
                run,
                "task-2",
                TaskState.FAILED,
                3,
                t1End,
                Instant.now(),
                2000L,
                "HTTP 500 Connection timed out"
        );

        TaskRun savedT1 = taskRunRepository.save(taskRun1);
        TaskRun savedT2 = taskRunRepository.save(taskRun2);

        assertThat(savedT1.getId()).isNotNull();
        assertThat(savedT1.getStatus()).isEqualTo(TaskState.COMPLETED);
        assertThat(savedT1.getAttemptCount()).isEqualTo(1);
        assertThat(savedT1.getErrorMessage()).isNull();

        assertThat(savedT2.getId()).isNotNull();
        assertThat(savedT2.getStatus()).isEqualTo(TaskState.FAILED);
        assertThat(savedT2.getAttemptCount()).isEqualTo(3);
        assertThat(savedT2.getErrorMessage()).isEqualTo("HTTP 500 Connection timed out");

        List<TaskRun> runTasks = taskRunRepository.findByWorkflowRunId(run.getId());
        assertThat(runTasks).hasSize(2);
        assertThat(runTasks).extracting(TaskRun::getTaskId).containsExactlyInAnyOrder("task-1", "task-2");

        Optional<TaskRun> foundT2 = taskRunRepository.findByWorkflowRunIdAndTaskId(run.getId(), "task-2");
        assertThat(foundT2).isPresent();
        assertThat(foundT2.get().getAttemptCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("4. Invalid foreign-key references are rejected for workflow_runs")
    void invalidForeignKeyVersionRejected() {
        UUID nonExistentVersionId = UUID.randomUUID();

        assertThatThrownBy(() -> {
            jdbcTemplate.update(
                    "INSERT INTO workflow_runs (id, workflow_version_id, status) VALUES (?, ?, ?)",
                    UUID.randomUUID(), nonExistentVersionId, "PENDING"
            );
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("fk_workflow_runs_version");
    }

    @Test
    @DisplayName("5. Invalid foreign-key references are rejected for task_runs")
    void invalidForeignKeyRunRejected() {
        UUID nonExistentRunId = UUID.randomUUID();

        assertThatThrownBy(() -> {
            jdbcTemplate.update(
                    "INSERT INTO task_runs (id, workflow_run_id, task_id, status, attempt_count) VALUES (?, ?, ?, ?, ?)",
                    UUID.randomUUID(), nonExistentRunId, "task-1", "PENDING", 1
            );
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("fk_task_runs_workflow_run");
    }

    @Test
    @DisplayName("6. Duplicate taskId within the same workflow_run is rejected by unique constraint")
    void duplicateTaskIdInSameRunRejected() {
        WorkflowVersion version = createTestWorkflowVersion("dup-task");
        WorkflowRun run = workflowRunRepository.save(new WorkflowRun(version, "dup-test"));

        taskRunRepository.save(new TaskRun(run, "task-unique-1"));

        assertThatThrownBy(() -> {
            taskRunRepository.save(new TaskRun(run, "task-unique-1"));
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("uq_task_runs_workflow_task");
    }

    @Test
    @DisplayName("7. Immutable WorkflowVersion deletion protection works when referenced by a WorkflowRun")
    void immutableVersionDeletionProtectionStillWorksWithRun() {
        WorkflowVersion version = createTestWorkflowVersion("immutable-del");
        workflowRunRepository.save(new WorkflowRun(version, "immutability-check"));

        // Trigger trg_workflow_version_no_delete prevents deletion at trigger level
        assertThatThrownBy(() -> {
            jdbcTemplate.update("DELETE FROM workflow_versions WHERE id = ?", version.getId());
        }).hasCauseInstanceOf(SQLException.class)
          .hasMessageContaining("Workflow versions are immutable and permanent");

        // Repository delete method also throws UnsupportedOperationException
        assertThatThrownBy(() -> {
            workflowVersionRepository.deleteById(version.getId());
        }).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    @DisplayName("8. WorkflowRun status check constraint rejects unsupported states")
    void workflowRunStatusConstraintRejectsInvalidState() {
        WorkflowVersion version = createTestWorkflowVersion("chk-run-status");

        assertThatThrownBy(() -> {
            jdbcTemplate.update(
                    "INSERT INTO workflow_runs (id, workflow_version_id, status) VALUES (?, ?, ?)",
                    UUID.randomUUID(), version.getId(), "UNKNOWN_STATE"
            );
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("chk_workflow_runs_status");
    }

    @Test
    @DisplayName("9. TaskRun status check constraint rejects unsupported states")
    void taskRunStatusConstraintRejectsInvalidState() {
        WorkflowVersion version = createTestWorkflowVersion("chk-task-status");
        WorkflowRun run = workflowRunRepository.save(new WorkflowRun(version, "chk-task-status"));

        assertThatThrownBy(() -> {
            jdbcTemplate.update(
                    "INSERT INTO task_runs (id, workflow_run_id, task_id, status, attempt_count) VALUES (?, ?, ?, ?, ?)",
                    UUID.randomUUID(), run.getId(), "task-bad", "INVALID_STATUS", 1
            );
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("chk_task_runs_status");
    }

    @Test
    @DisplayName("10. TaskRun negative attempt count is rejected by check constraint")
    void negativeAttemptCountRejected() {
        WorkflowVersion version = createTestWorkflowVersion("chk-attempts");
        WorkflowRun run = workflowRunRepository.save(new WorkflowRun(version, "attempts-test"));

        assertThatThrownBy(() -> {
            jdbcTemplate.update(
                    "INSERT INTO task_runs (id, workflow_run_id, task_id, status, attempt_count) VALUES (?, ?, ?, ?, ?)",
                    UUID.randomUUID(), run.getId(), "task-attempts", "PENDING", 0
            );
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("chk_task_runs_attempt_count");
    }

    @Test
    @DisplayName("11. Negative duration is rejected by check constraint")
    void negativeDurationRejected() {
        WorkflowVersion version = createTestWorkflowVersion("chk-duration");

        assertThatThrownBy(() -> {
            jdbcTemplate.update(
                    "INSERT INTO workflow_runs (id, workflow_version_id, status, duration_ms) VALUES (?, ?, ?, ?)",
                    UUID.randomUUID(), version.getId(), "COMPLETED", -500L
            );
        }).isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("chk_workflow_runs_duration");
    }

    @Test
    @DisplayName("12. Repository pagination and queries operate cleanly without breaking existing entities")
    void repositoryQueriesAndPagination() {
        WorkflowVersion version = createTestWorkflowVersion("repo-queries");

        WorkflowRun run1 = workflowRunRepository.save(new WorkflowRun(version, "batch-1"));
        WorkflowRun run2 = workflowRunRepository.save(new WorkflowRun(version, "batch-2"));

        assertThat(workflowRunRepository.countByWorkflowVersionId(version.getId())).isEqualTo(2);

        var paged = workflowRunRepository.findByWorkflowVersionIdOrderByCreatedAtDesc(
                version.getId(), PageRequest.of(0, 10)
        );
        assertThat(paged.getTotalElements()).isEqualTo(2);
        assertThat(paged.getContent()).extracting(WorkflowRun::getId).contains(run1.getId(), run2.getId());

        List<WorkflowRun> pendingRuns = workflowRunRepository.findByStatus(WorkflowRunState.PENDING);
        assertThat(pendingRuns).isNotEmpty();
    }

    @Test
    @DisplayName("13. findByWorkflowIdOrderByCreatedAtDesc includes runs across all versions of the workflow and excludes other workflows")
    void findByWorkflowId_includesAllVersionsAndExcludesOthers() {
        // Setup Workflow A with version 1 and version 2
        Project project = projectRepository.save(new Project("WF Cross Version Project", "cross-wf-" + UUID.randomUUID(), "desc"));
        Workflow workflowA = workflowRepository.save(new Workflow(project, "Workflow A", "wf-a-" + UUID.randomUUID(), "desc"));
        Workflow workflowB = workflowRepository.save(new Workflow(project, "Workflow B", "wf-b-" + UUID.randomUUID(), "desc"));

        WorkflowVersion versionA1 = workflowVersionRepository.save(new WorkflowVersion(workflowA, 1, "v1.0", "v1", objectMapper.createObjectNode(), 1, 0, true));
        WorkflowVersion versionA2 = workflowVersionRepository.save(new WorkflowVersion(workflowA, 2, "v2.0", "v2", objectMapper.createObjectNode(), 2, 1, true));
        WorkflowVersion versionB1 = workflowVersionRepository.save(new WorkflowVersion(workflowB, 1, "v1.0", "v1", objectMapper.createObjectNode(), 1, 0, true));

        // Create runs for Workflow A
        WorkflowRun runA1 = workflowRunRepository.save(new WorkflowRun(versionA1, "trigger-v1"));
        WorkflowRun runA2 = workflowRunRepository.save(new WorkflowRun(versionA2, "trigger-v2"));
        WorkflowRun runA3 = workflowRunRepository.save(new WorkflowRun(versionA2, "trigger-v2-second"));

        // Create run for Workflow B
        WorkflowRun runB1 = workflowRunRepository.save(new WorkflowRun(versionB1, "trigger-b"));

        // Query Workflow A
        var pageA = workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflowA.getId(), PageRequest.of(0, 10));
        assertThat(pageA.getTotalElements()).isEqualTo(3);
        assertThat(pageA.getContent()).extracting(WorkflowRun::getId)
                .containsExactly(runA3.getId(), runA2.getId(), runA1.getId())
                .doesNotContain(runB1.getId());
        assertThat(workflowRunRepository.countByWorkflowId(workflowA.getId())).isEqualTo(3);

        // Query Workflow B
        var pageB = workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflowB.getId(), PageRequest.of(0, 10));
        assertThat(pageB.getTotalElements()).isEqualTo(1);
        assertThat(pageB.getContent()).extracting(WorkflowRun::getId).containsExactly(runB1.getId());
        assertThat(workflowRunRepository.countByWorkflowId(workflowB.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("14. findByWorkflowIdOrderByCreatedAtDesc respects pagination boundaries")
    void findByWorkflowId_paginationBoundaries() {
        Project project = projectRepository.save(new Project("Paging Test Project", "paging-" + UUID.randomUUID(), "desc"));
        Workflow workflow = workflowRepository.save(new Workflow(project, "Paging WF", "wf-paging-" + UUID.randomUUID(), "desc"));
        WorkflowVersion version = workflowVersionRepository.save(new WorkflowVersion(workflow, 1, "v1", "v1", objectMapper.createObjectNode(), 1, 0, true));

        WorkflowRun run1 = workflowRunRepository.save(new WorkflowRun(version, "t1"));
        WorkflowRun run2 = workflowRunRepository.save(new WorkflowRun(version, "t2"));
        WorkflowRun run3 = workflowRunRepository.save(new WorkflowRun(version, "t3"));

        // Page 0 with size 2
        var page0 = workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflow.getId(), PageRequest.of(0, 2));
        assertThat(page0.getTotalElements()).isEqualTo(3);
        assertThat(page0.getTotalPages()).isEqualTo(2);
        assertThat(page0.getNumberOfElements()).isEqualTo(2);
        assertThat(page0.getContent()).extracting(WorkflowRun::getId).containsExactly(run3.getId(), run2.getId());

        // Page 1 with size 2
        var page1 = workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflow.getId(), PageRequest.of(1, 2));
        assertThat(page1.getNumberOfElements()).isEqualTo(1);
        assertThat(page1.getContent()).extracting(WorkflowRun::getId).containsExactly(run1.getId());
    }

    @Test
    @DisplayName("15. findByWorkflowIdOrderByCreatedAtDesc returns empty page for workflow with no runs")
    void findByWorkflowId_emptyWhenNoRuns() {
        Project project = projectRepository.save(new Project("Empty Test Project", "empty-" + UUID.randomUUID(), "desc"));
        Workflow workflow = workflowRepository.save(new Workflow(project, "Empty WF", "wf-empty-" + UUID.randomUUID(), "desc"));

        var page = workflowRunRepository.findByWorkflowIdOrderByCreatedAtDesc(workflow.getId(), PageRequest.of(0, 10));
        assertThat(page.getTotalElements()).isEqualTo(0);
        assertThat(page.getContent()).isEmpty();
        assertThat(workflowRunRepository.countByWorkflowId(workflow.getId())).isEqualTo(0);
    }

    @Test
    @DisplayName("16. findByIdWithDetails eagerly fetches WorkflowVersion and Workflow in single query")
    void findByIdWithDetails_fetchesHierarchy() {
        WorkflowVersion version = createTestWorkflowVersion("eager-details");
        WorkflowRun run = workflowRunRepository.save(new WorkflowRun(version, "eager-test"));

        var foundOpt = workflowRunRepository.findByIdWithDetails(run.getId());
        assertThat(foundOpt).isPresent();
        WorkflowRun found = foundOpt.get();
        assertThat(found.getId()).isEqualTo(run.getId());
        assertThat(found.getWorkflowVersion()).isNotNull();
        assertThat(found.getWorkflowVersion().getId()).isEqualTo(version.getId());
        assertThat(found.getWorkflowVersion().getWorkflow()).isNotNull();
        assertThat(found.getWorkflowVersion().getWorkflow().getId()).isEqualTo(version.getWorkflow().getId());
    }

    @Test
    @DisplayName("17. findByWorkflowRunIdOrderByCreatedAtAscIdAsc returns tasks in deterministic order")
    void findByWorkflowRunIdOrderByCreatedAtAscIdAsc_deterministicOrder() {
        WorkflowVersion version = createTestWorkflowVersion("task-ordering");
        WorkflowRun run = workflowRunRepository.save(new WorkflowRun(version, "order-test"));

        TaskRun tr1 = taskRunRepository.save(new TaskRun(run, "task-alpha"));
        TaskRun tr2 = taskRunRepository.save(new TaskRun(run, "task-beta"));
        TaskRun tr3 = taskRunRepository.save(new TaskRun(run, "task-gamma"));

        List<TaskRun> tasks = taskRunRepository.findByWorkflowRunIdOrderByCreatedAtAscIdAsc(run.getId());
        assertThat(tasks).hasSize(3);
        assertThat(tasks).extracting(TaskRun::getId).containsExactly(tr1.getId(), tr2.getId(), tr3.getId());
    }
}
