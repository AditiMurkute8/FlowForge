package com.flowforge.service;

import com.flowforge.domain.Project;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
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
class ProjectServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private WorkflowRepository workflowRepository;

    private ProjectService projectService;

    @BeforeEach
    void setUp() {
        projectService = new ProjectService(projectRepository, workflowRepository);
    }

    @Test
    @DisplayName("createProject with null slug auto-generates slug from name")
    void testCreateProjectAutoSlug() {
        when(projectRepository.existsBySlug("analytics-pipeline")).thenReturn(false);
        when(projectRepository.save(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Project result = projectService.createProject("Analytics Pipeline", null, "Test description");

        assertThat(result.getName()).isEqualTo("Analytics Pipeline");
        assertThat(result.getSlug()).isEqualTo("analytics-pipeline");
        assertThat(result.getDescription()).isEqualTo("Test description");
        verify(projectRepository).save(any(Project.class));
    }

    @Test
    @DisplayName("createProject with custom slug validates and normalizes custom slug")
    void testCreateProjectCustomSlug() {
        when(projectRepository.existsBySlug("custom-slug")).thenReturn(false);
        when(projectRepository.save(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Project result = projectService.createProject("Analytics Pipeline", "Custom_Slug", "Desc");

        assertThat(result.getSlug()).isEqualTo("custom-slug");
        verify(projectRepository).save(any(Project.class));
    }

    @Test
    @DisplayName("createProject rejects blank name with IllegalArgumentException")
    void testCreateProjectBlankName() {
        assertThatThrownBy(() -> projectService.createProject("   ", null, "Desc"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Project name must not be blank");
    }

    @Test
    @DisplayName("createProject throws ResourceConflictException on duplicate slug")
    void testCreateProjectDuplicateSlug() {
        when(projectRepository.existsBySlug("duplicate-slug")).thenReturn(true);

        assertThatThrownBy(() -> projectService.createProject("Duplicate Project", "duplicate-slug", "Desc"))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("A project with slug 'duplicate-slug' already exists");

        verify(projectRepository, never()).save(any());
    }

    @Test
    @DisplayName("getProjectById returns entity or throws ResourceNotFoundException")
    void testGetProjectById() {
        UUID id = UUID.randomUUID();
        Project project = new Project("Test", "test", "Desc");
        when(projectRepository.findById(id)).thenReturn(Optional.of(project));

        assertThat(projectService.getProjectById(id)).isSameAs(project);

        UUID missingId = UUID.randomUUID();
        when(projectRepository.findById(missingId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectService.getProjectById(missingId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Project not found: " + missingId);
    }

    @Test
    @DisplayName("getProjectBySlug returns entity or throws ResourceNotFoundException")
    void testGetProjectBySlug() {
        Project project = new Project("Test", "test-slug", "Desc");
        when(projectRepository.findBySlug("test-slug")).thenReturn(Optional.of(project));

        assertThat(projectService.getProjectBySlug("test-slug")).isSameAs(project);

        when(projectRepository.findBySlug("unknown-slug")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectService.getProjectBySlug("unknown-slug"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Project not found with slug: unknown-slug");
    }

    @Test
    @DisplayName("listProjects delegates to repository.findAll(pageable)")
    void testListProjects() {
        PageRequest pageRequest = PageRequest.of(0, 10);
        Project project = new Project("Test", "test", "Desc");
        when(projectRepository.findAll(pageRequest)).thenReturn(new PageImpl<>(List.of(project)));

        Page<Project> result = projectService.listProjects(pageRequest);
        assertThat(result.getContent()).containsExactly(project);
    }

    @Test
    @DisplayName("deleteProject succeeds when no dependent workflows exist")
    void testDeleteProjectSuccess() {
        UUID id = UUID.randomUUID();
        Project project = new Project("Test", "test", "Desc");
        when(projectRepository.findByIdWithPessimisticLock(id)).thenReturn(Optional.of(project));
        when(workflowRepository.countByProjectId(id)).thenReturn(0L);

        projectService.deleteProject(id);

        verify(projectRepository).delete(project);
    }

    @Test
    @DisplayName("deleteProject throws ResourceConflictException when dependent workflows exist")
    void testDeleteProjectWithDependentWorkflows() {
        UUID id = UUID.randomUUID();
        Project project = new Project("Test", "test", "Desc");
        when(projectRepository.findByIdWithPessimisticLock(id)).thenReturn(Optional.of(project));
        when(workflowRepository.countByProjectId(id)).thenReturn(2L);

        assertThatThrownBy(() -> projectService.deleteProject(id))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("Cannot delete project because dependent workflows exist");

        verify(projectRepository, never()).delete(any());
    }
}
