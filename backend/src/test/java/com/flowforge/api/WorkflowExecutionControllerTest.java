package com.flowforge.api;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
class WorkflowExecutionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("1. Linear workflow (A -> B -> C) completes with 200 OK and COMPLETED states")
    void linearWorkflowExecution() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "A", "action": { "type": "NO_OP" } },
                { "id": "B", "action": { "type": "NO_OP" } },
                { "id": "C", "action": { "type": "NO_OP" } }
              ],
              "edges": [
                { "source": "A", "target": "B" },
                { "source": "B", "target": "C" }
              ],
              "concurrency": 2
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.A.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.A.attemptCount").value(1))
            .andExpect(jsonPath("$.taskResults.B.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.C.state").value("COMPLETED"))
            .andExpect(jsonPath("$.durationMs").isNumber());
    }

    @Test
    @DisplayName("2. Independent parallel tasks execute and all reach COMPLETED")
    void independentTasksExecution() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "task-1", "action": { "type": "DELAY", "delayMs": 20 } },
                { "id": "task-2", "action": { "type": "DELAY", "delayMs": 20 } }
              ],
              "edges": [],
              "concurrency": 4
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.task-1.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.task-2.state").value("COMPLETED"));
    }

    @Test
    @DisplayName("3. Cyclic DAG is rejected with 400 Bad Request before any task execution")
    void cyclicDagRejected() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "task-1", "action": { "type": "NO_OP" } },
                { "id": "task-2", "action": { "type": "NO_OP" } }
              ],
              "edges": [
                { "source": "task-1", "target": "task-2" },
                { "source": "task-2", "target": "task-1" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.message", containsString("Cannot schedule invalid DAG")))
            .andExpect(jsonPath("$.details", not(empty())));
    }

    @Test
    @DisplayName("4. Unknown action type in task is rejected with 400 Bad Request")
    void unknownActionTypeRejected() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "task-1", "action": { "type": "UNSUPPORTED_ACTION" } }
              ],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    @DisplayName("5. Fail-fast cancellation cascades to dependent tasks on task failure")
    void failFastCancellationOnFailure() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "A", "action": { "type": "FAIL", "errorMessage": "Immediate failure in A" } },
                { "id": "B", "action": { "type": "NO_OP" } }
              ],
              "edges": [
                { "source": "A", "target": "B" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("FAILED"))
            .andExpect(jsonPath("$.taskResults.A.state").value("FAILED"))
            .andExpect(jsonPath("$.taskResults.A.errorMessage").value("Immediate failure in A"))
            .andExpect(jsonPath("$.taskResults.B.state").value("CANCELLED"));
    }

    @Test
    @DisplayName("6. Deterministic retry with FAIL_UNTIL_ATTEMPT recovers on configured attempt")
    void retryRecovery() throws Exception {
        String payload = """
            {
              "tasks": [
                {
                  "id": "transient-task",
                  "action": {
                    "type": "FAIL_UNTIL_ATTEMPT",
                    "failUntilAttempt": 2,
                    "errorMessage": "Transient glitch on attempt 1"
                  },
                  "retryPolicy": {
                    "maxAttempts": 3,
                    "backoffStrategy": "FIXED",
                    "initialDelayMs": 10
                  }
                }
              ],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.transient-task.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults.transient-task.attemptCount").value(2))
            .andExpect(jsonPath("$.taskResults.transient-task.attemptErrors", hasSize(1)))
            .andExpect(jsonPath("$.taskResults.transient-task.attemptErrors[0]").value("Transient glitch on attempt 1"));
    }

    @Test
    @DisplayName("7. Retry exhaustion marks task and workflow FAILED after max attempts")
    void retryExhaustion() throws Exception {
        String payload = """
            {
              "tasks": [
                {
                  "id": "stubborn-task",
                  "action": {
                    "type": "FAIL_UNTIL_ATTEMPT",
                    "failUntilAttempt": 5,
                    "errorMessage": "Persistent error"
                  },
                  "retryPolicy": {
                    "maxAttempts": 3,
                    "backoffStrategy": "FIXED",
                    "initialDelayMs": 10
                  }
                }
              ],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("FAILED"))
            .andExpect(jsonPath("$.taskResults.stubborn-task.state").value("FAILED"))
            .andExpect(jsonPath("$.taskResults.stubborn-task.attemptCount").value(3))
            .andExpect(jsonPath("$.taskResults.stubborn-task.errorMessage").value("Persistent error"))
            .andExpect(jsonPath("$.taskResults.stubborn-task.attemptErrors", hasSize(3)));
    }

    @Test
    @DisplayName("8. Invalid retry policy (maxAttempts < 1) rejected with 400 Bad Request")
    void invalidRetryPolicyRejected() throws Exception {
        String payload = """
            {
              "tasks": [
                {
                  "id": "task-bad-retry",
                  "action": { "type": "NO_OP" },
                  "retryPolicy": {
                    "maxAttempts": 0
                  }
                }
              ],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message", containsString("maxAttempts must be between 1 and 5")));
    }

    @Test
    @DisplayName("9. Empty workflow executes with 200 OK and COMPLETED state")
    void emptyWorkflowExecution() throws Exception {
        String payload = """
            {
              "tasks": [],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("COMPLETED"))
            .andExpect(jsonPath("$.taskResults").isEmpty());
    }

    @Test
    @DisplayName("10. Task error message exceeding 255 chars in payload is rejected with 400 Bad Request")
    void taskErrorMessageLengthExceededRejected() throws Exception {
        String longError = "E".repeat(300);
        String payload = String.format("""
            {
              "tasks": [
                { "id": "A", "action": { "type": "FAIL", "errorMessage": "%s" } }
              ],
              "edges": []
            }
            """, longError);

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message", containsString("errorMessage must not exceed 255 characters")));
    }

    @Test
    @DisplayName("11. Out-of-bounds concurrency parameter is clamped cleanly")
    void concurrencyClampedCleanly() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "task-1", "action": { "type": "NO_OP" } }
              ],
              "edges": [],
              "concurrency": -10
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("COMPLETED"));
    }

    @Test
    @DisplayName("12. Malformed JSON payload returns 400 Bad Request with standardized error envelope")
    void malformedJsonPayloadReturns400() throws Exception {
        String malformedJson = "{ tasks: [ unquoted_val }";

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(malformedJson))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.message").value("Malformed JSON request payload"));
    }

    @Test
    @DisplayName("13. Task count limit (>50) rejected with 400 Bad Request")
    void taskCountLimitExceeded() throws Exception {
        StringBuilder sb = new StringBuilder("{\"tasks\": [");
        for (int i = 0; i <= 50; i++) {
            if (i > 0) sb.append(",");
            sb.append(String.format("{\"id\": \"t%d\", \"action\": {\"type\": \"NO_OP\"}}", i));
        }
        sb.append("], \"edges\": []}");

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sb.toString()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message", containsString("Task count exceeds limit of 50")));
    }

    @Test
    @DisplayName("14. Duplicate task ID rejected with 400 Bad Request")
    void duplicateTaskIdRejected() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "dup", "action": { "type": "NO_OP" } },
                { "id": "dup", "action": { "type": "NO_OP" } }
              ],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message", containsString("Duplicate task ID detected")));
    }

    @Test
    @DisplayName("15. Edge referencing unknown task rejected with 400 Bad Request")
    void edgeReferencingUnknownTaskRejected() throws Exception {
        String payload = """
            {
              "tasks": [
                { "id": "task-1", "action": { "type": "NO_OP" } }
              ],
              "edges": [
                { "source": "task-1", "target": "ghost-task" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/workflows/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message", containsString("Edge references unknown task")));
    }
}
