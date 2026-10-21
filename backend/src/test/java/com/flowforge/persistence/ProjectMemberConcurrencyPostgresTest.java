package com.flowforge.persistence;

import com.flowforge.api.dto.AddProjectMemberRequest;
import com.flowforge.domain.Project;
import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.service.ProjectAuthorizationService;
import com.flowforge.service.ProjectMemberService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * PostgreSQL-backed concurrency and transactional boundary tests using Testcontainers.
 * Verifies that JPA pessimistic row-level locking on the parent Project entity prevents
 * concurrent administrative mutations from leaving a project with zero administrators
 * against an actual PostgreSQL 16 database.
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({ProjectMemberService.class, ProjectAuthorizationService.class})
class ProjectMemberConcurrencyPostgresTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("flowforge_concurrency_test")
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
    static void applyMigrations() {
        Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    @Autowired
    private UserRepository userRepository;

    private Project testProject;
    private User admin1;
    private User admin2;

    @BeforeEach
    void setUp() {
        projectMemberRepository.deleteAll();
        projectRepository.deleteAll();
        userRepository.deleteAll();

        testProject = projectRepository.save(new Project("Postgres Concurrency Project", "pg-concurrency-proj", "Test project"));

        admin1 = userRepository.save(new User("pg_admin1@flowforge.internal", "hash1", "Admin One"));
        admin2 = userRepository.save(new User("pg_admin2@flowforge.internal", "hash2", "Admin Two"));

        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin1, null, Collections.emptyList())
        );
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        projectMemberRepository.deleteAll();
        projectRepository.deleteAll();
        userRepository.deleteAll();
    }

    private long countAdmins(UUID projectId) {
        return projectMemberRepository.findByProjectId(projectId).stream()
                .filter(m -> m.getRole() == ProjectRole.ADMIN)
                .count();
    }

    @Test
    @DisplayName("1. Sole administrator cannot be demoted on PostgreSQL")
    void soleAdminCannotBeDemotedOnPostgres() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));

        AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin1.getId(), null, ProjectRole.DEVELOPER);

        assertThatThrownBy(() -> projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Cannot demote the only administrator of the project");

        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(testProject.getId(), admin1.getId()).orElseThrow();
        assertThat(member.getRole()).isEqualTo(ProjectRole.ADMIN);
    }

    @Test
    @DisplayName("2. Sole administrator cannot be removed on PostgreSQL")
    void soleAdminCannotBeRemovedOnPostgres() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));

        assertThatThrownBy(() -> projectMemberService.removeMember(testProject.getId(), admin1.getId()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Cannot remove the only administrator of the project");

        assertThat(countAdmins(testProject.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("3. Multi-admin project permits role change while retaining admin on PostgreSQL")
    void multiAdminProjectPermitsRoleChangeOnPostgres() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));
        projectMemberRepository.save(new ProjectMember(testProject, admin2, ProjectRole.ADMIN));

        AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin2.getId(), null, ProjectRole.DEVELOPER);
        projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq);

        ProjectMember member2 = projectMemberRepository.findByProjectIdAndUserId(testProject.getId(), admin2.getId()).orElseThrow();
        assertThat(member2.getRole()).isEqualTo(ProjectRole.DEVELOPER);
        assertThat(countAdmins(testProject.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("4. Concurrent competing demote/remove operations on PostgreSQL cannot leave zero administrators")
    void concurrentAdminRemovalOrDemotionLeavesAtLeastOneAdminOnPostgres() throws Exception {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));
        projectMemberRepository.save(new ProjectMember(testProject, admin2, ProjectRole.ADMIN));

        assertThat(countAdmins(testProject.getId())).isEqualTo(2);

        int threadCount = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CyclicBarrier barrier = new CyclicBarrier(threadCount);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger rejectedCount = new AtomicInteger(0);
        List<Throwable> unexpectedErrors = Collections.synchronizedList(new ArrayList<>());

        Callable<Void> demoteAdmin1Task = () -> {
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(admin2, null, Collections.emptyList())
            );
            try {
                barrier.await(5, TimeUnit.SECONDS);
                AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin1.getId(), null, ProjectRole.DEVELOPER);
                projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq);
                successCount.incrementAndGet();
            } catch (IllegalArgumentException e) {
                rejectedCount.incrementAndGet();
            } catch (Throwable t) {
                unexpectedErrors.add(t);
            } finally {
                SecurityContextHolder.clearContext();
            }
            return null;
        };

        Callable<Void> removeAdmin2Task = () -> {
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(admin1, null, Collections.emptyList())
            );
            try {
                barrier.await(5, TimeUnit.SECONDS);
                projectMemberService.removeMember(testProject.getId(), admin2.getId());
                successCount.incrementAndGet();
            } catch (IllegalArgumentException e) {
                rejectedCount.incrementAndGet();
            } catch (Throwable t) {
                unexpectedErrors.add(t);
            } finally {
                SecurityContextHolder.clearContext();
            }
            return null;
        };

        List<Future<Void>> futures = executor.invokeAll(List.of(demoteAdmin1Task, removeAdmin2Task));
        for (Future<Void> future : futures) {
            future.get(10, TimeUnit.SECONDS);
        }
        executor.shutdown();
        assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

        assertThat(unexpectedErrors).as("Expected no unexpected exceptions").isEmpty();
        assertThat(successCount.get())
                .as("Exactly one competing admin reduction operation should succeed")
                .isEqualTo(1);
        assertThat(rejectedCount.get())
                .as("The other competing operation must be blocked by the last-admin invariant check")
                .isEqualTo(1);

        long finalAdminCount = countAdmins(testProject.getId());
        assertThat(finalAdminCount)
                .as("The project must retain at least one administrator after concurrent mutations on PostgreSQL")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("5. Invariant maintained after failed or rolled-back mutations on PostgreSQL")
    void invariantMaintainedAfterFailedOrRolledBackMutationsOnPostgres() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));

        assertThatThrownBy(() -> projectMemberService.removeMember(testProject.getId(), admin1.getId()))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(countAdmins(testProject.getId())).isEqualTo(1);

        AddProjectMemberRequest addAdmin2 = new AddProjectMemberRequest(admin2.getId(), null, ProjectRole.ADMIN);
        projectMemberService.addOrUpdateMember(testProject.getId(), addAdmin2);
        assertThat(countAdmins(testProject.getId())).isEqualTo(2);

        projectMemberService.removeMember(testProject.getId(), admin1.getId());
        assertThat(countAdmins(testProject.getId())).isEqualTo(1);

        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin2, null, Collections.emptyList())
        );

        assertThatThrownBy(() -> projectMemberService.removeMember(testProject.getId(), admin2.getId()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(countAdmins(testProject.getId())).isEqualTo(1);
    }
}
