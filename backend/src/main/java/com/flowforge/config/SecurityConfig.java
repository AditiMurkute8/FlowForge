package com.flowforge.config;

import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.service.JwtService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Spring Security configuration establishing stateless JWT authentication.
 * Protects project, workflow, execution, and run APIs while permitting authentication,
 * lightweight DAG validation, and preflight CORS requests.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final RestAuthenticationEntryPoint restAuthenticationEntryPoint;

    @Autowired(required = false)
    private JwtService jwtService;

    @Autowired(required = false)
    private UserRepository userRepository;

    public SecurityConfig(RestAuthenticationEntryPoint restAuthenticationEntryPoint) {
        this.restAuthenticationEntryPoint = restAuthenticationEntryPoint;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            // Stateless REST API using Bearer tokens is immune to CSRF because tokens are not attached by browsers automatically
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(ex -> ex.authenticationEntryPoint(restAuthenticationEntryPoint))
            .authorizeHttpRequests(auth -> auth
                // Allow CORS preflights
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                // Public auth endpoints
                .requestMatchers("/api/v1/auth/register", "/api/v1/auth/login").permitAll()
                // Public lightweight DAG validation (strictly rate/complexity-bounded to 50 nodes in controller)
                .requestMatchers("/api/v1/dag/validate").permitAll()
                // Actuator health endpoints
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                // Protected resource and execution endpoints
                .requestMatchers("/api/v1/auth/me").authenticated()
                .requestMatchers("/api/v1/projects/**").authenticated()
                .requestMatchers("/api/v1/workflows/**").authenticated()
                .requestMatchers("/api/v1/runs/**").authenticated()
                .requestMatchers("/api/v1/workflows/execute", "/api/v1/workflow/execute").authenticated()
                // Default: protect all other endpoints
                .anyRequest().authenticated()
            );

        if (jwtService != null && userRepository != null) {
            http.addFilterBefore(new JwtAuthenticationFilter(jwtService, userRepository), UsernamePasswordAuthenticationFilter.class);
        }

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of("http://localhost:5173"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"));
        config.setExposedHeaders(List.of("Authorization"));
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
