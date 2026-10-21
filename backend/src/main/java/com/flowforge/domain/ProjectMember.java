package com.flowforge.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * JPA entity mapping user membership and role assignments within a project.
 * Mapped to table `project_members` defined in Flyway V4 migration.
 */
@Entity
@Table(
    name = "project_members",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_project_members_user", columnNames = {"project_id", "user_id"})
    },
    indexes = {
        @Index(name = "idx_project_members_user", columnList = "user_id")
    }
)
public class ProjectMember {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false, foreignKey = @ForeignKey(name = "fk_project_members_project"))
    private Project project;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, foreignKey = @ForeignKey(name = "fk_project_members_user"))
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 20)
    private ProjectRole role;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public ProjectMember() {
        // Required default JPA constructor
    }

    @PrePersist
    public void onCreate() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }

    public ProjectMember(Project project, User user, ProjectRole role) {
        this.project = Objects.requireNonNull(project, "Project must not be null");
        this.user = Objects.requireNonNull(user, "User must not be null");
        this.role = Objects.requireNonNull(role, "Role must not be null");
    }

    public ProjectMember(UUID id, Project project, User user, ProjectRole role) {
        this.id = id;
        this.project = Objects.requireNonNull(project, "Project must not be null");
        this.user = Objects.requireNonNull(user, "User must not be null");
        this.role = Objects.requireNonNull(role, "Role must not be null");
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Project getProject() {
        return project;
    }

    public void setProject(Project project) {
        this.project = project;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public ProjectRole getRole() {
        return role;
    }

    public void setRole(ProjectRole role) {
        this.role = role;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ProjectMember that)) return false;
        return id != null && Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
