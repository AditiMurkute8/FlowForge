package com.flowforge.api;

import com.flowforge.api.dto.ExecuteRunRequest;
import com.flowforge.api.dto.TaskRunResponse;
import com.flowforge.api.dto.WorkflowRunResponse;
import com.flowforge.api.dto.WorkflowRunSummaryResponse;
import com.flowforge.domain.TaskRun;
import com.flowforge.domain.WorkflowRun;
import com.flowforge.service.WorkflowRunService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for executing workflow versions and querying durable run history and task run details.
 */
@RestController
public class WorkflowRunController {

    public static final int DEFAULT_PAGE_SIZE = 20;
    public static final int MAX_PAGE_SIZE = 100;

    private final WorkflowRunService workflowRunService;

    public WorkflowRunController(WorkflowRunService workflowRunService) {
        this.workflowRunService = workflowRunService;
    }

    /**
     * Executes a specific workflow version synchronously within bounded concurrency and timeout,
     * persisting the execution run and task run records.
     *
     * @param workflowId unique workflow identifier
     * @param request optional execution parameters (versionNumber, triggeredBy, concurrency)
     * @return persisted workflow run in terminal state with executed tasks
     */
    @PostMapping("/api/v1/workflows/{workflowId}/runs")
    public ResponseEntity<WorkflowRunResponse> executeWorkflowRun(
            @PathVariable UUID workflowId,
            @Valid @RequestBody(required = false) ExecuteRunRequest request
    ) {
        ExecuteRunRequest effectiveRequest = request != null ? request : new ExecuteRunRequest();
        WorkflowRun run = workflowRunService.executeWorkflow(workflowId, effectiveRequest);
        List<TaskRun> taskRuns = workflowRunService.listTaskRunsForRun(run.getId());
        List<TaskRunResponse> taskResponses = taskRuns.stream()
                .map(TaskRunResponse::fromEntity)
                .toList();
        return ResponseEntity.status(HttpStatus.CREATED).body(WorkflowRunResponse.fromEntity(run, taskResponses));
    }

    /**
     * Lists workflow runs for a specific workflow, sorted newest-first with pagination.
     * Enforces default page size of 20 and maximum page size of 100.
     *
     * @param workflowId unique workflow identifier
     * @param pageable pagination parameters (page, size, sort)
     * @return paginated list of workflow run summaries
     */
    @GetMapping("/api/v1/workflows/{workflowId}/runs")
    public ResponseEntity<Page<WorkflowRunSummaryResponse>> listRunsForWorkflow(
            @PathVariable UUID workflowId,
            @PageableDefault(size = DEFAULT_PAGE_SIZE) Pageable pageable
    ) {
        int pageNumber = Math.max(0, pageable.getPageNumber());
        int pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageable.getPageSize()));
        Pageable effectivePageable = PageRequest.of(pageNumber, pageSize, pageable.getSort());

        Page<WorkflowRun> page = workflowRunService.listRunsForWorkflow(workflowId, effectivePageable);
        return ResponseEntity.ok(page.map(WorkflowRunSummaryResponse::fromEntity));
    }

    /**
     * Retrieves one durable workflow run by ID, including its executed task runs.
     *
     * @param runId unique workflow run identifier
     * @return detailed workflow run response with tasks
     */
    @GetMapping("/api/v1/runs/{runId}")
    public ResponseEntity<WorkflowRunResponse> getRunById(@PathVariable UUID runId) {
        WorkflowRun run = workflowRunService.getRunById(runId);
        List<TaskRun> taskRuns = workflowRunService.listTaskRunsForRun(runId);
        List<TaskRunResponse> taskResponses = taskRuns.stream()
                .map(TaskRunResponse::fromEntity)
                .toList();
        return ResponseEntity.ok(WorkflowRunResponse.fromEntity(run, taskResponses));
    }

    /**
     * Lists task execution records for a specific durable workflow run in deterministic order.
     *
     * @param runId unique workflow run identifier
     * @return list of task execution responses
     */
    @GetMapping("/api/v1/runs/{runId}/tasks")
    public ResponseEntity<List<TaskRunResponse>> listTaskRunsForRun(@PathVariable UUID runId) {
        List<TaskRun> taskRuns = workflowRunService.listTaskRunsForRun(runId);
        List<TaskRunResponse> response = taskRuns.stream()
                .map(TaskRunResponse::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }
}
