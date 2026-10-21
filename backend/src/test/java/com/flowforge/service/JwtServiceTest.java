package com.flowforge.service;

import com.flowforge.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    private static final String VALID_SECRET = "secure-test-signing-secret-key-at-least-256-bits-long!";

    @Test
    @DisplayName("generateToken issues valid JWT with subject UUID and email claim")
    void generateAndExtractClaims() {
        JwtService jwtService = new JwtService(VALID_SECRET, 3600000L);
        UUID userId = UUID.randomUUID();
        User user = new User(userId, "dev@flowforge.io", "hash", "Dev User", true);

        String token = jwtService.generateToken(user);
        assertThat(token).isNotEmpty();

        Optional<UUID> extractedId = jwtService.extractUserId(token);
        assertThat(extractedId).isPresent().contains(userId);

        Optional<String> extractedEmail = jwtService.extractEmail(token);
        assertThat(extractedEmail).isPresent().contains("dev@flowforge.io");

        assertThat(jwtService.isTokenValid(token, user)).isTrue();
    }

    @Test
    @DisplayName("Initialization fails if secret is missing or shorter than 32 characters (256 bits)")
    void invalidSecretFailsInitialization() {
        assertThatThrownBy(() -> new JwtService("", 3600000L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("minimum length of 32 characters");

        assertThatThrownBy(() -> new JwtService("short-secret-under-32-chars", 3600000L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("minimum length of 32 characters");

        assertThatThrownBy(() -> new JwtService(null, 3600000L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("minimum length of 32 characters");
    }

    @Test
    @DisplayName("Expired token is rejected and returns Optional.empty()")
    void expiredTokenRejected() {
        // Expiration of -1000ms ensures token is already expired upon generation
        JwtService expiredService = new JwtService(VALID_SECRET, -1000L);
        UUID userId = UUID.randomUUID();
        User user = new User(userId, "expired@flowforge.io", "hash", "Expired User", true);

        String token = expiredService.generateToken(user);
        Optional<UUID> extractedId = expiredService.extractUserId(token);

        assertThat(extractedId).isEmpty();
        assertThat(expiredService.isTokenValid(token, user)).isFalse();
    }

    @Test
    @DisplayName("Tampered token or token signed with different key returns Optional.empty()")
    void invalidSignatureRejected() {
        JwtService service1 = new JwtService(VALID_SECRET, 3600000L);
        JwtService service2 = new JwtService("different-secret-key-that-is-also-at-least-32-chars!", 3600000L);

        UUID userId = UUID.randomUUID();
        User user = new User(userId, "tampered@flowforge.io", "hash", "Tampered User", true);

        String token = service1.generateToken(user);
        Optional<UUID> verifiedByService2 = service2.extractUserId(token);

        assertThat(verifiedByService2).isEmpty();

        // Tampered payload
        String tamperedToken = token.substring(0, token.length() - 5) + "abcde";
        assertThat(service1.extractUserId(tamperedToken)).isEmpty();
    }

    @Test
    @DisplayName("Malformed, blank, or null token returns Optional.empty()")
    void malformedTokenHandling() {
        JwtService jwtService = new JwtService(VALID_SECRET, 3600000L);

        assertThat(jwtService.extractUserId(null)).isEmpty();
        assertThat(jwtService.extractUserId("")).isEmpty();
        assertThat(jwtService.extractUserId("   ")).isEmpty();
        assertThat(jwtService.extractUserId("not.a.valid.jwt")).isEmpty();
    }

    @Test
    @DisplayName("isTokenValid returns false if user is deactivated or IDs mismatch")
    void isTokenValidChecksUserStatus() {
        JwtService jwtService = new JwtService(VALID_SECRET, 3600000L);
        UUID userId = UUID.randomUUID();
        User activeUser = new User(userId, "active@flowforge.io", "hash", "Active", true);
        User inactiveUser = new User(userId, "active@flowforge.io", "hash", "Active", false);
        User differentUser = new User(UUID.randomUUID(), "other@flowforge.io", "hash", "Other", true);

        String token = jwtService.generateToken(activeUser);

        assertThat(jwtService.isTokenValid(token, activeUser)).isTrue();
        assertThat(jwtService.isTokenValid(token, inactiveUser)).isFalse();
        assertThat(jwtService.isTokenValid(token, differentUser)).isFalse();
    }
}
