package com.flowforge.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.CreateWorkflowRequest;
import com.flowforge.domain.Project;
import com.flowforge.domain.Workflow;
import com.flowforge.service.WorkflowService;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
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

import static org.hamcrest.Matchers.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(WorkflowController.class)
@AutoConfigureMockMvc(addFilters = false)
class WorkflowControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WorkflowService workflowService;

    private Workflow createMockWorkflow(UUID id, Project project, String name, String slug, String description) {
        Workflow workflow = new Workflow(id, project, name, slug, description);
        workflow.setCreatedAt(Instant.parse("2026-10-19T10:00:00Z"));
        workflow.setUpdatedAt(Instant.parse("2026-10-19T10:00:00Z"));
        return workflow;
    }

    private Project createMockProject(UUID id) {
        return new Project(id, "Test Project", "test-project", "Description");
    }

    @Test
    @DisplayName("1. POST /api/v1/projects/{projectId}/workflows creates workflow and returns 201 Created with WorkflowResponse")
    void createWorkflow_success() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        Project project = createMockProject(projectId);
        Workflow workflow = createMockWorkflow(workflowId, project, "ETL Pipeline", "etl-pipeline", "Nightly ETL job");

        when(workflowService.createWorkflow(eq(projectId), eq("ETL Pipeline"), eq("etl-pipeline"), eq("Nightly ETL job")))
                .thenReturn(workflow);

        CreateWorkflowRequest request = new CreateWorkflowRequest("ETL Pipeline", "etl-pipeline", "Nightly ETL job");

        mockMvc.perform(post("/api/v1/projects/{projectId}/workflows", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(workflowId.toString()))
                .andExpect(jsonPath("$.projectId").value(projectId.toString()))
                .andExpect(jsonPath("$.name").value("ETL Pipeline"))
                .andExpect(jsonPath("$.slug").value("etl-pipeline"))
                .andExpect(jsonPath("$.description").value("Nightly ETL job"))
                .andExpect(jsonPath("$.createdAt").value("2026-10-19T10:00:00Z"))
                .andExpect(jsonPath("$.updatedAt").value("2026-10-19T10:00:00Z"));
    }

    @Test
    @DisplayName("2. POST /api/v1/projects/{projectId}/workflows with blank name returns 400 Bad Request")
    void createWorkflow_blankName_validationFailure() throws Exception {
        UUID projectId = UUID.randomUUID();
        CreateWorkflowRequest request = new CreateWorkflowRequest("", "etl-slug", "Desc");

        mockMvc.perform(post("/api/v1/projects/{projectId}/workflows", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.details", hasItem(containsString("Workflow name must not be blank"))));

        verifyNoInteractions(workflowService);
    }

    @Test
    @DisplayName("3. POST /api/v1/projects/{projectId}/workflows when project not found returns 404 Not Found")
    void createWorkflow_parentProjectNotFound() throws Exception {
        UUID missingProjectId = UUID.randomUUID();
        when(workflowService.createWorkflow(eq(missingProjectId), eq("Flow"), any(), any()))
                .thenThrow(new ResourceNotFoundException("Project not found with id: " + missingProjectId));

        CreateWorkflowRequest request = new CreateWorkflowRequest("Flow", null, null);

        mockMvc.perform(post("/api/v1/projects/{projectId}/workflows", missingProjectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.message").value("Project not found with id: " + missingProjectId));
    }

    @Test
    @DisplayName("4. POST /api/v1/projects/{projectId}/workflows when slug conflict returns 409 Conflict")
    void createWorkflow_slugConflict() throws Exception {
        UUID projectId = UUID.randomUUID();
        when(workflowService.createWorkflow(eq(projectId), eq("Existing"), eq("existing"), any()))
                .thenThrow(new ResourceConflictException("Workflow with slug 'existing' already exists in this project"));

        CreateWorkflowRequest request = new CreateWorkflowRequest("Existing", "existing", null);

        mockMvc.perform(post("/api/v1/projects/{projectId}/workflows", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("Conflict"))
                .andExpect(jsonPath("$.message").value("Workflow with slug 'existing' already exists in this project"));
    }

    @Test
    @DisplayName("5. POST /api/v1/projects/{projectId}/workflows with malformed JSON returns 400 Bad Request")
    void createWorkflow_malformedJson() throws Exception {
        UUID projectId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/projects/{projectId}/workflows", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": unterminated..."))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").value("Malformed JSON request payload"));

        verifyNoInteractions(workflowService);
    }

    @Test
    @DisplayName("6. GET /api/v1/projects/{projectId}/workflows returns paginated workflows with 200 OK")
    void listWorkflowsByProject_paginated() throws Exception {
        UUID projectId = UUID.randomUUID();
        Project project = createMockProject(projectId);
        UUID w1Id = UUID.randomUUID();
        UUID w2Id = UUID.randomUUID();
        Workflow w1 = createMockWorkflow(w1Id, project, "Workflow 1", "wf-1", null);
        Workflow w2 = createMockWorkflow(w2Id, project, "Workflow 2", "wf-2", null);

        when(workflowService.listWorkflowsByProject(eq(projectId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(w1, w2), PageRequest.of(0, 20), 2));

        mockMvc.perform(get("/api/v1/projects/{projectId}/workflows?page=0&size=20", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[0].id").value(w1Id.toString()))
                .andExpect(jsonPath("$.content[0].name").value("Workflow 1"))
                .andExpect(jsonPath("$.content[1].id").value(w2Id.toString()))
                .andExpect(jsonPath("$.content[1].name").value("Workflow 2"))
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    @DisplayName("7. GET /api/v1/projects/{projectId}/workflows returns 404 Not Found when project does not exist")
    void listWorkflowsByProject_projectNotFound() throws Exception {
        UUID missingProjectId = UUID.randomUUID();
        when(workflowService.listWorkflowsByProject(eq(missingProjectId), any(Pageable.class)))
                .thenThrow(new ResourceNotFoundException("Project not found with id: " + missingProjectId));

        mockMvc.perform(get("/api/v1/projects/{projectId}/workflows", missingProjectId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    @DisplayName("8. GET /api/v1/workflows/{workflowId} returns 200 OK with WorkflowResponse")
    void getWorkflowById_found() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        Project project = createMockProject(projectId);
        Workflow workflow = createMockWorkflow(workflowId, project, "Found WF", "found-wf", "Desc");

        when(workflowService.getWorkflowById(workflowId)).thenReturn(workflow);

        mockMvc.perform(get("/api/v1/workflows/{workflowId}", workflowId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(workflowId.toString()))
                .andExpect(jsonPath("$.projectId").value(projectId.toString()))
                .andExpect(jsonPath("$.name").value("Found WF"))
                .andExpect(jsonPath("$.slug").value("found-wf"));
    }

    @Test
    @DisplayName("9. GET /api/v1/workflows/{workflowId} returns 404 Not Found when non-existent")
    void getWorkflowById_notFound() throws Exception {
        UUID missingId = UUID.randomUUID();
        when(workflowService.getWorkflowById(missingId))
                .thenThrow(new ResourceNotFoundException("Workflow not found with id: " + missingId));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}", missingId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    @DisplayName("10. GET /api/v1/projects/{projectId}/workflows/slug/{workflowSlug} returns 200 OK")
    void getWorkflowByProjectAndSlug_found() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        Project project = createMockProject(projectId);
        Workflow workflow = createMockWorkflow(workflowId, project, "Slugged WF", "slugged-wf", "Desc");

        when(workflowService.getWorkflowByProjectAndSlug(projectId, "slugged-wf")).thenReturn(workflow);

        mockMvc.perform(get("/api/v1/projects/{projectId}/workflows/slug/{workflowSlug}", projectId, "slugged-wf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(workflowId.toString()))
                .andExpect(jsonPath("$.projectId").value(projectId.toString()))
                .andExpect(jsonPath("$.slug").value("slugged-wf"));
    }

    @Test
    @DisplayName("11. GET /api/v1/projects/{projectId}/workflows/slug/{workflowSlug} returns 404 Not Found")
    void getWorkflowByProjectAndSlug_notFound() throws Exception {
        UUID projectId = UUID.randomUUID();
        when(workflowService.getWorkflowByProjectAndSlug(projectId, "missing-wf"))
                .thenThrow(new ResourceNotFoundException("Workflow not found with slug: missing-wf in project: " + projectId));

        mockMvc.perform(get("/api/v1/projects/{projectId}/workflows/slug/{workflowSlug}", projectId, "missing-wf"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    @DisplayName("12. DELETE /api/v1/workflows/{workflowId} returns 204 No Content on success")
    void deleteWorkflow_success() throws Exception {
        UUID workflowId = UUID.randomUUID();
        doNothing().when(workflowService).deleteWorkflow(workflowId);

        mockMvc.perform(delete("/api/v1/workflows/{workflowId}", workflowId))
                .andExpect(status().isNoContent());

        verify(workflowService, times(1)).deleteWorkflow(workflowId);
    }

    @Test
    @DisplayName("13. DELETE /api/v1/workflows/{workflowId} returns 409 Conflict when workflow has versions")
    void deleteWorkflow_conflictWithVersions() throws Exception {
        UUID workflowId = UUID.randomUUID();
        doThrow(new ResourceConflictException("Cannot delete workflow: existing immutable versions are associated with it"))
                .when(workflowService).deleteWorkflow(workflowId);

        mockMvc.perform(delete("/api/v1/workflows/{workflowId}", workflowId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("Conflict"))
                .andExpect(jsonPath("$.message").value("Cannot delete workflow: existing immutable versions are associated with it"));
    }

    @Test
    @DisplayName("14. DELETE /api/v1/workflows/{workflowId} returns 404 Not Found when workflow does not exist")
    void deleteWorkflow_notFound() throws Exception {
        UUID missingId = UUID.randomUUID();
        doThrow(new ResourceNotFoundException("Workflow not found with id: " + missingId))
                .when(workflowService).deleteWorkflow(missingId);

        mockMvc.perform(delete("/api/v1/workflows/{workflowId}", missingId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }
}
