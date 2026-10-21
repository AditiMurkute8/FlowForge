package com.flowforge.service;

import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.service.exception.ResourceNotFoundException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * Centralized authorization service enforcing project-scoped Role-Based Access Control (RBAC).
 * Resolves authenticated user identity from the server-side SecurityContext,
 * guards resource existence against unauthorized discovery (returning 404 for non-members),
 * and enforces role constraints (returning 403 for insufficient privileges).
 */
@Service
public class ProjectAuthorizationService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;

    public ProjectAuthorizationService(ProjectRepository projectRepository,
                                       ProjectMemberRepository projectMemberRepository) {
        this.projectRepository = Objects.requireNonNull(projectRepository, "ProjectRepository must not be null");
        this.projectMemberRepository = Objects.requireNonNull(projectMemberRepository, "ProjectMemberRepository must not be null");
    }

    /**
     * Resolves the current authenticated User domain entity from the Spring SecurityContext.
     */
    public Optional<User> getCurrentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            return Optional.empty();
        }
        Object principal = auth.getPrincipal();
        if (principal instanceof User user) {
            return Optional.of(user);
        }
        return Optional.empty();
    }

    /**
     * Requires an authenticated User; throws AuthenticationCredentialsNotFoundException if absent.
     */
    public User requireCurrentUser() {
        return getCurrentUser().orElseThrow(() ->
            new AuthenticationCredentialsNotFoundException("User must be authenticated to access this resource")
        );
    }

    /**
     * Enforces that the current authenticated user is an active member of the specified project
     * and holds a role satisfying the given predicate.
     *
     * Anti-leakage rule:
     * - If the project does not exist OR the user is not a member of the project, returns 404 Not Found.
     * - If the user is a confirmed member but lacks the required permission, returns 403 Forbidden.
     */
    public ProjectMember requireProjectRole(UUID projectId, Predicate<ProjectRole> rolePredicate, String actionDescription) {
        if (projectId == null) {
            throw new ResourceNotFoundException("Project not found: null");
        }

        // Verify project existence in repository
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project not found: " + projectId);
        }

        User user = requireCurrentUser();
        Optional<ProjectMember> memberOpt = projectMemberRepository.findByProjectIdAndUserId(projectId, user.getId());

        if (memberOpt.isEmpty()) {
            // Anti-leakage: non-members receive generic 404 to avoid resource-existence probing
            throw new ResourceNotFoundException("Project not found: " + projectId);
        }

        ProjectMember member = memberOpt.get();
        if (!rolePredicate.test(member.getRole())) {
            // Confirmed members with insufficient privileges receive 403 Forbidden
            throw new AccessDeniedException(
                "User role '" + member.getRole() + "' is not permitted to " + actionDescription + " in project " + projectId
            );
        }

        return member;
    }

    public ProjectMember requireReadAccess(UUID projectId) {
        return requireProjectRole(projectId, ProjectRole::canRead, "read resources");
    }

    public ProjectMember requireEditAccess(UUID projectId) {
        return requireProjectRole(projectId, ProjectRole::canEdit, "create or modify resources");
    }

    public ProjectMember requireExecuteAccess(UUID projectId) {
        return requireProjectRole(projectId, ProjectRole::canExecute, "execute workflows");
    }

    public ProjectMember requireAdminAccess(UUID projectId) {
        return requireProjectRole(projectId, ProjectRole::canManageMembers, "perform administrative operations");
    }
}
