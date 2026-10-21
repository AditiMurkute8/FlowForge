package com.flowforge.service;

import com.flowforge.api.dto.AuthResponse;
import com.flowforge.api.dto.LoginRequest;
import com.flowforge.api.dto.RegisterRequest;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.service.exception.ResourceConflictException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtService jwtService;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(userRepository, passwordEncoder, jwtService);
    }

    @Test
    @DisplayName("register creates user with normalized email, hashed password, and returns safe AuthResponse")
    void register_success() {
        RegisterRequest request = new RegisterRequest("  NewUser@FlowForge.IO  ", "StrongPass123!", "New User");

        when(userRepository.existsByEmailIgnoreCase("newuser@flowforge.io")).thenReturn(false);
        when(passwordEncoder.encode("StrongPass123!")).thenReturn("$2a$12$hashedPasswordExample");

        UUID generatedId = UUID.randomUUID();
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(generatedId);
            return user;
        });
        when(jwtService.generateToken(any(User.class))).thenReturn("jwt.token.string");

        AuthResponse response = authService.register(request);

        assertThat(response).isNotNull();
        assertThat(response.token()).isEqualTo("jwt.token.string");
        assertThat(response.user().id()).isEqualTo(generatedId);
        assertThat(response.user().email()).isEqualTo("newuser@flowforge.io");
        assertThat(response.user().fullName()).isEqualTo("New User");
        assertThat(response.user().active()).isTrue();

        verify(userRepository).save(argThat(user ->
            user.getEmail().equals("newuser@flowforge.io") &&
            user.getPasswordHash().equals("$2a$12$hashedPasswordExample")
        ));
    }

    @Test
    @DisplayName("register with existing email throws ResourceConflictException")
    void register_emailConflict() {
        RegisterRequest request = new RegisterRequest("existing@flowforge.io", "StrongPass123!", "Existing User");
        when(userRepository.existsByEmailIgnoreCase("existing@flowforge.io")).thenReturn(true);

        assertThatThrownBy(() -> authService.register(request))
            .isInstanceOf(ResourceConflictException.class)
            .hasMessageContaining("already exists");

        verify(userRepository, never()).save(any());
    }

    @Test
    @DisplayName("login with correct credentials returns valid AuthResponse")
    void login_success() {
        LoginRequest request = new LoginRequest("  User@FlowForge.io  ", "CorrectPass123!");
        UUID userId = UUID.randomUUID();
        User user = new User(userId, "user@flowforge.io", "$2a$12$storedHash", "Valid User", true);

        when(userRepository.findByEmailIgnoreCase("user@flowforge.io")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("CorrectPass123!", "$2a$12$storedHash")).thenReturn(true);
        when(jwtService.generateToken(user)).thenReturn("jwt.bearer.token");

        AuthResponse response = authService.login(request);

        assertThat(response).isNotNull();
        assertThat(response.token()).isEqualTo("jwt.bearer.token");
        assertThat(response.user().id()).isEqualTo(userId);
        assertThat(response.user().email()).isEqualTo("user@flowforge.io");
    }

    @Test
    @DisplayName("login with wrong password throws BadCredentialsException with generic message")
    void login_wrongPassword() {
        LoginRequest request = new LoginRequest("user@flowforge.io", "WrongPassword!");
        User user = new User(UUID.randomUUID(), "user@flowforge.io", "$2a$12$storedHash", "User", true);

        when(userRepository.findByEmailIgnoreCase("user@flowforge.io")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("WrongPassword!", "$2a$12$storedHash")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(request))
            .isInstanceOf(BadCredentialsException.class)
            .hasMessage("Invalid email or password");

        verify(jwtService, never()).generateToken(any());
    }

    @Test
    @DisplayName("login with non-existent email throws BadCredentialsException with generic message")
    void login_unknownEmail() {
        LoginRequest request = new LoginRequest("unknown@flowforge.io", "AnyPassword!");
        when(userRepository.findByEmailIgnoreCase("unknown@flowforge.io")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(request))
            .isInstanceOf(BadCredentialsException.class)
            .hasMessage("Invalid email or password");

        verify(jwtService, never()).generateToken(any());
    }

    @Test
    @DisplayName("login with deactivated user throws DisabledException")
    void login_deactivatedUser() {
        LoginRequest request = new LoginRequest("disabled@flowforge.io", "Password123!");
        User deactivatedUser = new User(UUID.randomUUID(), "disabled@flowforge.io", "$2a$12$storedHash", "Disabled", false);

        when(userRepository.findByEmailIgnoreCase("disabled@flowforge.io")).thenReturn(Optional.of(deactivatedUser));
        when(passwordEncoder.matches("Password123!", "$2a$12$storedHash")).thenReturn(true);

        assertThatThrownBy(() -> authService.login(request))
            .isInstanceOf(DisabledException.class)
            .hasMessage("User account is disabled");

        verify(jwtService, never()).generateToken(any());
    }
}
