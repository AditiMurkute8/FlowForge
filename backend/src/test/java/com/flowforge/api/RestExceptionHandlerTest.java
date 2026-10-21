package com.flowforge.api;

import com.flowforge.api.dto.ApiErrorResponse;
import com.flowforge.service.exception.WorkflowCapacityExhaustedException;
import com.flowforge.service.exception.WorkflowExecutionTimeoutException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Focused tests for RestExceptionHandler verifying exception mappings, status codes,
 * response headers (e.g. Retry-After), and standardized ApiErrorResponse envelope.
 */
class RestExceptionHandlerTest {

    private MockMvc mockMvc;
    private final RestExceptionHandler handler = new RestExceptionHandler();

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new TestController())
                .setControllerAdvice(handler)
                .build();
    }

    @Test
    @DisplayName("1. Direct unit test: WorkflowCapacityExhaustedException maps to 429 with Retry-After: 5")
    void directUnit_capacityExhausted() {
        String msg = "Server capacity exhausted (max 2 workflows)";
        WorkflowCapacityExhaustedException ex = new WorkflowCapacityExhaustedException(msg);

        ResponseEntity<ApiErrorResponse> response = handler.handleCapacityExhausted(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("5");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(429);
        assertThat(response.getBody().error()).isEqualTo("Too Many Requests");
        assertThat(response.getBody().message()).isEqualTo(msg);
        assertThat(response.getBody().timestamp()).isNotNull();
        assertThat(response.getBody().details()).isEmpty();
    }

    @Test
    @DisplayName("2. Direct unit test: WorkflowExecutionTimeoutException maps to 504 Gateway Timeout")
    void directUnit_executionTimeout() {
        String msg = "Execution exceeded 30 seconds limit";
        WorkflowExecutionTimeoutException ex = new WorkflowExecutionTimeoutException(msg);

        ResponseEntity<ApiErrorResponse> response = handler.handleExecutionTimeout(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
        assertThat(response.getHeaders().containsKey("Retry-After")).isFalse();
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(504);
        assertThat(response.getBody().error()).isEqualTo("Gateway Timeout");
        assertThat(response.getBody().message()).isEqualTo(msg);
        assertThat(response.getBody().timestamp()).isNotNull();
        assertThat(response.getBody().details()).isEmpty();
    }

    @Test
    @DisplayName("3. Spring MVC integration: 429 response contains Retry-After: 5 and ApiErrorResponse JSON")
    void webMvc_capacityExhaustedReturns429WithHeader() throws Exception {
        mockMvc.perform(get("/test/capacity-exhausted").accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().string("Retry-After", "5"))
            .andExpect(jsonPath("$.status").value(429))
            .andExpect(jsonPath("$.error").value("Too Many Requests"))
            .andExpect(jsonPath("$.message").value("Simulated capacity exhaustion"))
            .andExpect(jsonPath("$.timestamp").isNotEmpty())
            .andExpect(jsonPath("$.details").isArray())
            .andExpect(jsonPath("$.details").isEmpty());
    }

    @Test
    @DisplayName("4. Spring MVC integration: 504 response contains Gateway Timeout and ApiErrorResponse JSON")
    void webMvc_timeoutReturns504() throws Exception {
        mockMvc.perform(get("/test/timeout").accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isGatewayTimeout())
            .andExpect(header().doesNotExist("Retry-After"))
            .andExpect(jsonPath("$.status").value(504))
            .andExpect(jsonPath("$.error").value("Gateway Timeout"))
            .andExpect(jsonPath("$.message").value("Simulated execution timeout"))
            .andExpect(jsonPath("$.timestamp").isNotEmpty())
            .andExpect(jsonPath("$.details").isArray())
            .andExpect(jsonPath("$.details").isEmpty());
    }

    @RestController
    static class TestController {
        @GetMapping("/test/capacity-exhausted")
        public void throwCapacityExhausted() {
            throw new WorkflowCapacityExhaustedException("Simulated capacity exhaustion");
        }

        @GetMapping("/test/timeout")
        public void throwTimeout() {
            throw new WorkflowExecutionTimeoutException("Simulated execution timeout");
        }
    }
}
