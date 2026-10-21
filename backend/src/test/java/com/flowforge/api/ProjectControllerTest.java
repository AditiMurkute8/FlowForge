package com.flowforge.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.CreateProjectRequest;
import com.flowforge.domain.Project;
import com.flowforge.service.ProjectService;
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

@WebMvcTest(ProjectController.class)
@AutoConfigureMockMvc(addFilters = false)
class ProjectControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProjectService projectService;

    private Project createMockProject(UUID id, String name, String slug, String description) {
        Project project = new Project(id, name, slug, description);
        project.setCreatedAt(Instant.parse("2026-10-19T10:00:00Z"));
        project.setUpdatedAt(Instant.parse("2026-10-19T10:00:00Z"));
        return project;
    }

    @Test
    @DisplayName("1. POST /api/v1/projects creates project and returns 201 Created with ProjectResponse")
    void createProject_success() throws Exception {
        UUID projectId = UUID.randomUUID();
        Project project = createMockProject(projectId, "Test Project", "test-project", "Test description");

        when(projectService.createProject(eq("Test Project"), eq("test-project"), eq("Test description")))
                .thenReturn(project);

        CreateProjectRequest request = new CreateProjectRequest("Test Project", "test-project", "Test description");

        mockMvc.perform(post("/api/v1/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(projectId.toString()))
                .andExpect(jsonPath("$.name").value("Test Project"))
                .andExpect(jsonPath("$.slug").value("test-project"))
                .andExpect(jsonPath("$.description").value("Test description"))
                .andExpect(jsonPath("$.createdAt").value("2026-10-19T10:00:00Z"))
                .andExpect(jsonPath("$.updatedAt").value("2026-10-19T10:00:00Z"));
    }

    @Test
    @DisplayName("2. POST /api/v1/projects with blank name returns 400 Bad Request with validation details")
    void createProject_blankName_validationFailure() throws Exception {
        CreateProjectRequest request = new CreateProjectRequest("   ", "test-slug", "Description");

        mockMvc.perform(post("/api/v1/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").value("Invalid request parameters"))
                .andExpect(jsonPath("$.details", hasItem(containsString("Project name must not be blank"))));

        verifyNoInteractions(projectService);
    }

    @Test
    @DisplayName("3. POST /api/v1/projects with name exceeding 100 chars returns 400 Bad Request")
    void createProject_nameTooLong_validationFailure() throws Exception {
        String longName = "A".repeat(101);
        CreateProjectRequest request = new CreateProjectRequest(longName, "valid-slug", "Description");

        mockMvc.perform(post("/api/v1/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.details", hasItem(containsString("Project name must not exceed 100 characters"))));

        verifyNoInteractions(projectService);
    }

    @Test
    @DisplayName("4. POST /api/v1/projects with malformed JSON returns 400 Bad Request")
    void createProject_malformedJson() throws Exception {
        mockMvc.perform(post("/api/v1/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ \"name\": unclosed string..."))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").value("Malformed JSON request payload"));

        verifyNoInteractions(projectService);
    }

    @Test
    @DisplayName("5. POST /api/v1/projects when slug conflict occurs returns 409 Conflict")
    void createProject_slugConflict() throws Exception {
        when(projectService.createProject(eq("Existing"), eq("existing"), any()))
                .thenThrow(new ResourceConflictException("Project with slug 'existing' already exists"));

        CreateProjectRequest request = new CreateProjectRequest("Existing", "existing", null);

        mockMvc.perform(post("/api/v1/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("Conflict"))
                .andExpect(jsonPath("$.message").value("Project with slug 'existing' already exists"));
    }

    @Test
    @DisplayName("6. GET /api/v1/projects returns paginated projects with 200 OK")
    void listProjects_paginated() throws Exception {
        UUID id1 = UUID.randomUUID();
        UUID id2 = UUID.randomUUID();
        Project p1 = createMockProject(id1, "Project 1", "project-1", null);
        Project p2 = createMockProject(id2, "Project 2", "project-2", null);

        when(projectService.listProjects(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(p1, p2), PageRequest.of(0, 20), 2));

        mockMvc.perform(get("/api/v1/projects?page=0&size=20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[0].id").value(id1.toString()))
                .andExpect(jsonPath("$.content[0].name").value("Project 1"))
                .andExpect(jsonPath("$.content[1].id").value(id2.toString()))
                .andExpect(jsonPath("$.content[1].name").value("Project 2"))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(1));
    }

    @Test
    @DisplayName("7. GET /api/v1/projects/{projectId} returns 200 OK with ProjectResponse")
    void getProjectById_found() throws Exception {
        UUID projectId = UUID.randomUUID();
        Project project = createMockProject(projectId, "Found Project", "found-proj", "Desc");

        when(projectService.getProjectById(projectId)).thenReturn(project);

        mockMvc.perform(get("/api/v1/projects/{projectId}", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(projectId.toString()))
                .andExpect(jsonPath("$.name").value("Found Project"))
                .andExpect(jsonPath("$.slug").value("found-proj"));
    }

    @Test
    @DisplayName("8. GET /api/v1/projects/{projectId} returns 404 Not Found when non-existent")
    void getProjectById_notFound() throws Exception {
        UUID missingId = UUID.randomUUID();
        when(projectService.getProjectById(missingId))
                .thenThrow(new ResourceNotFoundException("Project not found with id: " + missingId));

        mockMvc.perform(get("/api/v1/projects/{projectId}", missingId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.message").value("Project not found with id: " + missingId));
    }

    @Test
    @DisplayName("9. GET /api/v1/projects/slug/{slug} returns 200 OK with ProjectResponse")
    void getProjectBySlug_found() throws Exception {
        UUID projectId = UUID.randomUUID();
        Project project = createMockProject(projectId, "Slugged Proj", "slugged-proj", "Desc");

        when(projectService.getProjectBySlug("slugged-proj")).thenReturn(project);

        mockMvc.perform(get("/api/v1/projects/slug/{slug}", "slugged-proj"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(projectId.toString()))
                .andExpect(jsonPath("$.slug").value("slugged-proj"));
    }

    @Test
    @DisplayName("10. GET /api/v1/projects/slug/{slug} returns 404 Not Found when non-existent")
    void getProjectBySlug_notFound() throws Exception {
        when(projectService.getProjectBySlug("missing-slug"))
                .thenThrow(new ResourceNotFoundException("Project not found with slug: missing-slug"));

        mockMvc.perform(get("/api/v1/projects/slug/{slug}", "missing-slug"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.message").value("Project not found with slug: missing-slug"));
    }

    @Test
    @DisplayName("11. DELETE /api/v1/projects/{projectId} returns 204 No Content on success")
    void deleteProject_success() throws Exception {
        UUID projectId = UUID.randomUUID();
        doNothing().when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/v1/projects/{projectId}", projectId))
                .andExpect(status().isNoContent());

        verify(projectService, times(1)).deleteProject(projectId);
    }

    @Test
    @DisplayName("12. DELETE /api/v1/projects/{projectId} returns 409 Conflict when project has child workflows")
    void deleteProject_conflictWithWorkflows() throws Exception {
        UUID projectId = UUID.randomUUID();
        doThrow(new ResourceConflictException("Cannot delete project: existing workflows are associated with it"))
                .when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/v1/projects/{projectId}", projectId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("Conflict"))
                .andExpect(jsonPath("$.message").value("Cannot delete project: existing workflows are associated with it"));
    }

    @Test
    @DisplayName("13. DELETE /api/v1/projects/{projectId} returns 404 Not Found when project does not exist")
    void deleteProject_notFound() throws Exception {
        UUID missingId = UUID.randomUUID();
        doThrow(new ResourceNotFoundException("Project not found with id: " + missingId))
                .when(projectService).deleteProject(missingId);

        mockMvc.perform(delete("/api/v1/projects/{projectId}", missingId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"));
    }
}
