package com.flowforge.api;

import com.flowforge.api.dto.AuthResponse;
import com.flowforge.api.dto.LoginRequest;
import com.flowforge.api.dto.RegisterRequest;
import com.flowforge.api.dto.UserResponse;
import com.flowforge.domain.User;
import com.flowforge.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.Objects;

/**
 * Controller exposing user registration, login, and current-user profile endpoints.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = Objects.requireNonNull(authService, "AuthService must not be null");
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        AuthResponse response = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        AuthResponse response = authService.login(request);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getCurrentUser(
            jakarta.servlet.http.HttpServletRequest request,
            Authentication authentication) {
        if (authentication == null) {
            authentication = SecurityContextHolder.getContext().getAuthentication();
        }
        if (authentication == null && request.getSession(false) != null) {
            Object secCtx = request.getSession(false).getAttribute("SPRING_SECURITY_CONTEXT");
            if (secCtx instanceof org.springframework.security.core.context.SecurityContext sc) {
                authentication = sc.getAuthentication();
            }
        }
        if (authentication == null || !(authentication.getPrincipal() instanceof User user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        UserResponse response = authService.getCurrentUser(user.getId());
        return ResponseEntity.ok(response);
    }
}
