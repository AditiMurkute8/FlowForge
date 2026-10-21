package com.flowforge.persistence;

import com.flowforge.domain.Project;
import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.UserRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class AuthPersistencePostgresTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("flowforge_auth_test")
            .withUsername("flowforge_user")
            .withPassword("flowforge_pass");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.jpa.properties.hibernate.dialect", () -> "org.hibernate.dialect.PostgreSQLDialect");
    }

    @BeforeAll
    static void migrateFlyway() {
        Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    @Test
    @DisplayName("1. User entity can be persisted and looked up by normalized email")
    void persistAndFindUserByEmail() {
        User user = new User("Alice.Smith@FlowForge.io", "$2a$12$hashvalueexample12345678901234567890123456789012", "Alice Smith");
        User saved = userRepository.saveAndFlush(user);

        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getEmail()).isEqualTo("alice.smith@flowforge.io");
        assertThat(saved.isActive()).isTrue();
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();

        Optional<User> found = userRepository.findByEmail("alice.smith@flowforge.io");
        assertThat(found).isPresent();
        assertThat(found.get().getId()).isEqualTo(saved.getId());
        assertThat(found.get().getFullName()).isEqualTo("Alice Smith");

        assertThat(userRepository.existsByEmail("alice.smith@flowforge.io")).isTrue();
        assertThat(userRepository.existsByEmail("nonexistent@flowforge.io")).isFalse();
    }

    @Test
    @DisplayName("2. Database enforces unique constraint on user email")
    void uniqueUserEmailEnforced() {
        User u1 = new User("unique.user@flowforge.io", "$2a$12$hash1", "User One");
        userRepository.saveAndFlush(u1);

        User u2 = new User("unique.user@flowforge.io", "$2a$12$hash2", "User Two");
        assertThatThrownBy(() -> userRepository.saveAndFlush(u2))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("3. ProjectMember persists association between Project and User with ProjectRole")
    void persistAndQueryProjectMember() {
        Project project = projectRepository.saveAndFlush(new Project(UUID.randomUUID(), "Member Project", "member-proj", "desc"));
        User user = userRepository.saveAndFlush(new User("dev.member@flowforge.io", "$2a$12$hash3", "Dev Member"));

        ProjectMember member = new ProjectMember(project, user, ProjectRole.DEVELOPER);
        ProjectMember savedMember = projectMemberRepository.saveAndFlush(member);

        assertThat(savedMember.getId()).isNotNull();
        assertThat(savedMember.getProject().getId()).isEqualTo(project.getId());
        assertThat(savedMember.getUser().getId()).isEqualTo(user.getId());
        assertThat(savedMember.getRole()).isEqualTo(ProjectRole.DEVELOPER);
        assertThat(savedMember.getCreatedAt()).isNotNull();

        Optional<ProjectMember> lookup = projectMemberRepository.findByProjectIdAndUserId(project.getId(), user.getId());
        assertThat(lookup).isPresent();
        assertThat(lookup.get().getRole()).isEqualTo(ProjectRole.DEVELOPER);

        List<ProjectMember> byProject = projectMemberRepository.findByProjectId(project.getId());
        assertThat(byProject).hasSize(1);
        assertThat(byProject.get(0).getUser().getEmail()).isEqualTo("dev.member@flowforge.io");

        List<ProjectMember> byUser = projectMemberRepository.findByUserId(user.getId());
        assertThat(byUser).hasSize(1);
        assertThat(byUser.get(0).getProject().getSlug()).isEqualTo("member-proj");
    }

    @Test
    @DisplayName("4. Database enforces unique constraint on (project_id, user_id)")
    void duplicateProjectMembershipRejected() {
        Project project = projectRepository.saveAndFlush(new Project(UUID.randomUUID(), "Duplicate Test Project", "dup-proj", "desc"));
        User user = userRepository.saveAndFlush(new User("dup.member@flowforge.io", "$2a$12$hash4", "Dup Member"));

        ProjectMember m1 = new ProjectMember(project, user, ProjectRole.ADMIN);
        projectMemberRepository.saveAndFlush(m1);

        ProjectMember m2 = new ProjectMember(project, user, ProjectRole.VIEWER);
        assertThatThrownBy(() -> projectMemberRepository.saveAndFlush(m2))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
