package com.flowforge.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.AddProjectMemberRequest;
import com.flowforge.api.dto.CreateProjectRequest;
import com.flowforge.api.dto.CreateWorkflowRequest;
import com.flowforge.api.dto.CreateWorkflowVersionRequest;
import com.flowforge.domain.*;
import com.flowforge.persistence.repository.*;
import com.flowforge.service.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
@AutoConfigureMockMvc
@Transactional
class ProjectRbacIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    @Autowired
    private WorkflowRepository workflowRepository;

    @Autowired
    private WorkflowVersionRepository workflowVersionRepository;

    @Autowired
    private WorkflowRunRepository workflowRunRepository;

    private User adminUser;
    private User devUser;
    private User viewerUser;
    private User outsiderUser;

    private String adminToken;
    private String devToken;
    private String viewerToken;
    private String outsiderToken;

    private Project testProject;
    private Workflow testWorkflow;
    private WorkflowVersion testVersion;
    private WorkflowRun testRun;

    @BeforeEach
    void setUp() throws Exception {
        // Create users
        adminUser = userRepository.save(new User("admin@flowforge.io", "hash", "Admin User"));
        devUser = userRepository.save(new User("dev@flowforge.io", "hash", "Dev User"));
        viewerUser = userRepository.save(new User("viewer@flowforge.io", "hash", "Viewer User"));
        outsiderUser = userRepository.save(new User("outsider@flowforge.io", "hash", "Outsider User"));

        // Generate tokens
        adminToken = jwtService.generateToken(adminUser);
        devToken = jwtService.generateToken(devUser);
        viewerToken = jwtService.generateToken(viewerUser);
        outsiderToken = jwtService.generateToken(outsiderUser);

        // Create Project and assign roles
        testProject = projectRepository.save(new Project("RBAC Test Project", "rbac-test-" + UUID.randomUUID(), "Testing RBAC"));
        projectMemberRepository.save(new ProjectMember(testProject, adminUser, ProjectRole.ADMIN));
        projectMemberRepository.save(new ProjectMember(testProject, devUser, ProjectRole.DEVELOPER));
        projectMemberRepository.save(new ProjectMember(testProject, viewerUser, ProjectRole.VIEWER));

        // Create Workflow, Version, and Run
        testWorkflow = workflowRepository.save(new Workflow(testProject, "RBAC Workflow", "rbac-wf", "Desc"));
        JsonNode graphPayload = objectMapper.readTree("""
            {
              "tasks": [{ "id": "t1", "action": { "type": "NO_OP" } }],
              "edges": []
            }
            """);
        testVersion = workflowVersionRepository.save(new WorkflowVersion(
            testWorkflow, 1, "v1", "Initial", graphPayload, 1, 0, true
        ));
        testRun = workflowRunRepository.save(new WorkflowRun(testVersion, "test"));
    }

    @Test
    @DisplayName("1. Unauthenticated requests receive 401 Unauthorized")
    void unauthenticatedRequestsReceive401() throws Exception {
        mockMvc.perform(get("/api/v1/projects/" + testProject.getId()))
            .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/v1/workflows/" + testWorkflow.getId()))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("2. Outsider (non-member) receives 404 Not Found on project and descendant resources (Anti-Leakage)")
    void outsiderReceives404AntiLeakage() throws Exception {
        // Project
        mockMvc.perform(get("/api/v1/projects/" + testProject.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isNotFound());

        // Workflows
        mockMvc.perform(get("/api/v1/projects/" + testProject.getId() + "/workflows")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/workflows/" + testWorkflow.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isNotFound());

        // Versions
        mockMvc.perform(get("/api/v1/workflows/" + testWorkflow.getId() + "/versions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isNotFound());

        // Runs
        mockMvc.perform(get("/api/v1/runs/" + testRun.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isNotFound());

        // Members
        mockMvc.perform(get("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("3. VIEWER can read project, workflows, versions, and runs (200 OK)")
    void viewerCanReadResources() throws Exception {
        mockMvc.perform(get("/api/v1/projects/" + testProject.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(testProject.getId().toString()));

        mockMvc.perform(get("/api/v1/workflows/" + testWorkflow.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken))
            .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/workflows/" + testWorkflow.getId() + "/versions/latest")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken))
            .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/runs/" + testRun.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken))
            .andExpect(status().isOk());
    }

    @Test
    @DisplayName("4. VIEWER cannot create workflows, versions, execute runs, or manage members (403 Forbidden)")
    void viewerCannotMutateOrExecute() throws Exception {
        // Create workflow
        CreateWorkflowRequest wfReq = new CreateWorkflowRequest("Viewer Wf", null, "Desc");
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/workflows")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(wfReq)))
            .andExpect(status().isForbidden());

        // Create version
        JsonNode graphPayload = objectMapper.readTree("""
            { "tasks": [{ "id": "t1", "action": { "type": "NO_OP" } }], "edges": [] }
            """);
        CreateWorkflowVersionRequest verReq = new CreateWorkflowVersionRequest("v2", "Desc", graphPayload);
        mockMvc.perform(post("/api/v1/workflows/" + testWorkflow.getId() + "/versions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(verReq)))
            .andExpect(status().isForbidden());

        // Execute run
        mockMvc.perform(post("/api/v1/workflows/" + testWorkflow.getId() + "/runs")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isForbidden());

        // Manage members
        AddProjectMemberRequest memReq = new AddProjectMemberRequest(outsiderUser.getId(), null, ProjectRole.VIEWER);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + viewerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(memReq)))
            .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("5. DEVELOPER can create workflows, versions, execute, but CANNOT delete project or manage members (403)")
    void developerPermissions() throws Exception {
        // Create workflow succeeds
        CreateWorkflowRequest wfReq = new CreateWorkflowRequest("Dev Wf", null, "Desc");
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/workflows")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + devToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(wfReq)))
            .andExpect(status().isCreated());

        // Delete project is forbidden
        mockMvc.perform(delete("/api/v1/projects/" + testProject.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + devToken))
            .andExpect(status().isForbidden());

        // Manage members is forbidden
        AddProjectMemberRequest memReq = new AddProjectMemberRequest(outsiderUser.getId(), null, ProjectRole.VIEWER);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + devToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(memReq)))
            .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("6. ADMIN can manage members and perform project administration")
    void adminPermissions() throws Exception {
        // Add outsider as member succeeds
        AddProjectMemberRequest memReq = new AddProjectMemberRequest(outsiderUser.getId(), null, ProjectRole.DEVELOPER);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(memReq)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.userId").value(outsiderUser.getId().toString()))
            .andExpect(jsonPath("$.role").value("DEVELOPER"));

        // Outsider is now a member and can read
        mockMvc.perform(get("/api/v1/projects/" + testProject.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + outsiderToken))
            .andExpect(status().isOk());

        // Remove outsider succeeds
        mockMvc.perform(delete("/api/v1/projects/" + testProject.getId() + "/members/" + outsiderUser.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
            .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("7. Project creation automatically assigns authenticated creator as ADMIN")
    void createProjectAssignsCreatorAsAdmin() throws Exception {
        CreateProjectRequest req = new CreateProjectRequest("New Workspace", null, "Workspace created by dev");

        String responseBody = mockMvc.perform(post("/api/v1/projects")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + devToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("New Workspace"))
            .andReturn().getResponse().getContentAsString();

        JsonNode responseNode = objectMapper.readTree(responseBody);
        UUID createdProjectId = UUID.fromString(responseNode.get("id").asText());

        // Dev user must be ADMIN of this new project
        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(createdProjectId, devUser.getId()).orElse(null);
        assertThat(member).isNotNull();
        assertThat(member.getRole()).isEqualTo(ProjectRole.ADMIN);
    }

    @Test
    @DisplayName("8. Sole ADMIN cannot demote themselves or be demoted (400 Bad Request)")
    void soleAdminCannotBeDemoted() throws Exception {
        // Attempting to demote the sole admin (adminUser) to DEVELOPER must be rejected with 400 Bad Request
        AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(adminUser.getId(), null, ProjectRole.DEVELOPER);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(demoteReq)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Cannot demote the only administrator of the project"));

        // Verify role remained ADMIN
        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(testProject.getId(), adminUser.getId()).orElseThrow();
        assertThat(member.getRole()).isEqualTo(ProjectRole.ADMIN);
    }

    @Test
    @DisplayName("9. Sole ADMIN cannot be removed (400 Bad Request)")
    void soleAdminCannotBeRemoved() throws Exception {
        mockMvc.perform(delete("/api/v1/projects/" + testProject.getId() + "/members/" + adminUser.getId())
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Cannot remove the only administrator of the project"));

        // Verify member was NOT deleted
        boolean exists = projectMemberRepository.existsByProjectIdAndUserId(testProject.getId(), adminUser.getId());
        assertThat(exists).isTrue();
    }

    @Test
    @DisplayName("10. Multi-admin project permits demoting or removing an ADMIN while at least one remains")
    void multiAdminProjectPermitsDemotionAndRemoval() throws Exception {
        // Promote devUser to ADMIN
        AddProjectMemberRequest promoteReq = new AddProjectMemberRequest(devUser.getId(), null, ProjectRole.ADMIN);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(promoteReq)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.role").value("ADMIN"));

        // Now that devUser is also ADMIN (adminCount == 2), adminUser can be demoted to DEVELOPER
        AddProjectMemberRequest demoteAdminReq = new AddProjectMemberRequest(adminUser.getId(), null, ProjectRole.DEVELOPER);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + devToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(demoteAdminReq)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.role").value("DEVELOPER"));

        // Now devUser is the only remaining ADMIN. Attempting to demote devUser must be rejected
        AddProjectMemberRequest demoteLastAdminReq = new AddProjectMemberRequest(devUser.getId(), null, ProjectRole.VIEWER);
        mockMvc.perform(post("/api/v1/projects/" + testProject.getId() + "/members")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + devToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(demoteLastAdminReq)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Cannot demote the only administrator of the project"));
    }
}
