package com.flowforge.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

class PasswordEncoderConfigTest {

    private PasswordEncoder passwordEncoder;

    @BeforeEach
    void setUp() {
        PasswordEncoderConfig config = new PasswordEncoderConfig();
        passwordEncoder = config.passwordEncoder();
    }

    @Test
    @DisplayName("passwordEncoder bean is an instance of BCryptPasswordEncoder")
    void passwordEncoderIsBCryptPasswordEncoder() {
        assertThat(passwordEncoder).isInstanceOf(BCryptPasswordEncoder.class);
    }

    @Test
    @DisplayName("Encoded password uses BCrypt with strength 12 ($2a$12$ prefix) and is 60 characters long")
    void passwordEncoderUsesStrength12() {
        String rawPassword = "SuperSecretPassword123!";
        String encoded = passwordEncoder.encode(rawPassword);

        assertThat(encoded).isNotEmpty();
        assertThat(encoded).hasSize(60);
        assertThat(encoded).startsWith("$2a$12$");
        assertThat(encoded).isNotEqualTo(rawPassword);
    }

    @Test
    @DisplayName("Subsequent encodings of the same password produce distinct salted hashes")
    void distinctSaltPerEncoding() {
        String rawPassword = "ConsistentPassword456!";
        String hash1 = passwordEncoder.encode(rawPassword);
        String hash2 = passwordEncoder.encode(rawPassword);

        assertThat(hash1).isNotEqualTo(hash2);
        assertThat(passwordEncoder.matches(rawPassword, hash1)).isTrue();
        assertThat(passwordEncoder.matches(rawPassword, hash2)).isTrue();
    }

    @Test
    @DisplayName("passwordEncoder matches correctly validates valid and invalid passwords")
    void passwordMatchesVerification() {
        String rawPassword = "ValidPassword789#";
        String encoded = passwordEncoder.encode(rawPassword);

        assertThat(passwordEncoder.matches(rawPassword, encoded)).isTrue();
        assertThat(passwordEncoder.matches("WrongPassword", encoded)).isFalse();
        assertThat(passwordEncoder.matches("", encoded)).isFalse();
    }
}
