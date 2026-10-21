package com.flowforge.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.AuthResponse;
import com.flowforge.api.dto.LoginRequest;
import com.flowforge.api.dto.RegisterRequest;
import com.flowforge.api.dto.UserResponse;
import com.flowforge.domain.User;
import com.flowforge.service.AuthService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AuthService authService;

    @Test
    @DisplayName("POST /api/v1/auth/register with valid payload returns 201 Created and AuthResponse")
    void register_validPayload_success() throws Exception {
        UUID userId = UUID.randomUUID();
        UserResponse userResponse = new UserResponse(userId, "user@flowforge.io", "Test User", true, Instant.now(), Instant.now());
        AuthResponse authResponse = new AuthResponse("mock.jwt.token", userResponse);

        when(authService.register(any(RegisterRequest.class))).thenReturn(authResponse);

        RegisterRequest request = new RegisterRequest("user@flowforge.io", "ValidPass123!", "Test User");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.token").value("mock.jwt.token"))
            .andExpect(jsonPath("$.user.id").value(userId.toString()))
            .andExpect(jsonPath("$.user.email").value("user@flowforge.io"))
            .andExpect(jsonPath("$.user.fullName").value("Test User"))
            .andExpect(jsonPath("$.user.password").doesNotExist())
            .andExpect(jsonPath("$.user.passwordHash").doesNotExist());
    }

    @Test
    @DisplayName("POST /api/v1/auth/register with invalid payload returns 400 Bad Request")
    void register_invalidPayload_validationError() throws Exception {
        RegisterRequest request = new RegisterRequest("not-an-email", "short", "");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    @DisplayName("POST /api/v1/auth/login with valid credentials returns 200 OK and AuthResponse")
    void login_validCredentials_success() throws Exception {
        UUID userId = UUID.randomUUID();
        UserResponse userResponse = new UserResponse(userId, "user@flowforge.io", "Test User", true, Instant.now(), Instant.now());
        AuthResponse authResponse = new AuthResponse("mock.jwt.token", userResponse);

        when(authService.login(any(LoginRequest.class))).thenReturn(authResponse);

        LoginRequest request = new LoginRequest("user@flowforge.io", "ValidPass123!");

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").value("mock.jwt.token"))
            .andExpect(jsonPath("$.user.id").value(userId.toString()))
            .andExpect(jsonPath("$.user.email").value("user@flowforge.io"));
    }

    @Test
    @DisplayName("POST /api/v1/auth/login with invalid credentials returns 401 Unauthorized")
    void login_badCredentials_returns401() throws Exception {
        when(authService.login(any(LoginRequest.class)))
            .thenThrow(new BadCredentialsException("Invalid email or password"));

        LoginRequest request = new LoginRequest("user@flowforge.io", "WrongPassword!");

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.status").value(401))
            .andExpect(jsonPath("$.message").value("Invalid email or password"));
    }

    @Test
    @DisplayName("GET /api/v1/auth/me returns 200 OK for authenticated user")
    void getCurrentUser_authenticated() throws Exception {
        UUID userId = UUID.randomUUID();
        User user = new User(userId, "auth@flowforge.io", "hash", "Auth User", true);
        UserResponse response = new UserResponse(userId, "auth@flowforge.io", "Auth User", true, Instant.now(), Instant.now());

        when(authService.getCurrentUser(userId)).thenReturn(response);

        UsernamePasswordAuthenticationToken authToken = new UsernamePasswordAuthenticationToken(
            user,
            null,
            List.of(new SimpleGrantedAuthority("ROLE_USER"))
        );

        mockMvc.perform(get("/api/v1/auth/me")
                .with(authentication(authToken)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(userId.toString()))
            .andExpect(jsonPath("$.email").value("auth@flowforge.io"));
    }
}
