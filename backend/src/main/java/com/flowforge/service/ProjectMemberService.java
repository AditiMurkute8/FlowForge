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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Service managing project membership and role assignments.
 * Enforces admin-only authorization for membership mutations and prevents
 * removing the sole administrator of a project.
 */
@Service
@Transactional(readOnly = true)
public class ProjectMemberService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final UserRepository userRepository;
    private final ProjectAuthorizationService authorizationService;

    public ProjectMemberService(
        ProjectRepository projectRepository,
        ProjectMemberRepository projectMemberRepository,
        UserRepository userRepository,
        ProjectAuthorizationService authorizationService
    ) {
        this.projectRepository = Objects.requireNonNull(projectRepository, "ProjectRepository must not be null");
        this.projectMemberRepository = Objects.requireNonNull(projectMemberRepository, "ProjectMemberRepository must not be null");
        this.userRepository = Objects.requireNonNull(userRepository, "UserRepository must not be null");
        this.authorizationService = Objects.requireNonNull(authorizationService, "ProjectAuthorizationService must not be null");
    }

    /**
     * Lists all members of a project.
     * Permitted for VIEWER, DEVELOPER, and ADMIN members.
     */
    public List<ProjectMemberResponse> listMembers(UUID projectId) {
        authorizationService.requireReadAccess(projectId);
        List<ProjectMember> members = projectMemberRepository.findByProjectId(projectId);
        return members.stream()
            .map(ProjectMemberResponse::fromEntity)
            .toList();
    }

    /**
     * Adds a user to a project with the specified role or updates their existing role.
     * Permitted strictly for ADMIN members.
     */
    @Transactional
    public ProjectMemberResponse addOrUpdateMember(UUID projectId, AddProjectMemberRequest request) {
        authorizationService.requireAdminAccess(projectId);

        // Acquire pessimistic write lock on the project to serialize membership mutations per project
        Project project = projectRepository.findByIdWithPessimisticLock(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + projectId));

        User targetUser;
        if (request.userId() != null) {
            targetUser = userRepository.findById(request.userId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found: " + request.userId()));
        } else if (request.email() != null && !request.email().isBlank()) {
            String normalizedEmail = User.normalizeEmail(request.email());
            targetUser = userRepository.findByEmailIgnoreCase(normalizedEmail)
                .orElseThrow(() -> new ResourceNotFoundException("User not found with email: " + normalizedEmail));
        } else {
            throw new IllegalArgumentException("Either userId or email must be provided to add a project member");
        }

        if (!targetUser.isActive()) {
            throw new IllegalArgumentException("Cannot add deactivated user to project: " + targetUser.getEmail());
        }

        Optional<ProjectMember> existingMemberOpt = projectMemberRepository.findByProjectIdAndUserId(projectId, targetUser.getId());
        ProjectMember member;
        if (existingMemberOpt.isPresent()) {
            member = existingMemberOpt.get();
            if (member.getRole() == ProjectRole.ADMIN && request.role() != ProjectRole.ADMIN) {
                if (countProjectAdmins(projectId) <= 1) {
                    throw new IllegalArgumentException("Cannot demote the only administrator of the project");
                }
            }
            member.setRole(request.role());
        } else {
            member = new ProjectMember(project, targetUser, request.role());
        }

        ProjectMember saved = projectMemberRepository.save(member);
        return ProjectMemberResponse.fromEntity(saved);
    }

    /**
     * Removes a member from a project.
     * Permitted strictly for ADMIN members. Rejects removing the last remaining ADMIN.
     */
    @Transactional
    public void removeMember(UUID projectId, UUID userId) {
        authorizationService.requireAdminAccess(projectId);

        // Acquire pessimistic write lock on the project to serialize membership mutations per project
        projectRepository.findByIdWithPessimisticLock(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + projectId));

        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
            .orElseThrow(() -> new ResourceNotFoundException("Member not found in project: " + userId));

        if (member.getRole() == ProjectRole.ADMIN) {
            if (countProjectAdmins(projectId) <= 1) {
                throw new IllegalArgumentException("Cannot remove the only administrator of the project");
            }
        }

        projectMemberRepository.delete(member);
    }

    private long countProjectAdmins(UUID projectId) {
        long count = projectMemberRepository.countByProjectIdAndRole(projectId, ProjectRole.ADMIN);
        if (count > 0) {
            return count;
        }
        return projectMemberRepository.findByProjectId(projectId).stream()
            .filter(m -> m.getRole() == ProjectRole.ADMIN)
            .count();
    }
}
