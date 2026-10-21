package com.flowforge.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Dedicated Spring configuration providing a BCrypt password encoder bean.
 * Uses a work factor of 12 to ensure strong resistance against brute-force attacks.
 */
@Configuration
public class PasswordEncoderConfig {

    public static final int BCRYPT_STRENGTH = 12;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(BCRYPT_STRENGTH);
    }
}
