package com.flowforge.service;

import com.flowforge.domain.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for issuing and cryptographically verifying stateless JSON Web Tokens (JWT).
 * Enforces a minimum 256-bit (32 character) signing secret and rejects invalid or expired tokens.
 */
@Service
public class JwtService {

    private static final int MIN_SECRET_LENGTH = 32;

    @Value("${flowforge.jwt.secret:}")
    private String secret;

    @Value("${flowforge.jwt.expiration-ms:86400000}")
    private long expirationMs;

    private SecretKey signingKey;

    public JwtService() {
        // Default constructor for Spring injection
    }

    public JwtService(String secret, long expirationMs) {
        this.secret = secret;
        this.expirationMs = expirationMs;
        init();
    }

    @PostConstruct
    public void init() {
        if (secret == null || secret.trim().length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException(
                "Configured JWT secret is invalid or missing. A secure secret with a minimum length of "
                + MIN_SECRET_LENGTH + " characters (256 bits) must be provided via FLOWFORGE_JWT_SECRET."
            );
        }
        this.signingKey = Keys.hmacShaKeyFor(secret.trim().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Issues a signed JWT for the given active user.
     */
    public String generateToken(User user) {
        Objects.requireNonNull(user, "User must not be null");
        Objects.requireNonNull(user.getId(), "User ID must not be null");

        Date now = new Date();
        Date expiry = new Date(now.getTime() + expirationMs);

        return Jwts.builder()
            .subject(user.getId().toString())
            .claim("email", user.getEmail())
            .issuedAt(now)
            .expiration(expiry)
            .signWith(signingKey)
            .compact();
    }

    /**
     * Safely extracts and verifies the user ID from a signed token.
     * Returns Optional.empty() if the signature is invalid, token is expired, or subject is malformed.
     */
    public Optional<UUID> extractUserId(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            Claims claims = Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();

            String subject = claims.getSubject();
            if (subject == null || subject.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(UUID.fromString(subject));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /**
     * Extracts the email claim from the token if valid.
     */
    public Optional<String> extractEmail(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            Claims claims = Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();

            return Optional.ofNullable(claims.get("email", String.class));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /**
     * Validates whether a token belongs to the given user and is currently active.
     */
    public boolean isTokenValid(String token, User user) {
        if (user == null || !user.isActive()) {
            return false;
        }
        Optional<UUID> userIdOpt = extractUserId(token);
        return userIdOpt.isPresent() && userIdOpt.get().equals(user.getId());
    }
}
