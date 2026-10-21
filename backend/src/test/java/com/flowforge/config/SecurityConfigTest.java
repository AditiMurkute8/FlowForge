package com.flowforge.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.service.JwtService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import com.flowforge.service.ProjectService;
import org.springframework.data.domain.Page;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class SecurityConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private ProjectService projectService;

    @Test
    @DisplayName("1. Public endpoint /api/v1/dag/validate is accessible without authentication")
    void publicDagValidateEndpointAccessible() throws Exception {
        String payload = """
            {
              "taskIds": ["task-1"],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(true));
    }

    @Test
    @DisplayName("2. Protected endpoint /api/v1/projects returns 401 Unauthorized when unauthenticated")
    void protectedEndpointRequiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/projects"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.status").value(401))
            .andExpect(jsonPath("$.error").value("Unauthorized"))
            .andExpect(jsonPath("$.message").value("Authentication required to access this resource"));
    }

    @Test
    @DisplayName("3. Protected endpoint /api/v1/workflow/execute returns 401 Unauthorized without token")
    void transientExecutionEndpointProtected() throws Exception {
        String payload = """
            {
              "tasks": [{ "id": "t1", "action": { "type": "NO_OP" } }],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflow/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("4. Protected endpoint with invalid or malformed token returns 401 Unauthorized")
    void protectedEndpointWithInvalidTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/v1/projects")
                .header(HttpHeaders.AUTHORIZATION, "Bearer invalid.malformed.token"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("5. Protected endpoint with valid Bearer token for active user succeeds")
    void protectedEndpointWithValidBearerTokenSucceeds() throws Exception {
        UUID userId = UUID.randomUUID();
        User user = new User(userId, "active.test.user@flowforge.io", "$2a$12$somehashforexample12345678901234567890123456789012", "Active User", true);

        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(projectService.listProjects(any())).thenReturn(Page.empty());

        String token = jwtService.generateToken(user);

        mockMvc.perform(get("/api/v1/projects")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
            .andExpect(status().isOk());
    }

    @Test
    @DisplayName("6. Preflight OPTIONS request from allowed origin returns 200 OK and CORS headers")
    void preflightAllowedOriginSucceedsWithCorsHeaders() throws Exception {
        mockMvc.perform(options("/api/v1/projects")
                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Authorization, Content-Type"))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173"));
    }

    @Test
    @DisplayName("7. Preflight OPTIONS request from unauthorized origin returns 403 Forbidden")
    void preflightUnauthorizedOriginForbidden() throws Exception {
        mockMvc.perform(options("/api/v1/projects")
                .header(HttpHeaders.ORIGIN, "http://malicious-origin.com")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
            .andExpect(status().isForbidden());
    }
}
