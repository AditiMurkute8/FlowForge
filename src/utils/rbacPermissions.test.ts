import { describe, it, expect } from 'vitest';
import {
  isProjectRole,
  computeProjectPermissions,
  resolveUserRoleFromMembers,
  countProjectAdmins,
  canSafelyDemoteOrRemove,
  FAIL_CLOSED_PERMISSIONS,
} from './rbacPermissions';
import type { ProjectMemberResponseDto } from '../types';

describe('RBAC Permissions Model', () => {
  describe('isProjectRole', () => {
    it('accepts valid roles', () => {
      expect(isProjectRole('ADMIN')).toBe(true);
      expect(isProjectRole('DEVELOPER')).toBe(true);
      expect(isProjectRole('VIEWER')).toBe(true);
    });

    it('rejects invalid or malformed roles', () => {
      expect(isProjectRole('admin')).toBe(false);
      expect(isProjectRole('SUPERADMIN')).toBe(false);
      expect(isProjectRole('')).toBe(false);
      expect(isProjectRole(null)).toBe(false);
      expect(isProjectRole(undefined)).toBe(false);
      expect(isProjectRole(123)).toBe(false);
    });
  });

  describe('computeProjectPermissions', () => {
    it('grants full administrative capabilities to ADMIN', () => {
      const perms = computeProjectPermissions('ADMIN');
      expect(perms.role).toBe('ADMIN');
      expect(perms.canRead).toBe(true);
      expect(perms.canEditWorkflows).toBe(true);
      expect(perms.canExecuteRuns).toBe(true);
      expect(perms.canManageMembers).toBe(true);
      expect(perms.canDeleteProject).toBe(true);
      expect(perms.isLoading).toBe(false);
      expect(perms.isLoaded).toBe(true);
      expect(perms.error).toBeNull();
    });

    it('grants workflow mutation and execution to DEVELOPER but denies admin actions', () => {
      const perms = computeProjectPermissions('DEVELOPER');
      expect(perms.role).toBe('DEVELOPER');
      expect(perms.canRead).toBe(true);
      expect(perms.canEditWorkflows).toBe(true);
      expect(perms.canExecuteRuns).toBe(true);
      expect(perms.canManageMembers).toBe(false);
      expect(perms.canDeleteProject).toBe(false);
      expect(perms.isLoading).toBe(false);
      expect(perms.isLoaded).toBe(true);
      expect(perms.error).toBeNull();
    });

    it('grants read-only access to VIEWER and denies all mutations and executions', () => {
      const perms = computeProjectPermissions('VIEWER');
      expect(perms.role).toBe('VIEWER');
      expect(perms.canRead).toBe(true);
      expect(perms.canEditWorkflows).toBe(false);
      expect(perms.canExecuteRuns).toBe(false);
      expect(perms.canManageMembers).toBe(false);
      expect(perms.canDeleteProject).toBe(false);
      expect(perms.isLoading).toBe(false);
      expect(perms.isLoaded).toBe(true);
      expect(perms.error).toBeNull();
    });

    it('fails closed when loading is true', () => {
      const perms = computeProjectPermissions('ADMIN', true);
      expect(perms.role).toBeNull();
      expect(perms.canRead).toBe(false);
      expect(perms.canEditWorkflows).toBe(false);
      expect(perms.canExecuteRuns).toBe(false);
      expect(perms.canManageMembers).toBe(false);
      expect(perms.canDeleteProject).toBe(false);
      expect(perms.isLoading).toBe(true);
      expect(perms.isLoaded).toBe(false);
      expect(perms.error).toBeNull();
    });

    it('fails closed when role is null or undefined', () => {
      const permsNull = computeProjectPermissions(null);
      expect(permsNull.canRead).toBe(false);
      expect(permsNull.canEditWorkflows).toBe(false);
      expect(permsNull.canExecuteRuns).toBe(false);
      expect(permsNull.canManageMembers).toBe(false);
      expect(permsNull.canDeleteProject).toBe(false);
      expect(permsNull.isLoaded).toBe(false);

      const permsUndef = computeProjectPermissions(undefined);
      expect(permsUndef.canRead).toBe(false);
      expect(permsUndef.isLoaded).toBe(false);
    });

    it('fails closed on unknown or malformed role data', () => {
      // @ts-expect-error testing invalid role
      const perms = computeProjectPermissions('GUEST');
      expect(perms.role).toBeNull();
      expect(perms.canRead).toBe(false);
      expect(perms.canEditWorkflows).toBe(false);
      expect(perms.canExecuteRuns).toBe(false);
      expect(perms.canManageMembers).toBe(false);
      expect(perms.canDeleteProject).toBe(false);
      expect(perms.isLoaded).toBe(false);
      expect(perms.error).toContain('Unrecognized role');
    });

    it('fails closed when an error message is provided', () => {
      const perms = computeProjectPermissions('ADMIN', false, 'Network error');
      expect(perms.role).toBeNull();
      expect(perms.canRead).toBe(false);
      expect(perms.canEditWorkflows).toBe(false);
      expect(perms.canExecuteRuns).toBe(false);
      expect(perms.canManageMembers).toBe(false);
      expect(perms.canDeleteProject).toBe(false);
      expect(perms.isLoaded).toBe(false);
      expect(perms.error).toBe('Network error');
    });

    it('matches FAIL_CLOSED_PERMISSIONS default', () => {
      expect(FAIL_CLOSED_PERMISSIONS.canRead).toBe(false);
      expect(FAIL_CLOSED_PERMISSIONS.canEditWorkflows).toBe(false);
      expect(FAIL_CLOSED_PERMISSIONS.canExecuteRuns).toBe(false);
      expect(FAIL_CLOSED_PERMISSIONS.canManageMembers).toBe(false);
      expect(FAIL_CLOSED_PERMISSIONS.canDeleteProject).toBe(false);
      expect(FAIL_CLOSED_PERMISSIONS.role).toBeNull();
    });
  });

  describe('resolveUserRoleFromMembers', () => {
    const mockMembers: ProjectMemberResponseDto[] = [
      {
        id: 'pm-1',
        projectId: 'proj-1',
        userId: 'user-admin-id',
        email: 'admin@flowforge.io',
        fullName: 'Admin User',
        role: 'ADMIN',
        createdAt: '2026-10-20T10:00:00Z',
      },
      {
        id: 'pm-2',
        projectId: 'proj-1',
        userId: 'user-dev-id',
        email: 'dev@flowforge.io',
        fullName: 'Dev User',
        role: 'DEVELOPER',
        createdAt: '2026-10-20T11:00:00Z',
      },
      {
        id: 'pm-3',
        projectId: 'proj-1',
        userId: 'user-viewer-id',
        email: 'viewer@flowforge.io',
        fullName: 'Viewer User',
        role: 'VIEWER',
        createdAt: '2026-10-20T12:00:00Z',
      },
    ];

    it('resolves role by exact userId match', () => {
      const role = resolveUserRoleFromMembers(mockMembers, {
        id: 'user-admin-id',
        email: 'other@flowforge.io',
      });
      expect(role).toBe('ADMIN');
    });

    it('resolves role by case-insensitive email match when userId differs or is omitted', () => {
      const role = resolveUserRoleFromMembers(mockMembers, {
        id: 'different-id',
        email: 'DEV@FLOWFORGE.IO',
      });
      expect(role).toBe('DEVELOPER');
    });

    it('returns null when user is not present in member list', () => {
      const role = resolveUserRoleFromMembers(mockMembers, {
        id: 'unknown-id',
        email: 'stranger@flowforge.io',
      });
      expect(role).toBeNull();
    });

    it('returns null when user profile is null or undefined', () => {
      expect(resolveUserRoleFromMembers(mockMembers, null)).toBeNull();
      expect(resolveUserRoleFromMembers(mockMembers, undefined)).toBeNull();
    });

    it('returns null when members array is null, undefined, or empty', () => {
      expect(resolveUserRoleFromMembers(null, { id: 'user-admin-id' })).toBeNull();
      expect(resolveUserRoleFromMembers([], { id: 'user-admin-id' })).toBeNull();
    });
  });

  describe('countProjectAdmins and canSafelyDemoteOrRemove', () => {
    const singleAdminMembers: ProjectMemberResponseDto[] = [
      {
        id: 'pm-1',
        projectId: 'proj-1',
        userId: 'admin-1',
        email: 'admin1@flowforge.io',
        fullName: 'Admin 1',
        role: 'ADMIN',
        createdAt: '2026-10-20T10:00:00Z',
      },
      {
        id: 'pm-2',
        projectId: 'proj-1',
        userId: 'dev-1',
        email: 'dev1@flowforge.io',
        fullName: 'Dev 1',
        role: 'DEVELOPER',
        createdAt: '2026-10-20T11:00:00Z',
      },
    ];

    const multiAdminMembers: ProjectMemberResponseDto[] = [
      ...singleAdminMembers,
      {
        id: 'pm-3',
        projectId: 'proj-1',
        userId: 'admin-2',
        email: 'admin2@flowforge.io',
        fullName: 'Admin 2',
        role: 'ADMIN',
        createdAt: '2026-10-20T12:00:00Z',
      },
    ];

    it('counts project admins accurately', () => {
      expect(countProjectAdmins(singleAdminMembers)).toBe(1);
      expect(countProjectAdmins(multiAdminMembers)).toBe(2);
      expect(countProjectAdmins([])).toBe(0);
      expect(countProjectAdmins(null)).toBe(0);
    });

    it('prevents removing the only remaining administrator', () => {
      const check = canSafelyDemoteOrRemove(singleAdminMembers, 'admin-1');
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe('Cannot remove the only administrator of the project');
    });

    it('prevents demoting the only remaining administrator', () => {
      const check = canSafelyDemoteOrRemove(singleAdminMembers, 'admin-1', 'DEVELOPER');
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe('Cannot demote the only administrator of the project');
    });

    it('allows changing role to ADMIN for existing admin even if single admin', () => {
      const check = canSafelyDemoteOrRemove(singleAdminMembers, 'admin-1', 'ADMIN');
      expect(check.allowed).toBe(true);
    });

    it('allows removing or demoting an admin when multiple admins exist', () => {
      const checkRemove = canSafelyDemoteOrRemove(multiAdminMembers, 'admin-1');
      expect(checkRemove.allowed).toBe(true);

      const checkDemote = canSafelyDemoteOrRemove(multiAdminMembers, 'admin-1', 'VIEWER');
      expect(checkDemote.allowed).toBe(true);
    });

    it('allows removing or demoting non-admin members freely', () => {
      const checkRemove = canSafelyDemoteOrRemove(singleAdminMembers, 'dev-1');
      expect(checkRemove.allowed).toBe(true);

      const checkDemote = canSafelyDemoteOrRemove(singleAdminMembers, 'dev-1', 'VIEWER');
      expect(checkDemote.allowed).toBe(true);
    });
  });
});
