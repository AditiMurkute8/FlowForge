package com.flowforge.api.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.domain.*;
import com.flowforge.scheduler.TaskState;
import com.flowforge.scheduler.WorkflowRunState;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WorkflowRunDtoTest {

    private static Validator validator;
    private static final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeAll
    static void setUp() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @Test
    @DisplayName("1. ExecuteRunRequest default constructor has null values and passes validation")
    void executeRunRequest_defaultConstructor() {
        ExecuteRunRequest req = new ExecuteRunRequest();
        assertThat(req.versionNumber()).isNull();
        assertThat(req.triggeredBy()).isNull();
        assertThat(req.concurrency()).isNull();

        var violations = validator.validate(req);
        assertThat(violations).isEmpty();
    }

    @Test
    @DisplayName("2. ExecuteRunRequest validates bounds: concurrency 1..4, versionNumber >= 1, triggeredBy <= 100")
    void executeRunRequest_validations() {
        // Valid custom request
        ExecuteRunRequest valid = new ExecuteRunRequest(2, "ci-runner", 3);
        assertThat(validator.validate(valid)).isEmpty();

        // Invalid concurrency: 0 and 5
        ExecuteRunRequest invalidConcurrencyLow = new ExecuteRunRequest(1, "api", 0);
        assertThat(validator.validate(invalidConcurrencyLow)).hasSize(1);

        ExecuteRunRequest invalidConcurrencyHigh = new ExecuteRunRequest(1, "api", 5);
        assertThat(validator.validate(invalidConcurrencyHigh)).hasSize(1);

        // Invalid versionNumber: 0
        ExecuteRunRequest invalidVersion = new ExecuteRunRequest(0, "api", 2);
        assertThat(validator.validate(invalidVersion)).hasSize(1);

        // Invalid triggeredBy: > 100 characters
        ExecuteRunRequest invalidTriggeredBy = new ExecuteRunRequest(1, "a".repeat(101), 2);
        assertThat(validator.validate(invalidTriggeredBy)).hasSize(1);
    }

    @Test
    @DisplayName("3. TaskRunResponse maps accurately from TaskRun entity preserving all fields")
    void taskRunResponse_fromEntity() {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun();
        run.setId(runId);

        UUID taskId = UUID.randomUUID();
        Instant now = Instant.now();
        Instant completed = now.plusMillis(150);

        TaskRun tr = new TaskRun(
            taskId,
            run,
            "task-download",
            TaskState.COMPLETED,
            2,
            now,
            completed,
            150L,
            null
        );
        tr.setCreatedAt(now.minusSeconds(1));

        TaskRunResponse response = TaskRunResponse.fromEntity(tr);

        assertThat(response).isNotNull();
        assertThat(response.id()).isEqualTo(taskId);
        assertThat(response.taskId()).isEqualTo("task-download");
        assertThat(response.status()).isEqualTo(TaskState.COMPLETED);
        assertThat(response.attemptCount()).isEqualTo(2);
        assertThat(response.startedAt()).isEqualTo(now);
        assertThat(response.completedAt()).isEqualTo(completed);
        assertThat(response.durationMs()).isEqualTo(150L);
        assertThat(response.errorMessage()).isNull();
        assertThat(response.createdAt()).isEqualTo(now.minusSeconds(1));
    }

    @Test
    @DisplayName("4. TaskRunResponse handles null TaskRun gracefully")
    void taskRunResponse_nullEntity() {
        assertThat(TaskRunResponse.fromEntity(null)).isNull();
    }

    @Test
    @DisplayName("5. WorkflowRunSummaryResponse maps accurately without lazy loading errors")
    void workflowRunSummaryResponse_fromEntity() {
        UUID projectId = UUID.randomUUID();
        Project project = new Project(projectId, "Test Project", "test-project", "desc");

        UUID workflowId = UUID.randomUUID();
        Workflow workflow = new Workflow(workflowId, project, "Test Workflow", "test-workflow", "desc");

        UUID versionId = UUID.randomUUID();
        WorkflowVersion version = new WorkflowVersion(
            versionId,
            workflow,
            3,
            "v3.0",
            "Third version",
            objectMapper.createObjectNode(),
            5,
            4,
            true
        );

        UUID runId = UUID.randomUUID();
        Instant started = Instant.now();
        Instant completed = started.plusMillis(450);

        WorkflowRun run = new WorkflowRun(
            runId,
            version,
            WorkflowRunState.COMPLETED,
            started,
            completed,
            450L,
            "manual"
        );
        run.setCreatedAt(started.minusSeconds(2));

        WorkflowRunSummaryResponse summary = WorkflowRunSummaryResponse.fromEntity(run);

        assertThat(summary).isNotNull();
        assertThat(summary.id()).isEqualTo(runId);
        assertThat(summary.workflowId()).isEqualTo(workflowId);
        assertThat(summary.workflowVersionId()).isEqualTo(versionId);
        assertThat(summary.versionNumber()).isEqualTo(3);
        assertThat(summary.status()).isEqualTo(WorkflowRunState.COMPLETED);
        assertThat(summary.startedAt()).isEqualTo(started);
        assertThat(summary.completedAt()).isEqualTo(completed);
        assertThat(summary.durationMs()).isEqualTo(450L);
        assertThat(summary.triggeredBy()).isEqualTo("manual");
        assertThat(summary.createdAt()).isEqualTo(started.minusSeconds(2));
        assertThat(summary.taskCount()).isEqualTo(5);
    }

    @Test
    @DisplayName("6. WorkflowRunSummaryResponse handles null version or workflow safely")
    void workflowRunSummaryResponse_nullVersion() {
        WorkflowRun run = new WorkflowRun();
        run.setId(UUID.randomUUID());
        run.setStatus(WorkflowRunState.RUNNING);

        WorkflowRunSummaryResponse summary = WorkflowRunSummaryResponse.fromEntity(run);
        assertThat(summary).isNotNull();
        assertThat(summary.id()).isEqualTo(run.getId());
        assertThat(summary.workflowId()).isNull();
        assertThat(summary.workflowVersionId()).isNull();
        assertThat(summary.versionNumber()).isNull();
        assertThat(summary.taskCount()).isNull();
        assertThat(summary.status()).isEqualTo(WorkflowRunState.RUNNING);
    }

    @Test
    @DisplayName("7. WorkflowRunResponse maps accurately with task responses and enforces immutability")
    void workflowRunResponse_fromEntity() {
        UUID projectId = UUID.randomUUID();
        Project project = new Project(projectId, "Test Project", "test-project", "desc");
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = new Workflow(workflowId, project, "Test Workflow", "test-workflow", "desc");
        UUID versionId = UUID.randomUUID();
        WorkflowVersion version = new WorkflowVersion(versionId, workflow, 1, "v1", null, null, 2, 1, true);

        UUID runId = UUID.randomUUID();
        WorkflowRun run = new WorkflowRun(version, "api");
        run.setId(runId);
        run.setStatus(WorkflowRunState.FAILED);

        TaskRun tr1 = new TaskRun(UUID.randomUUID(), run, "task-1", TaskState.COMPLETED, 1, Instant.now(), Instant.now(), 50L, null);
        TaskRun tr2 = new TaskRun(UUID.randomUUID(), run, "task-2", TaskState.FAILED, 2, Instant.now(), Instant.now(), 80L, "Simulated network timeout");
        run.setTaskRuns(List.of(tr1, tr2));

        WorkflowRunResponse detailed = WorkflowRunResponse.fromEntity(run);

        assertThat(detailed).isNotNull();
        assertThat(detailed.id()).isEqualTo(runId);
        assertThat(detailed.workflowId()).isEqualTo(workflowId);
        assertThat(detailed.workflowVersionId()).isEqualTo(versionId);
        assertThat(detailed.versionNumber()).isEqualTo(1);
        assertThat(detailed.status()).isEqualTo(WorkflowRunState.FAILED);
        assertThat(detailed.tasks()).hasSize(2);
        assertThat(detailed.tasks().get(0).taskId()).isEqualTo("task-1");
        assertThat(detailed.tasks().get(0).status()).isEqualTo(TaskState.COMPLETED);
        assertThat(detailed.tasks().get(1).taskId()).isEqualTo("task-2");
        assertThat(detailed.tasks().get(1).status()).isEqualTo(TaskState.FAILED);
        assertThat(detailed.tasks().get(1).errorMessage()).isEqualTo("Simulated network timeout");

        // Verify task list immutability
        assertThatThrownBy(() -> detailed.tasks().add(TaskRunResponse.fromEntity(tr1)))
            .isInstanceOf(UnsupportedOperationException.class);
    }
}
