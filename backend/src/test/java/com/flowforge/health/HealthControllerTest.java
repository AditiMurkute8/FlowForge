package com.flowforge.health;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(HealthController.class)
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("GET /api/health returns HTTP 200 OK and expected JSON payload")
    void healthEndpointReturnsOk() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/health")
                .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.service").value("flowforge-backend"))
                .andExpect(jsonPath("$.timestamp").isNotEmpty())
                .andReturn();

        String responseBody = result.getResponse().getContentAsString();
        String timestampString = JsonPath.read(responseBody, "$.timestamp");

        assertThatNoException().isThrownBy(() -> Instant.parse(timestampString));
        Instant parsed = Instant.parse(timestampString);
        assertThat(parsed).isNotNull();
    }

    @Test
    @DisplayName("Direct controller invocation returns valid HealthResponse")
    void directControllerInvocation() {
        HealthController controller = new HealthController();
        var response = controller.getHealth();

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo("UP");
        assertThat(response.getBody().service()).isEqualTo("flowforge-backend");
        assertThat(response.getBody().timestamp()).isNotNull();
    }
}
