package com.flowforge.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
class WebCorsConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("1. Preflight OPTIONS request from allowed origin http://localhost:5173 succeeds with CORS headers")
    void preflightAllowedOriginSucceeds() throws Exception {
        mockMvc.perform(options("/api/v1/dag/validate")
                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type"))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173"))
            .andExpect(header().exists(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS));
    }

    @Test
    @DisplayName("2. Preflight OPTIONS request from unauthorized origin returns 403 Forbidden")
    void preflightUnauthorizedOriginForbidden() throws Exception {
        mockMvc.perform(options("/api/v1/dag/validate")
                .header(HttpHeaders.ORIGIN, "http://malicious-site.com")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
            .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("3. Actual request from allowed origin returns Access-Control-Allow-Origin header")
    void actualRequestAllowedOriginIncludesHeader() throws Exception {
        String payload = """
            {
              "taskIds": ["task-1"],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173"));
    }

    @Test
    @DisplayName("4. Actual request from unauthorized origin does not receive Access-Control-Allow-Origin header")
    void actualRequestUnauthorizedOriginOmitsHeader() throws Exception {
        String payload = """
            {
              "taskIds": ["task-1"],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .header(HttpHeaders.ORIGIN, "http://malicious-site.com")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }
}
