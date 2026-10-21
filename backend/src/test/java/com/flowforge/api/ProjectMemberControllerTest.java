package com.flowforge.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.AddProjectMemberRequest;
import com.flowforge.api.dto.ProjectMemberResponse;
import com.flowforge.domain.ProjectRole;
import com.flowforge.service.ProjectMemberService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ProjectMemberController.class)
@AutoConfigureMockMvc(addFilters = false)
class ProjectMemberControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProjectMemberService projectMemberService;

    @Test
    @DisplayName("GET /api/v1/projects/{projectId}/members returns 200 OK and list of members")
    void listMembers_returns200() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        ProjectMemberResponse member = new ProjectMemberResponse(
            UUID.randomUUID(), projectId, userId, "user@flowforge.io", "Test User", ProjectRole.DEVELOPER, Instant.now()
        );

        when(projectMemberService.listMembers(projectId)).thenReturn(List.of(member));

        mockMvc.perform(get("/api/v1/projects/{projectId}/members", projectId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].projectId").value(projectId.toString()))
            .andExpect(jsonPath("$[0].userId").value(userId.toString()))
            .andExpect(jsonPath("$[0].role").value("DEVELOPER"));
    }

    @Test
    @DisplayName("POST /api/v1/projects/{projectId}/members returns 201 Created and member details")
    void addMember_returns201() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AddProjectMemberRequest request = new AddProjectMemberRequest(userId, null, ProjectRole.ADMIN);
        ProjectMemberResponse response = new ProjectMemberResponse(
            UUID.randomUUID(), projectId, userId, "admin@flowforge.io", "Admin User", ProjectRole.ADMIN, Instant.now()
        );

        when(projectMemberService.addOrUpdateMember(eq(projectId), any(AddProjectMemberRequest.class)))
            .thenReturn(response);

        mockMvc.perform(post("/api/v1/projects/{projectId}/members", projectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.role").value("ADMIN"));
    }

    @Test
    @DisplayName("DELETE /api/v1/projects/{projectId}/members/{userId} returns 204 No Content")
    void removeMember_returns204() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        mockMvc.perform(delete("/api/v1/projects/{projectId}/members/{userId}", projectId, userId))
            .andExpect(status().isNoContent());

        verify(projectMemberService).removeMember(projectId, userId);
    }
}
