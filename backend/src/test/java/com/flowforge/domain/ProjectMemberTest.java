package com.flowforge.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ProjectMemberTest {

    @Test
    @DisplayName("ProjectRole enum correctly identifies permissions for ADMIN, DEVELOPER, and VIEWER")
    void projectRolePermissions() {
        // ADMIN
        assertThat(ProjectRole.ADMIN.canManageMembers()).isTrue();
        assertThat(ProjectRole.ADMIN.canEdit()).isTrue();
        assertThat(ProjectRole.ADMIN.canRead()).isTrue();

        // DEVELOPER
        assertThat(ProjectRole.DEVELOPER.canManageMembers()).isFalse();
        assertThat(ProjectRole.DEVELOPER.canEdit()).isTrue();
        assertThat(ProjectRole.DEVELOPER.canRead()).isTrue();

        // VIEWER
        assertThat(ProjectRole.VIEWER.canManageMembers()).isFalse();
        assertThat(ProjectRole.VIEWER.canEdit()).isFalse();
        assertThat(ProjectRole.VIEWER.canRead()).isTrue();
    }

    @Test
    @DisplayName("ProjectMember links Project, User, and ProjectRole")
    void memberAssociation() {
        Project project = new Project(UUID.randomUUID(), "Test Project", "test-project", "desc");
        User user = new User("member@flowforge.io", "$2a$12$hash");
        user.setId(UUID.randomUUID());

        ProjectMember member = new ProjectMember(project, user, ProjectRole.DEVELOPER);

        assertThat(member.getProject()).isEqualTo(project);
        assertThat(member.getUser()).isEqualTo(user);
        assertThat(member.getRole()).isEqualTo(ProjectRole.DEVELOPER);
    }

    @Test
    @DisplayName("ProjectMember PrePersist populates createdAt timestamp")
    void lifecycleCreatedAt() {
        ProjectMember member = new ProjectMember();
        member.onCreate();

        assertThat(member.getCreatedAt()).isNotNull();
        assertThat(member.getCreatedAt()).isBeforeOrEqualTo(Instant.now());
    }

    @Test
    @DisplayName("Project entity exposes members list and helper addMember/removeMember")
    void projectMemberHelpers() {
        Project project = new Project(UUID.randomUUID(), "Test", "test", null);
        User user = new User("collab@flowforge.io", "$2a$12$hash");
        user.setId(UUID.randomUUID());

        ProjectMember member = new ProjectMember(project, user, ProjectRole.ADMIN);
        project.addMember(member);

        assertThat(project.getMembers()).contains(member);
        assertThat(member.getProject()).isEqualTo(project);

        project.removeMember(member);
        assertThat(project.getMembers()).doesNotContain(member);
        assertThat(member.getProject()).isNull();
    }
}
