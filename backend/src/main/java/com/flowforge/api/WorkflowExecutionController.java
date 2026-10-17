package com.flowforge.api;

import com.flowforge.api.dto.ExecuteWorkflowRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for submitting and synchronously executing workflows within bounded concurrency limits.
 */
@RestController
@RequestMapping("/api/v1/workflows")
public class WorkflowExecutionController {

    private final WorkflowExecutionService executionService;

    public WorkflowExecutionController(WorkflowExecutionService executionService) {
        this.executionService = executionService;
    }

    @PostMapping("/execute")
    public ResponseEntity<?> executeWorkflow(@RequestBody ExecuteWorkflowRequest request) {
        return executionService.executeWorkflow(request);
    }
}
