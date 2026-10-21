package com.flowforge.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.CreateWorkflowVersionRequest;
import com.flowforge.domain.Project;
import com.flowforge.domain.Workflow;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.service.WorkflowVersionService;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(WorkflowVersionController.class)
@AutoConfigureMockMvc(addFilters = false)
class WorkflowVersionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WorkflowVersionService workflowVersionService;

    private Workflow createMockWorkflow(UUID workflowId) {
        Project project = new Project(UUID.randomUUID(), "Project", "proj", null);
        return new Workflow(workflowId, project, "Workflow", "wf", null);
    }

    private WorkflowVersion createMockVersion(
            UUID versionId,
            Workflow workflow,
            int versionNumber,
            String versionTag,
            String description,
            JsonNode payload,
            int taskCount,
            int edgeCount,
            boolean isValidDag
    ) {
        WorkflowVersion version = new WorkflowVersion(
                versionId,
                workflow,
                versionNumber,
                versionTag,
                description,
                payload,
                taskCount,
                edgeCount,
                isValidDag
        );
        try {
            java.lang.reflect.Field field = WorkflowVersion.class.getDeclaredField("createdAt");
            field.setAccessible(true);
            field.set(version, Instant.parse("2026-10-19T10:00:00Z"));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        return version;
    }

    @Test
    @DisplayName("1. POST /api/v1/workflows/{workflowId}/versions creates valid version and returns 201 Created")
    void createVersion_validDag_success() throws Exception {
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        Workflow workflow = createMockWorkflow(workflowId);

        String payloadJson = """
            {
              "nodes": [
                { "id": "A", "type": "taskNode", "data": { "label": "Task A" } },
                { "id": "B", "type": "taskNode", "data": { "label": "Task B" } }
              ],
              "edges": [
                { "id": "e1", "source": "A", "target": "B" }
              ]
            }
            """;
        JsonNode graphPayload = objectMapper.readTree(payloadJson);
        WorkflowVersion version = createMockVersion(versionId, workflow, 1, "v1.0.0", "Initial", graphPayload, 2, 1, true);

        when(workflowVersionService.createVersion(eq(workflowId), eq("v1.0.0"), eq("Initial"), any(JsonNode.class)))
                .thenReturn(version);

        CreateWorkflowVersionRequest request = new CreateWorkflowVersionRequest("v1.0.0", "Initial", graphPayload);

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", workflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(versionId.toString()))
                .andExpect(jsonPath("$.workflowId").value(workflowId.toString()))
                .andExpect(jsonPath("$.versionNumber").value(1))
                .andExpect(jsonPath("$.versionTag").value("v1.0.0"))
                .andExpect(jsonPath("$.description").value("Initial"))
                .andExpect(jsonPath("$.taskCount").value(2))
                .andExpect(jsonPath("$.edgeCount").value(1))
                .andExpect(jsonPath("$.isValidDag").value(true))
                .andExpect(jsonPath("$.createdAt").value("2026-10-19T10:00:00Z"))
                .andExpect(jsonPath("$.graphPayload.nodes", hasSize(2)))
                .andExpect(jsonPath("$.graphPayload.edges", hasSize(1)));
    }

    @Test
    @DisplayName("2. POST /api/v1/workflows/{workflowId}/versions accepts cyclic DAG and saves draft with isValidDag: false")
    void createVersion_cyclicDagDraft_success() throws Exception {
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        Workflow workflow = createMockWorkflow(workflowId);

        String payloadJson = """
            {
              "nodes": [
                { "id": "A", "type": "taskNode", "data": { "label": "Task A" } },
                { "id": "B", "type": "taskNode", "data": { "label": "Task B" } }
              ],
              "edges": [
                { "id": "e1", "source": "A", "target": "B" },
                { "id": "e2", "source": "B", "target": "A" }
              ]
            }
            """;
        JsonNode graphPayload = objectMapper.readTree(payloadJson);
        WorkflowVersion version = createMockVersion(versionId, workflow, 1, "draft-1", "Cyclic draft", graphPayload, 2, 2, false);

        when(workflowVersionService.createVersion(eq(workflowId), eq("draft-1"), eq("Cyclic draft"), any(JsonNode.class)))
                .thenReturn(version);

        CreateWorkflowVersionRequest request = new CreateWorkflowVersionRequest("draft-1", "Cyclic draft", graphPayload);

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", workflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(versionId.toString()))
                .andExpect(jsonPath("$.versionNumber").value(1))
                .andExpect(jsonPath("$.taskCount").value(2))
                .andExpect(jsonPath("$.edgeCount").value(2))
                .andExpect(jsonPath("$.isValidDag").value(false));
    }

    @Test
    @DisplayName("3. POST /api/v1/workflows/{workflowId}/versions with missing graphPayload returns 400 Bad Request")
    void createVersion_missingGraphPayload_validationFailure() throws Exception {
        UUID workflowId = UUID.randomUUID();
        String requestBody = """
            {
              "versionTag": "v1.0.0",
              "description": "Missing payload"
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", workflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.details", hasItem(containsString("graphPayload must not be null"))));

        verifyNoInteractions(workflowVersionService);
    }

    @Test
    @DisplayName("4. POST /api/v1/workflows/{workflowId}/versions with versionTag exceeding 30 chars returns 400 Bad Request")
    void createVersion_tagTooLong_validationFailure() throws Exception {
        UUID workflowId = UUID.randomUUID();
        String longTag = "T".repeat(31);
        String requestBody = """
            {
              "versionTag": "%s",
              "graphPayload": { "nodes": [] }
            }
            """.formatted(longTag);

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", workflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.details", hasItem(containsString("Version tag must not exceed 30 characters"))));

        verifyNoInteractions(workflowVersionService);
    }

    @Test
    @DisplayName("5. POST /api/v1/workflows/{workflowId}/versions with structurally invalid snapshot returns 400 Bad Request")
    void createVersion_structurallyInvalidSnapshot() throws Exception {
        UUID workflowId = UUID.randomUUID();
        JsonNode invalidPayload = objectMapper.readTree("{\"nodes\": \"not-an-array\"}");

        when(workflowVersionService.createVersion(eq(workflowId), any(), any(), any(JsonNode.class)))
                .thenThrow(new IllegalArgumentException("Field 'nodes' must be a JSON array if present"));

        CreateWorkflowVersionRequest request = new CreateWorkflowVersionRequest(null, null, invalidPayload);

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", workflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").value("Field 'nodes' must be a JSON array if present"));
    }

    @Test
    @DisplayName("6. POST /api/v1/workflows/{workflowId}/versions when workflow not found returns 404 Not Found")
    void createVersion_parentWorkflowNotFound() throws Exception {
        UUID missingWorkflowId = UUID.randomUUID();
        JsonNode payload = objectMapper.readTree("{\"nodes\": []}");

        when(workflowVersionService.createVersion(eq(missingWorkflowId), any(), any(), any(JsonNode.class)))
                .thenThrow(new ResourceNotFoundException("Workflow not found with id: " + missingWorkflowId));

        CreateWorkflowVersionRequest request = new CreateWorkflowVersionRequest(null, null, payload);

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", missingWorkflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.message").value("Workflow not found with id: " + missingWorkflowId));
    }

    @Test
    @DisplayName("7. POST /api/v1/workflows/{workflowId}/versions with malformed JSON returns 400 Bad Request")
    void createVersion_malformedJson() throws Exception {
        UUID workflowId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/workflows/{workflowId}/versions", workflowId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ unclosed json: "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").value("Malformed JSON request payload"));

        verifyNoInteractions(workflowVersionService);
    }

    @Test
    @DisplayName("8. GET /api/v1/workflows/{workflowId}/versions returns paginated summary responses without graphPayload")
    void listVersions_paginatedSummaries() throws Exception {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = createMockWorkflow(workflowId);
        JsonNode payload = objectMapper.readTree("{\"nodes\": []}");

        WorkflowVersion v1 = createMockVersion(UUID.randomUUID(), workflow, 1, "v1", "v1 desc", payload, 3, 2, true);
        WorkflowVersion v2 = createMockVersion(UUID.randomUUID(), workflow, 2, "v2", "v2 desc", payload, 5, 4, true);

        when(workflowVersionService.listVersions(eq(workflowId), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(v2, v1), PageRequest.of(0, 20), 2));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/versions?page=0&size=20", workflowId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[0].versionNumber").value(2))
                .andExpect(jsonPath("$.content[0].versionTag").value("v2"))
                .andExpect(jsonPath("$.content[0].taskCount").value(5))
                .andExpect(jsonPath("$.content[0].edgeCount").value(4))
                .andExpect(jsonPath("$.content[0].isValidDag").value(true))
                .andExpect(jsonPath("$.content[0].graphPayload").doesNotExist()) // Summary DTO excludes graphPayload
                .andExpect(jsonPath("$.content[1].versionNumber").value(1))
                .andExpect(jsonPath("$.content[1].graphPayload").doesNotExist())
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    @DisplayName("9. GET /api/v1/workflows/{workflowId}/versions returns 404 Not Found when workflow does not exist")
    void listVersions_workflowNotFound() throws Exception {
        UUID missingWorkflowId = UUID.randomUUID();
        when(workflowVersionService.listVersions(eq(missingWorkflowId), any(Pageable.class)))
                .thenThrow(new ResourceNotFoundException("Workflow not found with id: " + missingWorkflowId));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/versions", missingWorkflowId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    @DisplayName("10. GET /api/v1/workflows/{workflowId}/versions/latest returns 200 OK with full graphPayload")
    void getLatestVersion_found() throws Exception {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = createMockWorkflow(workflowId);
        JsonNode payload = objectMapper.readTree("{\"nodes\": [{\"id\": \"node-1\"}]}");

        WorkflowVersion v2 = createMockVersion(UUID.randomUUID(), workflow, 2, "v2", "v2 desc", payload, 1, 0, true);

        when(workflowVersionService.getLatestVersion(workflowId)).thenReturn(v2);

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/versions/latest", workflowId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionNumber").value(2))
                .andExpect(jsonPath("$.versionTag").value("v2"))
                .andExpect(jsonPath("$.taskCount").value(1))
                .andExpect(jsonPath("$.edgeCount").value(0))
                .andExpect(jsonPath("$.isValidDag").value(true))
                .andExpect(jsonPath("$.graphPayload.nodes", hasSize(1)));
    }

    @Test
    @DisplayName("11. GET /api/v1/workflows/{workflowId}/versions/latest returns 404 Not Found when no versions exist")
    void getLatestVersion_notFound() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowVersionService.getLatestVersion(workflowId))
                .thenThrow(new ResourceNotFoundException("No versions exist for workflow: " + workflowId));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/versions/latest", workflowId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    @DisplayName("12. GET /api/v1/workflows/{workflowId}/versions/{versionNumber} returns 200 OK with full payload")
    void getVersionByNumber_found() throws Exception {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = createMockWorkflow(workflowId);
        JsonNode payload = objectMapper.readTree("{\"nodes\": [{\"id\": \"node-A\"}]}");

        WorkflowVersion v1 = createMockVersion(UUID.randomUUID(), workflow, 1, "v1", "v1 desc", payload, 1, 0, true);

        when(workflowVersionService.getVersionByNumber(workflowId, 1)).thenReturn(v1);

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/versions/{versionNumber}", workflowId, 1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionNumber").value(1))
                .andExpect(jsonPath("$.graphPayload.nodes", hasSize(1)));
    }

    @Test
    @DisplayName("13. GET /api/v1/workflows/{workflowId}/versions/{versionNumber} returns 404 Not Found")
    void getVersionByNumber_notFound() throws Exception {
        UUID workflowId = UUID.randomUUID();
        when(workflowVersionService.getVersionByNumber(workflowId, 99))
                .thenThrow(new ResourceNotFoundException("Workflow version 99 not found for workflow: " + workflowId));

        mockMvc.perform(get("/api/v1/workflows/{workflowId}/versions/{versionNumber}", workflowId, 99))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }
}
