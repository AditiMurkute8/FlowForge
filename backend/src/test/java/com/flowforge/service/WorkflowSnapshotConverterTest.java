package com.flowforge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WorkflowSnapshotConverterTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private WorkflowSnapshotConverter converter;

    @BeforeEach
    void setUp() {
        converter = new WorkflowSnapshotConverter();
    }

    @Test
    @DisplayName("Rejects null or non-object payloads with IllegalArgumentException")
    void testRejectsNullOrNonObjectPayload() {
        assertThatThrownBy(() -> converter.convertAndValidate(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("non-null JSON object");

        assertThatThrownBy(() -> converter.convertAndValidate(objectMapper.createArrayNode()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("non-null JSON object");
    }

    @Test
    @DisplayName("Rejects payload missing both 'nodes' and 'tasks'")
    void testRejectsMissingNodesAndTasks() {
        ObjectNode payload = objectMapper.createObjectNode();
        assertThatThrownBy(() -> converter.convertAndValidate(payload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Payload must contain a 'nodes' or 'tasks' array");
    }

    @Test
    @DisplayName("Rejects payload where 'nodes' is present but is not an array")
    void testRejectsNodesNotArray() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("nodes", "not-an-array");
        assertThatThrownBy(() -> converter.convertAndValidate(payload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'nodes' field must be a JSON array");

        ObjectNode payloadObj = objectMapper.createObjectNode();
        payloadObj.set("nodes", objectMapper.createObjectNode());
        assertThatThrownBy(() -> converter.convertAndValidate(payloadObj))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'nodes' field must be a JSON array");
    }

    @Test
    @DisplayName("Accepts legacy 'tasks' array only when 'nodes' is missing or null")
    void testAcceptsLegacyTasksWhenNodesMissing() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode tasks = payload.putArray("tasks");
        tasks.addObject().put("id", "legacy-1");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);
        assertThat(snapshot.taskCount()).isEqualTo(1);
        assertThat(snapshot.taskGraph().taskIds()).containsExactly("legacy-1");
    }

    @Test
    @DisplayName("Rejects payload where 'tasks' is present but is not an array when 'nodes' is missing")
    void testRejectsTasksNotArrayWhenNodesMissing() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("tasks", "invalid");
        assertThatThrownBy(() -> converter.convertAndValidate(payload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'tasks' field must be a JSON array");
    }

    @Test
    @DisplayName("Rejects payload exceeding maximum task or edge limits")
    void testRejectsLimitsExceeded() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        for (int i = 0; i < 51; i++) {
            nodes.addObject().put("id", "task-" + i);
        }

        assertThatThrownBy(() -> converter.convertAndValidate(payload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Workflow exceeds maximum limit of 50 tasks");

        ObjectNode payloadEdges = objectMapper.createObjectNode();
        ArrayNode okNodes = payloadEdges.putArray("nodes");
        okNodes.addObject().put("id", "t1");
        okNodes.addObject().put("id", "t2");
        ArrayNode edges = payloadEdges.putArray("edges");
        for (int i = 0; i < 101; i++) {
            edges.addObject().put("source", "t1").put("target", "t2");
        }

        assertThatThrownBy(() -> converter.convertAndValidate(payloadEdges))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Workflow exceeds maximum limit of 100 edges");
    }

    @Test
    @DisplayName("Rejects nodes with blank or missing ID, or duplicate IDs")
    void testRejectsMalformedNodeIds() {
        ObjectNode payloadMissing = objectMapper.createObjectNode();
        payloadMissing.putArray("nodes").addObject(); // no id
        assertThatThrownBy(() -> converter.convertAndValidate(payloadMissing))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing, null, or blank 'id'");

        ObjectNode payloadBlank = objectMapper.createObjectNode();
        payloadBlank.putArray("nodes").addObject().put("id", "   ");
        assertThatThrownBy(() -> converter.convertAndValidate(payloadBlank))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing, null, or blank 'id'");

        ObjectNode payloadDup = objectMapper.createObjectNode();
        ArrayNode dupNodes = payloadDup.putArray("nodes");
        dupNodes.addObject().put("id", "task-A");
        dupNodes.addObject().put("id", "task-A");
        assertThatThrownBy(() -> converter.convertAndValidate(payloadDup))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Duplicate task ID detected: task-A");
    }

    @Test
    @DisplayName("Rejects edges with missing or blank source or target, or non-array edges")
    void testRejectsMalformedEdges() {
        ObjectNode payloadEdgesNotArray = objectMapper.createObjectNode();
        payloadEdgesNotArray.putArray("nodes").addObject().put("id", "t1");
        payloadEdgesNotArray.put("edges", "not-array");
        assertThatThrownBy(() -> converter.convertAndValidate(payloadEdgesNotArray))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'edges' field must be a JSON array");

        ObjectNode payloadMissingSource = objectMapper.createObjectNode();
        payloadMissingSource.putArray("nodes").addObject().put("id", "t1");
        payloadMissingSource.putArray("edges").addObject().put("target", "t1");
        assertThatThrownBy(() -> converter.convertAndValidate(payloadMissingSource))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing, null, or blank 'source'");

        ObjectNode payloadBlankTarget = objectMapper.createObjectNode();
        payloadBlankTarget.putArray("nodes").addObject().put("id", "t1");
        payloadBlankTarget.putArray("edges").addObject().put("source", "t1").put("target", " ");
        assertThatThrownBy(() -> converter.convertAndValidate(payloadBlankTarget))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing, null, or blank 'target'");
    }

    @Test
    @DisplayName("Rejects parameter numeric bounds violations")
    void testRejectsNumericBoundsViolations() {
        // timeoutMs < 0
        ObjectNode p1 = objectMapper.createObjectNode();
        p1.putArray("nodes").addObject().put("id", "t1").putObject("data").put("timeoutMs", -1);
        assertThatThrownBy(() -> converter.convertAndValidate(p1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeoutMs must not be negative");

        // maxRetries > 4
        ObjectNode p2 = objectMapper.createObjectNode();
        p2.putArray("nodes").addObject().put("id", "t1").putObject("data").put("maxRetries", 5);
        assertThatThrownBy(() -> converter.convertAndValidate(p2))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxRetries must be between 0 and 4");

        // delayMs > 5000
        ObjectNode p3 = objectMapper.createObjectNode();
        p3.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("simulation").put("delayMs", 6000);
        assertThatThrownBy(() -> converter.convertAndValidate(p3))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("delayMs must be between 0 and 5000");

        // failUntilAttempt < 1
        ObjectNode p4 = objectMapper.createObjectNode();
        p4.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("simulation").put("failUntilAttempt", 0);
        assertThatThrownBy(() -> converter.convertAndValidate(p4))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("failUntilAttempt must be between 1 and 5");

        // initialDelayMs > 2000
        ObjectNode p5 = objectMapper.createObjectNode();
        p5.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("retry").put("initialDelayMs", 2500);
        assertThatThrownBy(() -> converter.convertAndValidate(p5))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("initialDelayMs must be between 0 and 2000");
    }

    @Test
    @DisplayName("Rejects non-numeric JSON types (strings, booleans) for bounded parameter fields")
    void testRejectsNonNumericTypesForBoundedFields() {
        // timeoutMs as string
        ObjectNode p1 = objectMapper.createObjectNode();
        p1.putArray("nodes").addObject().put("id", "t1").putObject("data").put("timeoutMs", "500");
        assertThatThrownBy(() -> converter.convertAndValidate(p1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeoutMs must be a number");

        // timeoutMs as boolean
        ObjectNode p1b = objectMapper.createObjectNode();
        p1b.putArray("nodes").addObject().put("id", "t1").putObject("data").put("timeoutMs", true);
        assertThatThrownBy(() -> converter.convertAndValidate(p1b))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeoutMs must be a number");

        // maxRetries as string
        ObjectNode p2 = objectMapper.createObjectNode();
        p2.putArray("nodes").addObject().put("id", "t1").putObject("data").put("maxRetries", "2");
        assertThatThrownBy(() -> converter.convertAndValidate(p2))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxRetries must be a number");

        // maxRetries as boolean
        ObjectNode p2b = objectMapper.createObjectNode();
        p2b.putArray("nodes").addObject().put("id", "t1").putObject("data").put("maxRetries", false);
        assertThatThrownBy(() -> converter.convertAndValidate(p2b))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxRetries must be a number");

        // delayMs as string
        ObjectNode p3 = objectMapper.createObjectNode();
        p3.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("simulation").put("delayMs", "1000");
        assertThatThrownBy(() -> converter.convertAndValidate(p3))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("delayMs must be a number");

        // delayMs as boolean
        ObjectNode p3b = objectMapper.createObjectNode();
        p3b.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("simulation").put("delayMs", true);
        assertThatThrownBy(() -> converter.convertAndValidate(p3b))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("delayMs must be a number");

        // failUntilAttempt as string
        ObjectNode p4 = objectMapper.createObjectNode();
        p4.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("simulation").put("failUntilAttempt", "3");
        assertThatThrownBy(() -> converter.convertAndValidate(p4))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("failUntilAttempt must be a number");

        // failUntilAttempt as boolean
        ObjectNode p4b = objectMapper.createObjectNode();
        p4b.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("simulation").put("failUntilAttempt", false);
        assertThatThrownBy(() -> converter.convertAndValidate(p4b))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("failUntilAttempt must be a number");

        // initialDelayMs as string
        ObjectNode p5 = objectMapper.createObjectNode();
        p5.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("retry").put("initialDelayMs", "500");
        assertThatThrownBy(() -> converter.convertAndValidate(p5))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("initialDelayMs must be a number");

        // initialDelayMs as boolean
        ObjectNode p5b = objectMapper.createObjectNode();
        p5b.putArray("nodes").addObject().put("id", "t1")
                .putObject("data").putObject("parameters").putObject("retry").put("initialDelayMs", true);
        assertThatThrownBy(() -> converter.convertAndValidate(p5b))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("initialDelayMs must be a number");

        // timeoutMs as null
        ObjectNode p1c = objectMapper.createObjectNode();
        p1c.putArray("nodes").addObject().put("id", "t1").putObject("data").putNull("timeoutMs");
        assertThatThrownBy(() -> converter.convertAndValidate(p1c))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeoutMs must be a number");

        // timeoutMs as array
        ObjectNode p1d = objectMapper.createObjectNode();
        p1d.putArray("nodes").addObject().put("id", "t1").putObject("data").putArray("timeoutMs");
        assertThatThrownBy(() -> converter.convertAndValidate(p1d))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeoutMs must be a number");

        // maxRetries as object
        ObjectNode p2c = objectMapper.createObjectNode();
        p2c.putArray("nodes").addObject().put("id", "t1").putObject("data").putObject("maxRetries");
        assertThatThrownBy(() -> converter.convertAndValidate(p2c))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxRetries must be a number");
    }

    @Test
    @DisplayName("Strips transient fields (status, executionDurationMs, isCycle) and preserves unknown fields")
    void testTransientFieldStrippingAndPreservation() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("status", "SUCCESS"); // root transient
        payload.put("executionDurationMs", 420); // root transient
        payload.putObject("viewport").put("x", 100).put("y", 200).put("zoom", 1.5); // design state

        ArrayNode nodes = payload.putArray("nodes");
        ObjectNode node1 = nodes.addObject();
        node1.put("id", "node-1");
        node1.put("type", "customTask");
        node1.put("status", "RUNNING"); // node-level transient
        node1.put("isCycle", true); // node-level transient
        node1.putObject("position").put("x", 50.5).put("y", 75.0); // canvas position

        ObjectNode data = node1.putObject("data");
        data.put("label", "Extract Data");
        data.put("taskType", "HTTP_REQUEST");
        data.put("status", "FAILED"); // data transient
        data.put("executionDurationMs", 123); // data transient
        data.put("isCycle", false); // data transient
        data.put("customAttribute", "preserve-this"); // unknown custom attribute

        ObjectNode params = data.putObject("parameters");
        params.put("endpoint", "https://api.example.com");
        params.put("method", "GET");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);

        // Assert transient fields are stripped
        assertThat(snapshot.cleanedPayload().has("status")).isFalse();
        assertThat(snapshot.cleanedPayload().has("executionDurationMs")).isFalse();
        assertThat(snapshot.cleanedPayload().has("isCycle")).isFalse();

        ObjectNode cleanedNode = (ObjectNode) snapshot.cleanedPayload().get("nodes").get(0);
        assertThat(cleanedNode.has("status")).isFalse();
        assertThat(cleanedNode.has("executionDurationMs")).isFalse();
        assertThat(cleanedNode.has("isCycle")).isFalse();

        ObjectNode cleanedData = (ObjectNode) cleanedNode.get("data");
        assertThat(cleanedData.has("status")).isFalse();
        assertThat(cleanedData.has("executionDurationMs")).isFalse();
        assertThat(cleanedData.has("isCycle")).isFalse();

        // Assert design and unknown custom fields are preserved intact
        assertThat(snapshot.cleanedPayload().path("viewport").path("zoom").asDouble()).isEqualTo(1.5);
        assertThat(cleanedNode.path("position").path("x").asDouble()).isEqualTo(50.5);
        assertThat(cleanedData.path("label").asText()).isEqualTo("Extract Data");
        assertThat(cleanedData.path("customAttribute").asText()).isEqualTo("preserve-this");
        assertThat(cleanedData.path("parameters").path("endpoint").asText()).isEqualTo("https://api.example.com");
    }

    @Test
    @DisplayName("Empty workflow (0 nodes, 0 edges) produces valid DAG draft")
    void testEmptyWorkflowIsValidDraft() {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes");
        payload.putArray("edges");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);
        assertThat(snapshot.taskCount()).isEqualTo(0);
        assertThat(snapshot.edgeCount()).isEqualTo(0);
        assertThat(snapshot.isValidDag()).isTrue();
    }

    @Test
    @DisplayName("Valid DAG (A -> B -> C) calculates correct derived metrics and isValidDag = true")
    void testValidDagMetrics() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "A");
        nodes.addObject().put("id", "B");
        nodes.addObject().put("id", "C");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "A").put("target", "B");
        edges.addObject().put("source", "B").put("target", "C");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);
        assertThat(snapshot.taskCount()).isEqualTo(3);
        assertThat(snapshot.edgeCount()).isEqualTo(2);
        assertThat(snapshot.isValidDag()).isTrue();
        assertThat(snapshot.validationResult().hasCycle()).isFalse();
    }

    @Test
    @DisplayName("Cyclic graph (A -> B -> A) is accepted as draft with isValidDag = false and hasCycle = true")
    void testCyclicGraphAcceptedAsDraft() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "A");
        nodes.addObject().put("id", "B");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "A").put("target", "B");
        edges.addObject().put("source", "B").put("target", "A");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);
        assertThat(snapshot.taskCount()).isEqualTo(2);
        assertThat(snapshot.edgeCount()).isEqualTo(2);
        assertThat(snapshot.isValidDag()).isFalse();
        assertThat(snapshot.validationResult().hasCycle()).isTrue();
        assertThat(snapshot.validationResult().cycleNodes()).contains("A", "B");
    }

    @Test
    @DisplayName("Self-loop (A -> A) is accepted as draft with isValidDag = false and hasCycle = true")
    void testSelfLoopAcceptedAsDraft() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "A");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "A").put("target", "A");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);
        assertThat(snapshot.taskCount()).isEqualTo(1);
        assertThat(snapshot.edgeCount()).isEqualTo(1);
        assertThat(snapshot.isValidDag()).isFalse();
        assertThat(snapshot.validationResult().hasCycle()).isTrue();
    }

    @Test
    @DisplayName("Dangling edge reference (A -> unknown) is accepted as draft with isValidDag = false")
    void testDanglingEdgeAcceptedAsDraft() {
        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "A");

        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "A").put("target", "non-existent-task");

        WorkflowSnapshot snapshot = converter.convertAndValidate(payload);
        assertThat(snapshot.taskCount()).isEqualTo(1);
        assertThat(snapshot.edgeCount()).isEqualTo(1);
        assertThat(snapshot.isValidDag()).isFalse();
        assertThat(snapshot.validationResult().errors())
                .anyMatch(err -> err.contains("Edge references unknown task"));
    }
}
