package com.flowforge.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.api.dto.ApiErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Instant;
import java.util.Collections;

/**
 * Custom authentication entry point returning a standardized 401 Unauthorized JSON error envelope.
 */
@Component
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    public RestAuthenticationEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authException)
            throws IOException {
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);

        ApiErrorResponse errorResponse = new ApiErrorResponse(
            HttpServletResponse.SC_UNAUTHORIZED,
            "Unauthorized",
            "Authentication required to access this resource",
            Instant.now(),
            Collections.emptyList()
        );

        objectMapper.writeValue(response.getOutputStream(), errorResponse);
    }
}
