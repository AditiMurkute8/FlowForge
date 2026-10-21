package com.flowforge.service;

import com.flowforge.api.dto.AddProjectMemberRequest;
import com.flowforge.domain.Project;
import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Concurrency and transactional boundary tests for ProjectMemberService.
 * Validates that pessimistic locking on the parent Project entity prevents
 * concurrent administrative demotions or removals from leaving zero administrators.
 */
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
class ProjectMemberConcurrencyTest {

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

        testProject = projectRepository.save(new Project("Concurrency Project", "concurrency-proj", "Test project"));

        admin1 = userRepository.save(new User("admin1@flowforge.internal", "hash1", "Admin One"));
        admin2 = userRepository.save(new User("admin2@flowforge.internal", "hash2", "Admin Two"));

        // Authenticate admin1 by default in main thread
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(admin1, null, List.of())
        );
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        projectMemberRepository.deleteAll();
        projectRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    @DisplayName("1. A sole administrator cannot be demoted")
    void soleAdmin_cannotBeDemoted() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));

        AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin1.getId(), null, ProjectRole.DEVELOPER);

        assertThatThrownBy(() -> projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Cannot demote the only administrator of the project");

        // Verify admin1 remains ADMIN
        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(testProject.getId(), admin1.getId()).orElseThrow();
        assertThat(member.getRole()).isEqualTo(ProjectRole.ADMIN);
    }

    @Test
    @DisplayName("2. A sole administrator cannot be removed")
    void soleAdmin_cannotBeRemoved() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));

        assertThatThrownBy(() -> projectMemberService.removeMember(testProject.getId(), admin1.getId()))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Cannot remove the only administrator of the project");

        // Verify admin1 still exists as ADMIN
        boolean exists = projectMemberRepository.existsByProjectIdAndUserId(testProject.getId(), admin1.getId());
        assertThat(exists).isTrue();
    }

    @Test
    @DisplayName("3. A multi-admin project permits a role change while retaining an administrator")
    void multiAdmin_permitsRoleChange_whileRetainingAdmin() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));
        projectMemberRepository.save(new ProjectMember(testProject, admin2, ProjectRole.ADMIN));

        AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin2.getId(), null, ProjectRole.DEVELOPER);
        projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq);

        ProjectMember m2 = projectMemberRepository.findByProjectIdAndUserId(testProject.getId(), admin2.getId()).orElseThrow();
        assertThat(m2.getRole()).isEqualTo(ProjectRole.DEVELOPER);

        // Verify admin1 remains ADMIN
        long adminCount = projectMemberRepository.findByProjectId(testProject.getId()).stream()
            .filter(m -> m.getRole() == ProjectRole.ADMIN)
            .count();
        assertThat(adminCount).isEqualTo(1);
    }

    @Test
    @DisplayName("4. Two concurrent operations attempting to remove or demote final administrators cannot leave zero administrators")
    void concurrentOperations_cannotLeaveZeroAdministrators() throws Exception {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));
        projectMemberRepository.save(new ProjectMember(testProject, admin2, ProjectRole.ADMIN));

        int threadCount = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CyclicBarrier barrier = new CyclicBarrier(threadCount);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger failureCount = new AtomicInteger(0);
        List<Throwable> exceptions = Collections.synchronizedList(new ArrayList<>());

        // Thread 1: attempts to remove admin1
        Callable<Void> task1 = () -> {
            SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin1, null, List.of())
            );
            try {
                barrier.await(5, TimeUnit.SECONDS);
                projectMemberService.removeMember(testProject.getId(), admin1.getId());
                successCount.incrementAndGet();
            } catch (Exception e) {
                failureCount.incrementAndGet();
                exceptions.add(e);
            } finally {
                SecurityContextHolder.clearContext();
            }
            return null;
        };

        // Thread 2: attempts to demote admin2 to DEVELOPER
        Callable<Void> task2 = () -> {
            SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin2, null, List.of())
            );
            try {
                barrier.await(5, TimeUnit.SECONDS);
                AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin2.getId(), null, ProjectRole.DEVELOPER);
                projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq);
                successCount.incrementAndGet();
            } catch (Exception e) {
                failureCount.incrementAndGet();
                exceptions.add(e);
            } finally {
                SecurityContextHolder.clearContext();
            }
            return null;
        };

        List<Future<Void>> futures = executor.invokeAll(List.of(task1, task2));
        for (Future<Void> future : futures) {
            future.get(10, TimeUnit.SECONDS);
        }
        executor.shutdown();

        // Invariant: Exactly ONE succeeded and ONE failed
        assertThat(successCount.get()).isEqualTo(1);
        assertThat(failureCount.get()).isEqualTo(1);

        // The failed exception must be the last-admin guard or concurrency conflict
        assertThat(exceptions).hasSize(1);
        Throwable error = exceptions.get(0);
        assertThat(error)
            .isInstanceOfAny(IllegalArgumentException.class, RuntimeException.class);
        assertThat(error.getMessage())
            .containsAnyOf("Cannot remove the only administrator", "Cannot demote the only administrator", "Concurrent modification");

        // Verify the project strictly retains at least 1 administrator
        long remainingAdmins = projectMemberRepository.findByProjectId(testProject.getId()).stream()
            .filter(m -> m.getRole() == ProjectRole.ADMIN)
            .count();
        assertThat(remainingAdmins).isEqualTo(1);
    }

    @Test
    @DisplayName("5. Invariant is maintained after failed or rolled-back mutations")
    void invariantMaintained_afterFailedOrRolledBackMutations() {
        projectMemberRepository.save(new ProjectMember(testProject, admin1, ProjectRole.ADMIN));

        // Attempt invalid member modification (non-existent user)
        AddProjectMemberRequest invalidUserReq = new AddProjectMemberRequest(UUID.randomUUID(), null, ProjectRole.DEVELOPER);
        assertThatThrownBy(() -> projectMemberService.addOrUpdateMember(testProject.getId(), invalidUserReq))
            .isInstanceOf(RuntimeException.class);

        // Attempt demoting sole admin
        AddProjectMemberRequest demoteReq = new AddProjectMemberRequest(admin1.getId(), null, ProjectRole.VIEWER);
        assertThatThrownBy(() -> projectMemberService.addOrUpdateMember(testProject.getId(), demoteReq))
            .isInstanceOf(IllegalArgumentException.class);

        // Ensure sole admin is completely intact
        List<ProjectMember> members = projectMemberRepository.findByProjectId(testProject.getId());
        assertThat(members).hasSize(1);
        assertThat(members.get(0).getUser().getId()).isEqualTo(admin1.getId());
        assertThat(members.get(0).getRole()).isEqualTo(ProjectRole.ADMIN);
    }
}
