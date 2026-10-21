package com.flowforge.service;

import com.flowforge.api.dto.AddProjectMemberRequest;
import com.flowforge.api.dto.ProjectMemberResponse;
import com.flowforge.domain.Project;
import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProjectMemberServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private ProjectAuthorizationService authorizationService;

    private ProjectMemberService memberService;

    private UUID projectId;
    private Project project;
    private UUID userId;
    private User activeUser;

    @BeforeEach
    void setUp() {
        memberService = new ProjectMemberService(projectRepository, projectMemberRepository, userRepository, authorizationService);
        projectId = UUID.randomUUID();
        project = new Project(projectId, "Test Project", "test-project", "Description");
        userId = UUID.randomUUID();
        activeUser = new User(userId, "active@flowforge.io", "hash", "Active User", true);
    }

    @Test
    @DisplayName("listMembers returns list of members when user has read access")
    void listMembers_success() {
        ProjectMember member = new ProjectMember(project, activeUser, ProjectRole.DEVELOPER);
        member.setId(UUID.randomUUID());

        when(projectMemberRepository.findByProjectId(projectId)).thenReturn(List.of(member));

        List<ProjectMemberResponse> result = memberService.listMembers(projectId);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).userId()).isEqualTo(userId);
        assertThat(result.get(0).role()).isEqualTo(ProjectRole.DEVELOPER);
        verify(authorizationService).requireReadAccess(projectId);
    }

    @Test
    @DisplayName("addOrUpdateMember adds new member when user is admin")
    void addOrUpdateMember_addNew_success() {
        AddProjectMemberRequest request = new AddProjectMemberRequest(userId, null, ProjectRole.DEVELOPER);

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(userRepository.findById(userId)).thenReturn(Optional.of(activeUser));
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.empty());

        when(projectMemberRepository.save(any(ProjectMember.class))).thenAnswer(inv -> {
            ProjectMember m = inv.getArgument(0);
            m.setId(UUID.randomUUID());
            return m;
        });

        ProjectMemberResponse response = memberService.addOrUpdateMember(projectId, request);

        assertThat(response).isNotNull();
        assertThat(response.userId()).isEqualTo(userId);
        assertThat(response.role()).isEqualTo(ProjectRole.DEVELOPER);
        verify(authorizationService).requireAdminAccess(projectId);
    }

    @Test
    @DisplayName("addOrUpdateMember updates existing member role when user is admin")
    void addOrUpdateMember_updateExisting_success() {
        AddProjectMemberRequest request = new AddProjectMemberRequest(userId, null, ProjectRole.ADMIN);
        ProjectMember existingMember = new ProjectMember(project, activeUser, ProjectRole.DEVELOPER);
        existingMember.setId(UUID.randomUUID());

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(userRepository.findById(userId)).thenReturn(Optional.of(activeUser));
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(existingMember));
        when(projectMemberRepository.save(existingMember)).thenReturn(existingMember);

        ProjectMemberResponse response = memberService.addOrUpdateMember(projectId, request);

        assertThat(response.role()).isEqualTo(ProjectRole.ADMIN);
        assertThat(existingMember.getRole()).isEqualTo(ProjectRole.ADMIN);
    }

    @Test
    @DisplayName("addOrUpdateMember prevents demoting the sole remaining administrator")
    void addOrUpdateMember_demoteSoleAdmin_throwsException() {
        AddProjectMemberRequest request = new AddProjectMemberRequest(userId, null, ProjectRole.DEVELOPER);
        ProjectMember soleAdmin = new ProjectMember(project, activeUser, ProjectRole.ADMIN);
        soleAdmin.setId(UUID.randomUUID());

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(userRepository.findById(userId)).thenReturn(Optional.of(activeUser));
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(soleAdmin));
        when(projectMemberRepository.findByProjectId(projectId)).thenReturn(List.of(soleAdmin));

        assertThatThrownBy(() -> memberService.addOrUpdateMember(projectId, request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Cannot demote the only administrator of the project");

        verify(projectMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("addOrUpdateMember permits demoting an administrator when at least one other administrator remains")
    void addOrUpdateMember_demoteAdminWithMultipleAdmins_success() {
        AddProjectMemberRequest request = new AddProjectMemberRequest(userId, null, ProjectRole.DEVELOPER);
        ProjectMember adminToDemote = new ProjectMember(project, activeUser, ProjectRole.ADMIN);
        adminToDemote.setId(UUID.randomUUID());

        User secondAdminUser = new User(UUID.randomUUID(), "admin2@flowforge.io", "hash", "Admin 2", true);
        ProjectMember secondAdmin = new ProjectMember(project, secondAdminUser, ProjectRole.ADMIN);
        secondAdmin.setId(UUID.randomUUID());

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(userRepository.findById(userId)).thenReturn(Optional.of(activeUser));
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(adminToDemote));
        when(projectMemberRepository.findByProjectId(projectId)).thenReturn(List.of(adminToDemote, secondAdmin));
        when(projectMemberRepository.save(adminToDemote)).thenReturn(adminToDemote);

        ProjectMemberResponse response = memberService.addOrUpdateMember(projectId, request);

        assertThat(response.role()).isEqualTo(ProjectRole.DEVELOPER);
        assertThat(adminToDemote.getRole()).isEqualTo(ProjectRole.DEVELOPER);
        verify(projectMemberRepository).save(adminToDemote);
    }

    @Test
    @DisplayName("addOrUpdateMember rejects deactivated target user")
    void addOrUpdateMember_inactiveUser_throwsException() {
        User inactiveUser = new User(userId, "inactive@flowforge.io", "hash", "Inactive", false);
        AddProjectMemberRequest request = new AddProjectMemberRequest(userId, null, ProjectRole.VIEWER);

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(userRepository.findById(userId)).thenReturn(Optional.of(inactiveUser));

        assertThatThrownBy(() -> memberService.addOrUpdateMember(projectId, request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Cannot add deactivated user");

        verify(projectMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("removeMember deletes member when multiple admins exist")
    void removeMember_success() {
        ProjectMember adminToRemove = new ProjectMember(project, activeUser, ProjectRole.ADMIN);
        User secondAdminUser = new User(UUID.randomUUID(), "admin2@flowforge.io", "hash", "Admin 2", true);
        ProjectMember secondAdmin = new ProjectMember(project, secondAdminUser, ProjectRole.ADMIN);

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(adminToRemove));
        when(projectMemberRepository.findByProjectId(projectId)).thenReturn(List.of(adminToRemove, secondAdmin));

        memberService.removeMember(projectId, userId);

        verify(projectMemberRepository).delete(adminToRemove);
    }

    @Test
    @DisplayName("removeMember prevents removing the only remaining administrator")
    void removeMember_lastAdmin_throwsException() {
        ProjectMember onlyAdmin = new ProjectMember(project, activeUser, ProjectRole.ADMIN);

        when(projectRepository.findByIdWithPessimisticLock(projectId)).thenReturn(Optional.of(project));
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(onlyAdmin));
        when(projectMemberRepository.findByProjectId(projectId)).thenReturn(List.of(onlyAdmin));

        assertThatThrownBy(() -> memberService.removeMember(projectId, userId))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Cannot remove the only administrator of the project");

        verify(projectMemberRepository, never()).delete(any());
    }
}
