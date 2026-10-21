import type { ProjectRole, ProjectMemberResponseDto } from '../types';

export const KNOWN_PROJECT_ROLES: readonly ProjectRole[] = ['ADMIN', 'DEVELOPER', 'VIEWER'] as const;

/**
 * Type guard verifying if a value matches a valid backend ProjectRole.
 */
export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (KNOWN_PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * Strongly-typed client-side capabilities model evaluated from verified backend membership.
 */
export interface ProjectPermissions {
  readonly role: ProjectRole | null;
  readonly canRead: boolean;
  readonly canEditWorkflows: boolean;
  readonly canExecuteRuns: boolean;
  readonly canManageMembers: boolean;
  readonly canDeleteProject: boolean;
  readonly isLoading: boolean;
  readonly isLoaded: boolean;
  readonly error: string | null;
}

/**
 * Closed, fail-safe permission object used when role is unknown, missing, loading, or unauthorized.
 */
export const FAIL_CLOSED_PERMISSIONS: ProjectPermissions = Object.freeze({
  role: null,
  canRead: false,
  canEditWorkflows: false,
  canExecuteRuns: false,
  canManageMembers: false,
  canDeleteProject: false,
  isLoading: false,
  isLoaded: false,
  error: null,
});

/**
 * Computes the unified permission set for a project based on the user's verified role.
 * Any missing, unknown, malformed, or error state fails closed with zero privileged capabilities.
 *
 * @param role The verified project role, or null/undefined
 * @param isLoading Whether membership data is currently resolving
 * @param error Any error message encountered while fetching membership
 * @returns Fully resolved ProjectPermissions model
 */
export function computeProjectPermissions(
  role: ProjectRole | null | undefined,
  isLoading = false,
  error: string | null = null
): ProjectPermissions {
  if (isLoading) {
    return {
      role: null,
      canRead: false,
      canEditWorkflows: false,
      canExecuteRuns: false,
      canManageMembers: false,
      canDeleteProject: false,
      isLoading: true,
      isLoaded: false,
      error: null,
    };
  }

  if (error || !role || !isProjectRole(role)) {
    return {
      role: null,
      canRead: false,
      canEditWorkflows: false,
      canExecuteRuns: false,
      canManageMembers: false,
      canDeleteProject: false,
      isLoading: false,
      isLoaded: false,
      error: error || (role ? 'Unrecognized role' : null),
    };
  }

  switch (role) {
    case 'ADMIN':
      return {
        role: 'ADMIN',
        canRead: true,
        canEditWorkflows: true,
        canExecuteRuns: true,
        canManageMembers: true,
        canDeleteProject: true,
        isLoading: false,
        isLoaded: true,
        error: null,
      };

    case 'DEVELOPER':
      return {
        role: 'DEVELOPER',
        canRead: true,
        canEditWorkflows: true,
        canExecuteRuns: true,
        canManageMembers: false,
        canDeleteProject: false,
        isLoading: false,
        isLoaded: true,
        error: null,
      };

    case 'VIEWER':
      return {
        role: 'VIEWER',
        canRead: true,
        canEditWorkflows: false,
        canExecuteRuns: false,
        canManageMembers: false,
        canDeleteProject: false,
        isLoading: false,
        isLoaded: true,
        error: null,
      };

    default:
      // Fail closed
      return {
        ...FAIL_CLOSED_PERMISSIONS,
        error: 'Unsupported project role',
      };
  }
}

/**
 * Resolves the authenticated user's role within a project from the server-returned members list.
 *
 * @param members List of project members returned by backend GET /projects/{id}/members
 * @param currentUser Authenticated user profile with id and email
 * @returns The matched ProjectRole, or null if the user is not a confirmed member
 */
export function resolveUserRoleFromMembers(
  members: ProjectMemberResponseDto[] | null | undefined,
  currentUser: { id?: string; email?: string } | null | undefined
): ProjectRole | null {
  if (!Array.isArray(members) || !currentUser) {
    return null;
  }

  const userId = currentUser.id ? currentUser.id.toLowerCase() : null;
  const userEmail = currentUser.email ? currentUser.email.trim().toLowerCase() : null;

  const matched = members.find((m) => {
    if (userId && m.userId && m.userId.toLowerCase() === userId) {
      return true;
    }
    if (userEmail && m.email && m.email.trim().toLowerCase() === userEmail) {
      return true;
    }
    return false;
  });

  if (matched && isProjectRole(matched.role)) {
    return matched.role;
  }

  return null;
}

/**
 * Counts the number of active project administrators in a membership list.
 */
export function countProjectAdmins(members: ProjectMemberResponseDto[] | null | undefined): number {
  if (!Array.isArray(members)) return 0;
  return members.filter((m) => m.role === 'ADMIN').length;
}

/**
 * Client-side usability safeguard checking if an operation would demote or remove the last known admin.
 * NOTE: This is a frontend usability safeguard only; the backend remains the authoritative boundary.
 */
export function canSafelyDemoteOrRemove(
  members: ProjectMemberResponseDto[] | null | undefined,
  targetUserId: string,
  newRole?: ProjectRole
): { allowed: boolean; reason?: string } {
  if (!Array.isArray(members)) {
    return { allowed: true };
  }

  const targetMember = members.find((m) => m.userId === targetUserId);
  if (!targetMember || targetMember.role !== 'ADMIN') {
    return { allowed: true };
  }

  const adminCount = countProjectAdmins(members);
  const isDemotion = newRole !== undefined && newRole !== 'ADMIN';
  const isRemoval = newRole === undefined;

  if ((isDemotion || isRemoval) && adminCount <= 1) {
    return {
      allowed: false,
      reason: isDemotion
        ? 'Cannot demote the only administrator of the project'
        : 'Cannot remove the only administrator of the project',
    };
  }

  return { allowed: true };
}
