package com.flowforge.api;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(DagValidationController.class)
class DagValidationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("1. Valid linear graph returns 200 OK with isValid: true and topological order")
    void validLinearGraph() throws Exception {
        String payload = """
            {
              "taskIds": ["task-1", "task-2", "task-3"],
              "edges": [
                { "source": "task-1", "target": "task-2" },
                { "source": "task-2", "target": "task-3" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(true))
            .andExpect(jsonPath("$.hasCycle").value(false))
            .andExpect(jsonPath("$.errors").isEmpty())
            .andExpect(jsonPath("$.topologicalOrder", contains("task-1", "task-2", "task-3")));
    }

    @Test
    @DisplayName("2. Valid diamond graph returns 200 OK with deterministic topological order")
    void validDiamondGraph() throws Exception {
        String payload = """
            {
              "taskIds": ["A", "B", "C", "D"],
              "edges": [
                { "source": "A", "target": "B" },
                { "source": "A", "target": "C" },
                { "source": "B", "target": "D" },
                { "source": "C", "target": "D" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(true))
            .andExpect(jsonPath("$.hasCycle").value(false))
            .andExpect(jsonPath("$.topologicalOrder", contains("A", "B", "C", "D")));
    }

    @Test
    @DisplayName("3. Cyclic graph returns 200 OK with isValid: false, hasCycle: true, and cycle nodes")
    void cyclicGraphDiagnostics() throws Exception {
        String payload = """
            {
              "taskIds": ["A", "B", "C"],
              "edges": [
                { "source": "A", "target": "B" },
                { "source": "B", "target": "C" },
                { "source": "C", "target": "A" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(false))
            .andExpect(jsonPath("$.hasCycle").value(true))
            .andExpect(jsonPath("$.cycleNodes", containsInAnyOrder("A", "B", "C")))
            .andExpect(jsonPath("$.errors", hasItem(containsString("Cyclic dependency"))))
            .andExpect(jsonPath("$.topologicalOrder").isEmpty());
    }

    @Test
    @DisplayName("4. Self-loop returns 200 OK with isValid: false and identifies self-looping task")
    void selfLoopDetected() throws Exception {
        String payload = """
            {
              "taskIds": ["A"],
              "edges": [
                { "source": "A", "target": "A" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(false))
            .andExpect(jsonPath("$.hasCycle").value(true))
            .andExpect(jsonPath("$.cycleNodes", contains("A")))
            .andExpect(jsonPath("$.errors", hasItem(containsString("Self-loop detected on task: A"))));
    }

    @Test
    @DisplayName("5. Edge referencing unknown task returns 200 OK with isValid: false")
    void edgeReferencesUnknownTask() throws Exception {
        String payload = """
            {
              "taskIds": ["A"],
              "edges": [
                { "source": "A", "target": "UNKNOWN" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(false))
            .andExpect(jsonPath("$.errors", hasItem(containsString("Edge references unknown task: A -> UNKNOWN"))));
    }

    @Test
    @DisplayName("6. Duplicate task IDs return 200 OK with isValid: false")
    void duplicateTaskIds() throws Exception {
        String payload = """
            {
              "taskIds": ["A", "A"],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(false))
            .andExpect(jsonPath("$.errors", hasItem(containsString("Duplicate task ID detected: A"))));
    }

    @Test
    @DisplayName("7. Empty graph returns 200 OK with isValid: true and warning")
    void emptyGraph() throws Exception {
        String payload = """
            {
              "taskIds": [],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(true))
            .andExpect(jsonPath("$.warnings", hasItem("Workflow contains no tasks.")))
            .andExpect(jsonPath("$.topologicalOrder").isEmpty());
    }

    @Test
    @DisplayName("8. Disconnected nodes identified with non-fatal warning")
    void disconnectedNodes() throws Exception {
        String payload = """
            {
              "taskIds": ["A", "B", "ISOLATED"],
              "edges": [
                { "source": "A", "target": "B" }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.isValid").value(true))
            .andExpect(jsonPath("$.disconnectedNodes", contains("ISOLATED")))
            .andExpect(jsonPath("$.warnings", hasItem(containsString("is isolated"))));
    }

    @Test
    @DisplayName("9. Null taskIds list returns 400 Bad Request with ApiErrorResponse")
    void nullTaskIdsRejected() throws Exception {
        String payload = """
            {
              "taskIds": null,
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message").value("taskIds list must not be null"));
    }

    @Test
    @DisplayName("10. Blank task ID returns 400 Bad Request")
    void blankTaskIdRejected() throws Exception {
        String payload = """
            {
              "taskIds": ["  "],
              "edges": []
            }
            """;

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message").value("Task ID must not be blank"));
    }

    @Test
    @DisplayName("11. Malformed JSON returns 400 Bad Request")
    void malformedJsonRejected() throws Exception {
        String payload = "{ malformed json string ";

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message").value("Malformed JSON request payload"));
    }

    @Test
    @DisplayName("12. Excessive task count (> 50) returns 400 Bad Request")
    void excessiveTaskCountRejected() throws Exception {
        StringBuilder sb = new StringBuilder("{\"taskIds\": [");
        for (int i = 0; i < 51; i++) {
            if (i > 0) sb.append(",");
            sb.append("\"task-").append(i).append("\"");
        }
        sb.append("], \"edges\": []}");

        mockMvc.perform(post("/api/v1/dag/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sb.toString()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message").value(containsString("Task count exceeds limit of 50")));
    }
}
