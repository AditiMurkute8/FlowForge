package com.flowforge.service;

import com.flowforge.domain.Project;
import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProjectAuthorizationServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    private ProjectAuthorizationService authorizationService;

    private UUID userId;
    private User testUser;
    private UUID projectId;
    private Project testProject;

    @BeforeEach
    void setUp() {
        authorizationService = new ProjectAuthorizationService(projectRepository, projectMemberRepository);
        userId = UUID.randomUUID();
        testUser = new User(userId, "test@flowforge.io", "hash", "Test User", true);
        projectId = UUID.randomUUID();
        testProject = new Project(projectId, "Test Project", "test-project", "Description");
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateUser() {
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
            testUser, null, List.of(new SimpleGrantedAuthority("ROLE_USER"))
        );
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    @Test
    @DisplayName("requireCurrentUser throws AuthenticationCredentialsNotFoundException when unauthenticated")
    void requireCurrentUser_unauthenticated_throwsException() {
        SecurityContextHolder.clearContext();
        assertThatThrownBy(() -> authorizationService.requireCurrentUser())
            .isInstanceOf(AuthenticationCredentialsNotFoundException.class)
            .hasMessageContaining("must be authenticated");
    }

    @Test
    @DisplayName("requireReadAccess throws 404 ResourceNotFoundException when project does not exist")
    void requireRole_projectDoesNotExist_throws404() {
        authenticateUser();
        when(projectRepository.existsById(projectId)).thenReturn(false);

        assertThatThrownBy(() -> authorizationService.requireReadAccess(projectId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Project not found: " + projectId);
    }

    @Test
    @DisplayName("requireReadAccess throws 404 ResourceNotFoundException when user is NOT a member (anti-leakage)")
    void requireRole_userNotMember_throws404AntiLeakage() {
        authenticateUser();
        when(projectRepository.existsById(projectId)).thenReturn(true);
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.empty());

        // Must return 404, NOT 403, to prevent probing whether private project IDs exist
        assertThatThrownBy(() -> authorizationService.requireReadAccess(projectId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Project not found: " + projectId);
    }

    @Test
    @DisplayName("VIEWER role: can read, but cannot edit, execute, or manage members (throws 403)")
    void viewerRole_permissions() {
        authenticateUser();
        ProjectMember viewerMember = new ProjectMember(testProject, testUser, ProjectRole.VIEWER);
        when(projectRepository.existsById(projectId)).thenReturn(true);
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(viewerMember));

        // Read succeeds
        assertThat(authorizationService.requireReadAccess(projectId)).isSameAs(viewerMember);

        // Edit throws 403
        assertThatThrownBy(() -> authorizationService.requireEditAccess(projectId))
            .isInstanceOf(AccessDeniedException.class)
            .hasMessageContaining("VIEWER");

        // Execute throws 403
        assertThatThrownBy(() -> authorizationService.requireExecuteAccess(projectId))
            .isInstanceOf(AccessDeniedException.class)
            .hasMessageContaining("VIEWER");

        // Admin throws 403
        assertThatThrownBy(() -> authorizationService.requireAdminAccess(projectId))
            .isInstanceOf(AccessDeniedException.class)
            .hasMessageContaining("VIEWER");
    }

    @Test
    @DisplayName("DEVELOPER role: can read, edit, execute, but cannot perform admin operations (throws 403)")
    void developerRole_permissions() {
        authenticateUser();
        ProjectMember developerMember = new ProjectMember(testProject, testUser, ProjectRole.DEVELOPER);
        when(projectRepository.existsById(projectId)).thenReturn(true);
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(developerMember));

        // Read succeeds
        assertThat(authorizationService.requireReadAccess(projectId)).isSameAs(developerMember);

        // Edit succeeds
        assertThat(authorizationService.requireEditAccess(projectId)).isSameAs(developerMember);

        // Execute succeeds
        assertThat(authorizationService.requireExecuteAccess(projectId)).isSameAs(developerMember);

        // Admin throws 403
        assertThatThrownBy(() -> authorizationService.requireAdminAccess(projectId))
            .isInstanceOf(AccessDeniedException.class)
            .hasMessageContaining("DEVELOPER");
    }

    @Test
    @DisplayName("ADMIN role: can read, edit, execute, and perform all admin operations")
    void adminRole_permissions() {
        authenticateUser();
        ProjectMember adminMember = new ProjectMember(testProject, testUser, ProjectRole.ADMIN);
        when(projectRepository.existsById(projectId)).thenReturn(true);
        when(projectMemberRepository.findByProjectIdAndUserId(projectId, userId)).thenReturn(Optional.of(adminMember));

        assertThat(authorizationService.requireReadAccess(projectId)).isSameAs(adminMember);
        assertThat(authorizationService.requireEditAccess(projectId)).isSameAs(adminMember);
        assertThat(authorizationService.requireExecuteAccess(projectId)).isSameAs(adminMember);
        assertThat(authorizationService.requireAdminAccess(projectId)).isSameAs(adminMember);
    }
}
