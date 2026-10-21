package com.flowforge.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.domain.Project;
import com.flowforge.domain.TaskRun;
import com.flowforge.domain.Workflow;
import com.flowforge.domain.WorkflowRun;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.scheduler.TaskState;
import com.flowforge.scheduler.WorkflowRunState;
import com.flowforge.service.WorkflowRunService;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.flowforge.api.dto.ExecuteRunRequest;
import com.flowforge.core.DagValidationResult;
import com.flowforge.core.InvalidDagException;
import com.flowforge.service.exception.WorkflowCapacityExhaustedException;
import com.flowforge.service.exception.WorkflowExecutionTimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller slice tests for WorkflowRunController verifying read-only history endpoints,
 * pagination defaults, size clamping, deterministic task ordering, and 404 error envelopes.
 */
@WebMvcTest(WorkflowRunController.class)
@AutoConfigureMockMvc(addFilters = false)
class WorkflowRunControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WorkflowRunService workflowRunService;

    private WorkflowRun createMockRun(UUID runId, UUID workflowId, UUID versionId, int versionNumber) {
        Project project = new Project(UUID.randomUUID(), "Project", "proj", null);
        Workflow workflow = new Workflow(workflowId, project, "Workflow", "wf", null);
        WorkflowVersion version = new WorkflowVersion(
                versionId,
                workflow,
                versionNumber,
                "v" + versionNumber,
                "Snapshot notes",
                objectMapper.createObjectNode(),
                2,
                1,
                true
        );

        WorkflowRun run = new WorkflowRun(
                runId,
                version,
                WorkflowRunState.COMPLETED,
                Instant.parse("2026-10-20T10:00:00Z"),
                Instant.parse("2026-10-20T10:00:02Z"),
                2000L,
                "manual"
        );
        run.setCreatedAt(Instant.parse("2026-10-20T09:59:59Z"));
        return run;
    }

    private TaskRun createMockTaskRun(UUID taskRunId, WorkflowRun run, String taskId, TaskState status) {
        TaskRun taskRun = new TaskRun(
                taskRunId,
                run,
                taskId,
                status,
                1,
                Instant.parse("2026-10-20T10:00:00Z"),
                Instant.parse("2026-10-20T10:00:01Z"),
                1000L,
                status == TaskState.FAILED ? "Simulated error" : null
        );
        taskRun.setCreatedAt(Instant.parse("2026-10-20T09:59:59Z"));
        return taskRun;
    }

    @Test
    @DisplayName("1. GET /api/v1/runs/{runId} returns 200 with full run metadata and task collection")
    void getRunById_success() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        WorkflowRun run = createMockRun(runId, workflowId, versionId, 2);

        TaskRun tr1 = createMockTaskRun(UUID.randomUUID(), run, "task-1", TaskState.COMPLETED);
        TaskRun tr2 = createMockTaskRun(UUID.randomUUID(), run, "task-2", TaskState.COMPLETED);

        when(workflowRunService.getRunById(runId)).thenReturn(run);
        when(workflowRunService.listTaskRunsForRun(runId)).thenReturn(List.of(tr1, tr2));

        mockMvc.perform(get("/api/v1/runs/{runId}", runId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(runId.toString()))
            .andExpect(jsonPath("$.workflowId").value(workflowId.toString()))
            .andExpect(jsonPath("$.workflowVersionId").value(versionId.toString()))
            .andExpect(jsonPath("$.versionNumber").value(2))
            .andExpect(jsonPath("$.status").value("COMPLETED"))
            .andExpect(jsonPath("$.durationMs").value(2000))
            .andExpect(jsonPath("$.triggeredBy").value("manual"))
            .andExpect(jsonPath("$.tasks", hasSize(2)))
            .andExpect(jsonPath("$.tasks[0].taskId").value("task-1"))
            .andExpect(jsonPath("$.tasks[0].status").value("COMPLETED"))
            .andExpect(jsonPath("$.tasks[1].taskId").value("task-2"))
            .andExpect(jsonPath("$.tasks[1].status").value("COMPLETED"));

        verify(workflowRunService).getRunById(runId);
        verify(workflowRunService).listTaskRunsForRun(runId);
    }

    @Test
    @DisplayName("2. GET /api/v1/runs/{runId} returns 404 when run does not exist")
    void getRunById_notFound() throws Exception {
        UUID runId = UUID.randomUUID();
        when(workflowRunService.getRunById(runId))
                .thenThrow(new ResourceNotFoundException("Workflow run not found: " + runId));

        mockMvc.perform(get("/api/v1/runs/{runId}", runId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"))
            .andExpect(jsonPath("$.message").value("Workflow run not found: " + runId))
            .andExpect(jsonPath("$.timestamp").isNotEmpty())
            .andExpect(jsonPath("$.details").isEmpty());

        verify(workflowRunService).getRunById(runId);
        verify(workflowRunService, never()).listTaskRunsForRun(any());
    }

    @Test
    @DisplayName("3. GET /api/v1/workflows/{workflowId}/runs returns 200 with paged summaries")
    void listRunsForWorkflow_success() throws Exception {
        UUID workflowId = UUID.randomUUID();
        WorkflowRun run1 = createMockRun(UUID.randomUUID(), workflowId, UUID.randomUUID(), 1);
        WorkflowRun run2 = createMockRun(UUID.randomUUID(), workflowId, UUID.randomUUID(), 2);

        PageRequest pageRequest = PageRequest.of(0, 20);
        when(workflowRunService.listRunsForWorkflow(eq(workflowId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(run2, run1), pageRequest, 2));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/runs", workflowId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.content", hasSize(2)))
            .andExpect(jsonPath("$.content[0].id").value(run2.getId().toString()))
            .andExpect(jsonPath("$.content[0].versionNumber").value(2))
            .andExpect(jsonPath("$.content[0].taskCount").value(2))
            .andExpect(jsonPath("$.content[0].tasks").doesNotExist()) // Lightweight summary
            .andExpect(jsonPath("$.content[1].id").value(run1.getId().toString()))
            .andExpect(jsonPath("$.content[1].versionNumber").value(1))
            .andExpect(jsonPath("$.totalElements").value(2))
            .andExpect(jsonPath("$.totalPages").value(1))
            .andExpect(jsonPath("$.size").value(20))
            .andExpect(jsonPath("$.number").value(0));

        verify(workflowRunService).listRunsForWorkflow(eq(workflowId), any(Pageable.class));
    }

    @Test
    @DisplayName("4. GET /api/v1/workflows/{workflowId}/runs returns 404 for unknown workflow")
    void listRunsForWorkflow_notFound() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowRunService.listRunsForWorkflow(eq(workflowId), any(Pageable.class)))
                .thenThrow(new ResourceNotFoundException("Workflow not found: " + workflowId));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/runs", workflowId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"))
            .andExpect(jsonPath("$.message").value("Workflow not found: " + workflowId));
    }

    @Test
    @DisplayName("5. GET /api/v1/workflows/{workflowId}/runs defaults to page 0, size 20")
    void listRunsForWorkflow_defaultPagination() throws Exception {
        UUID workflowId = UUID.randomUUID();
        ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);

        when(workflowRunService.listRunsForWorkflow(eq(workflowId), captor.capture()))
                .thenReturn(new PageImpl<>(List.of()));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/runs", workflowId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk());

        Pageable captured = captor.getValue();
        assertThat(captured.getPageNumber()).isEqualTo(0);
        assertThat(captured.getPageSize()).isEqualTo(20);
    }

    @Test
    @DisplayName("6. GET /api/v1/workflows/{workflowId}/runs clamps requested size > 100 to 100")
    void listRunsForWorkflow_clampedSize() throws Exception {
        UUID workflowId = UUID.randomUUID();
        ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);

        when(workflowRunService.listRunsForWorkflow(eq(workflowId), captor.capture()))
                .thenReturn(new PageImpl<>(List.of()));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/runs", workflowId)
                .param("page", "1")
                .param("size", "250")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk());

        Pageable captured = captor.getValue();
        assertThat(captured.getPageNumber()).isEqualTo(1);
        assertThat(captured.getPageSize()).isEqualTo(100);
    }

    @Test
    @DisplayName("7. GET /api/v1/runs/{runId}/tasks returns 200 with deterministic task collection")
    void listTaskRunsForRun_success() throws Exception {
        UUID runId = UUID.randomUUID();
        WorkflowRun run = createMockRun(runId, UUID.randomUUID(), UUID.randomUUID(), 1);

        TaskRun tr1 = createMockTaskRun(UUID.randomUUID(), run, "task-a", TaskState.COMPLETED);
        TaskRun tr2 = createMockTaskRun(UUID.randomUUID(), run, "task-b", TaskState.FAILED);

        when(workflowRunService.listTaskRunsForRun(runId)).thenReturn(List.of(tr1, tr2));

        mockMvc.perform(get("/api/v1/runs/{runId}/tasks", runId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)))
            .andExpect(jsonPath("$[0].taskId").value("task-a"))
            .andExpect(jsonPath("$[0].status").value("COMPLETED"))
            .andExpect(jsonPath("$[1].taskId").value("task-b"))
            .andExpect(jsonPath("$[1].status").value("FAILED"))
            .andExpect(jsonPath("$[1].errorMessage").value("Simulated error"));

        verify(workflowRunService).listTaskRunsForRun(runId);
    }

    @Test
    @DisplayName("8. GET /api/v1/runs/{runId}/tasks returns 404 when parent run does not exist")
    void listTaskRunsForRun_notFound() throws Exception {
        UUID runId = UUID.randomUUID();
        when(workflowRunService.listTaskRunsForRun(runId))
                .thenThrow(new ResourceNotFoundException("Workflow run not found: " + runId));

        mockMvc.perform(get("/api/v1/runs/{runId}/tasks", runId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"))
            .andExpect(jsonPath("$.message").value("Workflow run not found: " + runId));
    }

    @Test
    @DisplayName("9. POST /api/v1/workflows/{workflowId}/runs executes with default request and returns 201 with tasks")
    void executeWorkflowRun_defaultRequest_success() throws Exception {
        UUID workflowId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        WorkflowRun run = createMockRun(runId, workflowId, versionId, 1);
        TaskRun tr1 = createMockTaskRun(UUID.randomUUID(), run, "node-1", TaskState.COMPLETED);

        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenReturn(run);
        when(workflowRunService.listTaskRunsForRun(runId))
                .thenReturn(List.of(tr1));

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(runId.toString()))
            .andExpect(jsonPath("$.workflowId").value(workflowId.toString()))
            .andExpect(jsonPath("$.workflowVersionId").value(versionId.toString()))
            .andExpect(jsonPath("$.versionNumber").value(1))
            .andExpect(jsonPath("$.status").value("COMPLETED"))
            .andExpect(jsonPath("$.durationMs").value(2000))
            .andExpect(jsonPath("$.triggeredBy").value("manual"))
            .andExpect(jsonPath("$.tasks", hasSize(1)))
            .andExpect(jsonPath("$.tasks[0].taskId").value("node-1"))
            .andExpect(jsonPath("$.tasks[0].status").value("COMPLETED"));

        ArgumentCaptor<ExecuteRunRequest> captor = ArgumentCaptor.forClass(ExecuteRunRequest.class);
        verify(workflowRunService).executeWorkflow(eq(workflowId), captor.capture());
        assertThat(captor.getValue().versionNumber()).isNull();
        assertThat(captor.getValue().triggeredBy()).isNull();
        assertThat(captor.getValue().concurrency()).isNull();
        verify(workflowRunService).listTaskRunsForRun(runId);
    }

    @Test
    @DisplayName("10. POST /api/v1/workflows/{workflowId}/runs executes explicit version and options, returning 201")
    void executeWorkflowRun_explicitOptions_success() throws Exception {
        UUID workflowId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        WorkflowRun run = createMockRun(runId, workflowId, versionId, 2);
        run.setTriggeredBy("api-client");

        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenReturn(run);
        when(workflowRunService.listTaskRunsForRun(runId))
                .thenReturn(List.of());

        String payload = """
            {
              "versionNumber": 2,
              "triggeredBy": "api-client",
              "concurrency": 3
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(runId.toString()))
            .andExpect(jsonPath("$.versionNumber").value(2))
            .andExpect(jsonPath("$.triggeredBy").value("api-client"))
            .andExpect(jsonPath("$.tasks", empty()));

        ArgumentCaptor<ExecuteRunRequest> captor = ArgumentCaptor.forClass(ExecuteRunRequest.class);
        verify(workflowRunService).executeWorkflow(eq(workflowId), captor.capture());
        assertThat(captor.getValue().versionNumber()).isEqualTo(2);
        assertThat(captor.getValue().triggeredBy()).isEqualTo("api-client");
        assertThat(captor.getValue().concurrency()).isEqualTo(3);
    }

    @Test
    @DisplayName("11. POST /api/v1/workflows/{workflowId}/runs returns 404 when workflow does not exist")
    void executeWorkflowRun_workflowNotFound() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenThrow(new ResourceNotFoundException("Workflow not found: " + workflowId));

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"))
            .andExpect(jsonPath("$.message").value("Workflow not found: " + workflowId))
            .andExpect(jsonPath("$.timestamp").isNotEmpty())
            .andExpect(jsonPath("$.details").isEmpty());
    }

    @Test
    @DisplayName("12. POST /api/v1/workflows/{workflowId}/runs returns 404 when requested version does not exist")
    void executeWorkflowRun_versionNotFound() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenThrow(new ResourceNotFoundException("Workflow version 3 not found for workflow " + workflowId));

        String payload = """
            {
              "versionNumber": 3
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"))
            .andExpect(jsonPath("$.message").value("Workflow version 3 not found for workflow " + workflowId));
    }

    @Test
    @DisplayName("13. POST /api/v1/workflows/{workflowId}/runs returns 404 when workflow has no saved versions")
    void executeWorkflowRun_noSavedVersions() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenThrow(new ResourceNotFoundException("Workflow has no saved versions"));

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"))
            .andExpect(jsonPath("$.message").value("Workflow has no saved versions"));
    }

    @Test
    @DisplayName("14. POST /api/v1/workflows/{workflowId}/runs returns 400 when versionNumber is less than 1")
    void executeWorkflowRun_invalidVersionNumber() throws Exception {
        UUID workflowId = UUID.randomUUID();
        String payload = """
            {
              "versionNumber": 0
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.message").value("Invalid request parameters"))
            .andExpect(jsonPath("$.details", hasItem(containsString("versionNumber"))));

        verify(workflowRunService, never()).executeWorkflow(any(), any());
    }

    @Test
    @DisplayName("15. POST /api/v1/workflows/{workflowId}/runs returns 400 when concurrency is outside 1..4 range")
    void executeWorkflowRun_invalidConcurrency() throws Exception {
        UUID workflowId = UUID.randomUUID();
        String payload = """
            {
              "concurrency": 5
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.details", hasItem(containsString("concurrency"))));

        verify(workflowRunService, never()).executeWorkflow(any(), any());
    }

    @Test
    @DisplayName("16. POST /api/v1/workflows/{workflowId}/runs returns 400 when triggeredBy exceeds 100 chars")
    void executeWorkflowRun_invalidTriggeredBy() throws Exception {
        UUID workflowId = UUID.randomUUID();
        String longTrigger = "a".repeat(101);
        String payload = String.format("{\"triggeredBy\": \"%s\"}", longTrigger);

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.details", hasItem(containsString("triggeredBy"))));

        verify(workflowRunService, never()).executeWorkflow(any(), any());
    }

    @Test
    @DisplayName("17. POST /api/v1/workflows/{workflowId}/runs returns 429 and Retry-After when capacity exhausted")
    void executeWorkflowRun_capacityExhausted() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenThrow(new WorkflowCapacityExhaustedException("System execution capacity saturated. Max concurrent workflows: 4"));

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().string("Retry-After", "5"))
            .andExpect(jsonPath("$.status").value(429))
            .andExpect(jsonPath("$.error").value("Too Many Requests"))
            .andExpect(jsonPath("$.message").value("System execution capacity saturated. Max concurrent workflows: 4"))
            .andExpect(jsonPath("$.timestamp").isNotEmpty())
            .andExpect(jsonPath("$.details").isEmpty());
    }

    @Test
    @DisplayName("18. POST /api/v1/workflows/{workflowId}/runs returns 504 when execution times out")
    void executeWorkflowRun_executionTimeout() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenThrow(new WorkflowExecutionTimeoutException("Workflow execution timed out after 30 SECONDS"));

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isGatewayTimeout())
            .andExpect(jsonPath("$.status").value(504))
            .andExpect(jsonPath("$.error").value("Gateway Timeout"))
            .andExpect(jsonPath("$.message").value("Workflow execution timed out after 30 SECONDS"))
            .andExpect(jsonPath("$.timestamp").isNotEmpty())
            .andExpect(jsonPath("$.details").isEmpty());
    }

    @Test
    @DisplayName("19. POST /api/v1/workflows/{workflowId}/runs returns 400 when DAG validation fails")
    void executeWorkflowRun_invalidDag() throws Exception {
        UUID workflowId = UUID.randomUUID();
        DagValidationResult validationResult = new DagValidationResult(
                false,
                true,
                List.of("Cycle detected: A -> B -> A"),
                List.of(),
                List.of("A", "B"),
                List.of()
        );
        when(workflowRunService.executeWorkflow(eq(workflowId), any(ExecuteRunRequest.class)))
                .thenThrow(new InvalidDagException("Cannot execute workflow version with invalid DAG", validationResult));

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/runs", workflowId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.message").value("Cannot execute workflow version with invalid DAG"))
            .andExpect(jsonPath("$.details", hasItem("Cycle detected: A -> B -> A")));
    }
}

