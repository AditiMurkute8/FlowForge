package com.flowforge.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class UserTest {

    @Test
    @DisplayName("Email is automatically trimmed and converted to lowercase")
    void emailNormalization() {
        User user = new User();
        user.setEmail("  Admin.User@FlowForge.IO  ");

        assertThat(user.getEmail()).isEqualTo("admin.user@flowforge.io");
    }

    @Test
    @DisplayName("Email normalization handles null gracefully")
    void nullEmailNormalization() {
        User user = new User();
        user.setEmail(null);

        assertThat(user.getEmail()).isNull();
    }

    @Test
    @DisplayName("Parameterized constructor normalizes email and defaults active to true")
    void constructorInitializesDefaults() {
        User user = new User("  Dev@Company.ORG  ", "$2a$12$somehashedpasswordstring");

        assertThat(user.getEmail()).isEqualTo("dev@company.org");
        assertThat(user.getPasswordHash()).isEqualTo("$2a$12$somehashedpasswordstring");
        assertThat(user.isActive()).isTrue();
    }

    @Test
    @DisplayName("PrePersist and PreUpdate populate timestamps correctly")
    void lifecycleTimestamps() {
        User user = new User();
        user.onCreate();

        assertThat(user.getCreatedAt()).isNotNull();
        assertThat(user.getUpdatedAt()).isNotNull();

        Instant initialUpdate = user.getUpdatedAt();
        user.onUpdate();

        assertThat(user.getUpdatedAt()).isAfterOrEqualTo(initialUpdate);
    }

    @Test
    @DisplayName("Equals and HashCode are based on entity ID when present")
    void equalsAndHashCode() {
        UUID id = UUID.randomUUID();
        User u1 = new User();
        u1.setId(id);
        u1.setEmail("user1@example.com");

        User u2 = new User();
        u2.setId(id);
        u2.setEmail("user2@example.com");

        assertThat(u1).isEqualTo(u2);
        assertThat(u1.hashCode()).isEqualTo(u2.hashCode());

        User unpersisted1 = new User();
        User unpersisted2 = new User();
        assertThat(unpersisted1).isNotEqualTo(unpersisted2);
        assertThat(unpersisted1).isEqualTo(unpersisted1);
    }
}
