package com.flowforge.service;

import com.flowforge.api.dto.AuthResponse;
import com.flowforge.api.dto.LoginRequest;
import com.flowforge.api.dto.RegisterRequest;
import com.flowforge.api.dto.UserResponse;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Service managing user registration, authentication, and credential verification.
 * Enforces email normalization, BCrypt password hashing, and generic failure messages.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.userRepository = Objects.requireNonNull(userRepository, "UserRepository must not be null");
        this.passwordEncoder = Objects.requireNonNull(passwordEncoder, "PasswordEncoder must not be null");
        this.jwtService = Objects.requireNonNull(jwtService, "JwtService must not be null");
    }

    /**
     * Registers a new user with normalized email and BCrypt-hashed password.
     */
    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String normalizedEmail = User.normalizeEmail(request.email());

        if (userRepository.existsByEmailIgnoreCase(normalizedEmail)) {
            throw new ResourceConflictException("User with email '" + normalizedEmail + "' already exists");
        }

        String passwordHash = passwordEncoder.encode(request.password());
        User user = new User(normalizedEmail, passwordHash, request.fullName());
        User savedUser = userRepository.save(user);

        log.info("User registered successfully: userId={}", savedUser.getId());
        String token = jwtService.generateToken(savedUser);
        return new AuthResponse(token, UserResponse.fromUser(savedUser));
    }

    /**
     * Authenticates user credentials and issues a JWT bearer token.
     * Throws BadCredentialsException with generic message to prevent account enumeration.
     */
    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        String normalizedEmail = User.normalizeEmail(request.email());
        User user = userRepository.findByEmailIgnoreCase(normalizedEmail).orElse(null);

        if (user == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            log.warn("Authentication failed for email={}", normalizedEmail);
            throw new BadCredentialsException("Invalid email or password");
        }

        if (!user.isActive()) {
            log.warn("Login attempt for deactivated user: userId={}", user.getId());
            throw new DisabledException("User account is disabled");
        }

        log.info("User logged in successfully: userId={}", user.getId());
        String token = jwtService.generateToken(user);
        return new AuthResponse(token, UserResponse.fromUser(user));
    }

    /**
     * Fetches safe profile of current authenticated user.
     */
    @Transactional(readOnly = true)
    public UserResponse getCurrentUser(UUID userId) {
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("User not found: " + userId));
        return UserResponse.fromUser(user);
    }
}
