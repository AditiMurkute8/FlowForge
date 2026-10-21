package com.flowforge.service;

import com.flowforge.domain.Project;
import com.flowforge.domain.Workflow;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import com.flowforge.service.exception.ResourceConflictException;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
class WorkflowServiceTest {

    @Mock
    private WorkflowRepository workflowRepository;

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private WorkflowVersionRepository workflowVersionRepository;

    private WorkflowService workflowService;

    @BeforeEach
    void setUp() {
        workflowService = new WorkflowService(workflowRepository, projectRepository, workflowVersionRepository);
    }

    @Test
    @DisplayName("createWorkflow with null slug auto-generates slug from name")
    void testCreateWorkflowAutoSlug() {
        UUID projectId = UUID.randomUUID();
        Project project = new Project("Project 1", "proj-1", "Desc");
        when(projectRepository.findById(projectId)).thenReturn(Optional.of(project));
        when(workflowRepository.existsByProjectIdAndSlug(projectId, "etl-pipeline")).thenReturn(false);
        when(workflowRepository.save(any(Workflow.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Workflow result = workflowService.createWorkflow(projectId, "ETL Pipeline", null, "Data sync");

        assertThat(result.getName()).isEqualTo("ETL Pipeline");
        assertThat(result.getSlug()).isEqualTo("etl-pipeline");
        assertThat(result.getProject()).isSameAs(project);
        verify(workflowRepository).save(any(Workflow.class));
    }

    @Test
    @DisplayName("createWorkflow throws ResourceNotFoundException when parent project does not exist")
    void testCreateWorkflowMissingProject() {
        UUID projectId = UUID.randomUUID();
        when(projectRepository.findById(projectId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> workflowService.createWorkflow(projectId, "WF", null, null))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Project not found: " + projectId);

        verify(workflowRepository, never()).save(any());
    }

    @Test
    @DisplayName("createWorkflow throws ResourceConflictException on duplicate slug in same project")
    void testCreateWorkflowDuplicateSlugInProject() {
        UUID projectId = UUID.randomUUID();
        Project project = new Project("Project 1", "proj-1", "Desc");
        when(projectRepository.findById(projectId)).thenReturn(Optional.of(project));
        when(workflowRepository.existsByProjectIdAndSlug(projectId, "existing-wf")).thenReturn(true);

        assertThatThrownBy(() -> workflowService.createWorkflow(projectId, "Existing WF", "existing-wf", null))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("A workflow with slug 'existing-wf' already exists in this project");

        verify(workflowRepository, never()).save(any());
    }

    @Test
    @DisplayName("getWorkflowById returns entity or throws ResourceNotFoundException")
    void testGetWorkflowById() {
        UUID id = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "W", "w", null);
        when(workflowRepository.findById(id)).thenReturn(Optional.of(workflow));

        assertThat(workflowService.getWorkflowById(id)).isSameAs(workflow);

        UUID missingId = UUID.randomUUID();
        when(workflowRepository.findById(missingId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> workflowService.getWorkflowById(missingId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow not found: " + missingId);
    }

    @Test
    @DisplayName("getWorkflowByProjectAndSlug validates project existence and returns workflow")
    void testGetWorkflowByProjectAndSlug() {
        UUID projectId = UUID.randomUUID();
        when(projectRepository.existsById(projectId)).thenReturn(true);
        Workflow workflow = new Workflow(new Project("P", "p", null), "W", "target-slug", null);
        when(workflowRepository.findByProjectIdAndSlug(projectId, "target-slug")).thenReturn(Optional.of(workflow));

        assertThat(workflowService.getWorkflowByProjectAndSlug(projectId, "target-slug")).isSameAs(workflow);

        when(workflowRepository.findByProjectIdAndSlug(projectId, "missing-slug")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> workflowService.getWorkflowByProjectAndSlug(projectId, "missing-slug"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workflow not found with slug 'missing-slug' in project " + projectId);
    }

    @Test
    @DisplayName("listWorkflowsByProject checks project existence and returns paged results")
    void testListWorkflowsByProject() {
        UUID projectId = UUID.randomUUID();
        when(projectRepository.existsById(projectId)).thenReturn(true);
        PageRequest pageRequest = PageRequest.of(0, 10);
        Workflow workflow = new Workflow(new Project("P", "p", null), "W", "w", null);
        when(workflowRepository.findByProjectId(projectId, pageRequest)).thenReturn(new PageImpl<>(List.of(workflow)));

        Page<Workflow> result = workflowService.listWorkflowsByProject(projectId, pageRequest);
        assertThat(result.getContent()).containsExactly(workflow);

        UUID missingProjectId = UUID.randomUUID();
        when(projectRepository.existsById(missingProjectId)).thenReturn(false);
        assertThatThrownBy(() -> workflowService.listWorkflowsByProject(missingProjectId, pageRequest))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Project not found: " + missingProjectId);
    }

    @Test
    @DisplayName("deleteWorkflow succeeds when no dependent versions exist")
    void testDeleteWorkflowSuccess() {
        UUID id = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "W", "w", null);
        when(workflowRepository.findById(id)).thenReturn(Optional.of(workflow));
        when(workflowVersionRepository.countByWorkflowId(id)).thenReturn(0L);

        workflowService.deleteWorkflow(id);

        verify(workflowRepository).delete(workflow);
    }

    @Test
    @DisplayName("deleteWorkflow throws ResourceConflictException when dependent versions exist")
    void testDeleteWorkflowWithDependentVersions() {
        UUID id = UUID.randomUUID();
        Workflow workflow = new Workflow(new Project("P", "p", null), "W", "w", null);
        when(workflowRepository.findById(id)).thenReturn(Optional.of(workflow));
        when(workflowVersionRepository.countByWorkflowId(id)).thenReturn(1L);

        assertThatThrownBy(() -> workflowService.deleteWorkflow(id))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("Cannot delete workflow because dependent versions exist");

        verify(workflowRepository, never()).delete(any());
    }
}
