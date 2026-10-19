package com.flowforge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flowforge.domain.Project;
import com.flowforge.domain.Workflow;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkflowVersionServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private WorkflowRepository workflowRepository;

    @Mock
    private WorkflowVersionRepository workflowVersionRepository;

    private WorkflowSnapshotConverter snapshotConverter;
    private WorkflowVersionService workflowVersionService;

    @BeforeEach
    void setUp() {
        snapshotConverter = new WorkflowSnapshotConverter();
        workflowVersionService = new WorkflowVersionService(
                workflowRepository,
                workflowVersionRepository,
                snapshotConverter
        );
    }

    @Test
    @DisplayName("createVersion locks parent workflow row with findByIdForUpdate and allocates version 1 when no versions exist")
    void testCreateVersionFirstVersion() {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "ETL", "etl", "Desc");
        when(workflowRepository.findByIdForUpdate(workflowId)).thenReturn(Optional.of(workflow));
        when(workflowVersionRepository.findMaxVersionNumber(workflowId)).thenReturn(Optional.empty());
        when(workflowVersionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));

        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "task-1");
        nodes.addObject().put("id", "task-2");
        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "task-1").put("target", "task-2");

        WorkflowVersion saved = workflowVersionService.createVersion(workflowId, null, "Initial commit", payload);

        verify(workflowRepository).findByIdForUpdate(workflowId);
        assertThat(saved.getVersionNumber()).isEqualTo(1);
        assertThat(saved.getVersionTag()).isEqualTo("v1");
        assertThat(saved.getDescription()).isEqualTo("Initial commit");
        assertThat(saved.getTaskCount()).isEqualTo(2);
        assertThat(saved.getEdgeCount()).isEqualTo(1);
        assertThat(saved.getIsValidDag()).isTrue();
    }

    @Test
    @DisplayName("createVersion increments version number to 2 and uses custom versionName")
    void testCreateVersionSequentialAllocation() {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "ETL", "etl", "Desc");
        when(workflowRepository.findByIdForUpdate(workflowId)).thenReturn(Optional.of(workflow));
        when(workflowVersionRepository.findMaxVersionNumber(workflowId)).thenReturn(Optional.of(1));
        when(workflowVersionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));

        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes").addObject().put("id", "single-task");
        payload.putArray("edges");

        WorkflowVersion saved = workflowVersionService.createVersion(workflowId, "v1.1.0", "Update", payload);

        assertThat(saved.getVersionNumber()).isEqualTo(2);
        assertThat(saved.getVersionTag()).isEqualTo("v1.1.0");
        assertThat(saved.getTaskCount()).isEqualTo(1);
        assertThat(saved.getEdgeCount()).isEqualTo(0);
        assertThat(saved.getIsValidDag()).isTrue();
    }

    @Test
    @DisplayName("createVersion accepts invalid DAG cyclic draft and persists with isValidDag = false")
    void testCreateVersionCyclicDraft() {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "ETL", "etl", "Desc");
        when(workflowRepository.findByIdForUpdate(workflowId)).thenReturn(Optional.of(workflow));
        when(workflowVersionRepository.findMaxVersionNumber(workflowId)).thenReturn(Optional.of(2));
        when(workflowVersionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));

        ObjectNode payload = objectMapper.createObjectNode();
        ArrayNode nodes = payload.putArray("nodes");
        nodes.addObject().put("id", "A");
        nodes.addObject().put("id", "B");
        ArrayNode edges = payload.putArray("edges");
        edges.addObject().put("source", "A").put("target", "B");
        edges.addObject().put("source", "B").put("target", "A"); // Cycle

        WorkflowVersion saved = workflowVersionService.createVersion(workflowId, "draft-cycle", "WIP", payload);

        assertThat(saved.getVersionNumber()).isEqualTo(3);
        assertThat(saved.getTaskCount()).isEqualTo(2);
        assertThat(saved.getEdgeCount()).isEqualTo(2);
        assertThat(saved.getIsValidDag()).isFalse();
    }

    @Test
    @DisplayName("createVersion rejects structurally malformed payload with IllegalArgumentException without calling repository")
    void testCreateVersionRejectsMalformedPayload() {
        UUID workflowId = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "ETL", "etl", "Desc");
        when(workflowRepository.findByIdForUpdate(workflowId)).thenReturn(Optional.of(workflow));

        ObjectNode malformedPayload = objectMapper.createObjectNode();
        malformedPayload.put("nodes", "not-an-array");

        assertThatThrownBy(() -> workflowVersionService.createVersion(workflowId, "v1", null, malformedPayload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'nodes' field must be a JSON array");

        verify(workflowVersionRepository, never()).save(any());
    }

    @Test
    @DisplayName("createVersion throws ResourceNotFoundException when parent workflow does not exist")
    void testCreateVersionWorkflowNotFound() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.findByIdForUpdate(workflowId)).thenReturn(Optional.empty());

        ObjectNode payload = objectMapper.createObjectNode();
        payload.putArray("nodes");

        assertThatThrownBy(() -> workflowVersionService.createVersion(workflowId, "v1", null, payload))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow not found: " + workflowId);

        verify(workflowVersionRepository, never()).save(any());
    }

    @Test
    @DisplayName("getLatestVersion returns most recent version or throws ResourceNotFoundException")
    void testGetLatestVersion() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);
        WorkflowVersion v2 = new WorkflowVersion(null, 2, "v2", null, objectMapper.createObjectNode(), 1, 0, true);
        when(workflowVersionRepository.findFirstByWorkflowIdOrderByVersionNumberDesc(workflowId)).thenReturn(Optional.of(v2));

        assertThat(workflowVersionService.getLatestVersion(workflowId)).isSameAs(v2);

        // Workflow has no versions
        when(workflowVersionRepository.findFirstByWorkflowIdOrderByVersionNumberDesc(workflowId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> workflowVersionService.getLatestVersion(workflowId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow has no saved versions");

        // Workflow itself does not exist
        UUID missingId = UUID.randomUUID();
        when(workflowRepository.existsById(missingId)).thenReturn(false);
        assertThatThrownBy(() -> workflowVersionService.getLatestVersion(missingId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow not found: " + missingId);
    }

    @Test
    @DisplayName("getVersionByNumber returns specific version or throws ResourceNotFoundException")
    void testGetVersionByNumber() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);
        WorkflowVersion v1 = new WorkflowVersion(null, 1, "v1", null, objectMapper.createObjectNode(), 1, 0, true);
        when(workflowVersionRepository.findByWorkflowIdAndVersionNumber(workflowId, 1)).thenReturn(Optional.of(v1));

        assertThat(workflowVersionService.getVersionByNumber(workflowId, 1)).isSameAs(v1);

        when(workflowVersionRepository.findByWorkflowIdAndVersionNumber(workflowId, 99)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> workflowVersionService.getVersionByNumber(workflowId, 99))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow version 99 not found for workflow " + workflowId);
    }

    @Test
    @DisplayName("listVersions validates workflow existence and delegates to repository")
    void testListVersions() {
        UUID workflowId = UUID.randomUUID();
        when(workflowRepository.existsById(workflowId)).thenReturn(true);
        PageRequest pageRequest = PageRequest.of(0, 10);
        WorkflowVersion v1 = new WorkflowVersion(null, 1, "v1", null, objectMapper.createObjectNode(), 1, 0, true);
        when(workflowVersionRepository.findByWorkflowIdOrderByVersionNumberDesc(workflowId, pageRequest))
                .thenReturn(new PageImpl<>(List.of(v1)));

        Page<WorkflowVersion> result = workflowVersionService.listVersions(workflowId, pageRequest);
        assertThat(result.getContent()).containsExactly(v1);
    }
}
