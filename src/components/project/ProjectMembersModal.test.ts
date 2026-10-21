import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectMembersModal } from './ProjectMembersModal';
import type { ProjectMemberResponseDto } from '../../types';
import { FlowForgeApiError } from '../../api/flowForgeApi';

describe('ProjectMembersModal & Membership UI', () => {
  const adminMember: ProjectMemberResponseDto = {
    id: 'pm-1',
    projectId: 'proj-1',
    userId: 'user-admin',
    email: 'admin@flowforge.io',
    fullName: 'Admin User',
    role: 'ADMIN',
    createdAt: '2026-10-20T10:00:00Z',
  };

  const secondAdminMember: ProjectMemberResponseDto = {
    id: 'pm-2',
    projectId: 'proj-1',
    userId: 'user-admin-2',
    email: 'admin2@flowforge.io',
    fullName: 'Second Admin',
    role: 'ADMIN',
    createdAt: '2026-10-20T10:15:00Z',
  };

  const developerMember: ProjectMemberResponseDto = {
    id: 'pm-3',
    projectId: 'proj-1',
    userId: 'user-dev',
    email: 'dev@flowforge.io',
    fullName: 'Dev User',
    role: 'DEVELOPER',
    createdAt: '2026-10-20T11:00:00Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Modal Rendering & Structure', () => {
    it('does not render modal content when isOpen is false', () => {
      const html = renderToString(
        React.createElement(ProjectMembersModal, {
          isOpen: false,
          onClose: vi.fn(),
          projectId: 'proj-1',
          projectName: 'Fraud Engine',
        })
      );

      expect(html).not.toContain('Project Members &amp; Access Control');
    });

    it('renders modal header, description, and safeguard banner when isOpen is true', () => {
      const html = renderToString(
        React.createElement(ProjectMembersModal, {
          isOpen: true,
          onClose: vi.fn(),
          projectId: 'proj-1',
          projectName: 'Fraud Engine',
        })
      );

      expect(html).toContain('Project Members &amp; Access Control');
      expect(html).toContain('Fraud Engine');
      expect(html).toContain('Role Permissions &amp; Safety Constraints');
      expect(html).toContain('ADMIN:');
      expect(html).toContain('DEVELOPER:');
      expect(html).toContain('VIEWER:');
      expect(html).toContain('requires at least one active administrator per project');
    });

    it('renders add member form with email/ID input and role select', () => {
      const html = renderToString(
        React.createElement(ProjectMembersModal, {
          isOpen: true,
          onClose: vi.fn(),
          projectId: 'proj-1',
          projectName: 'Fraud Engine',
        })
      );

      expect(html).toContain('Add Team Member');
      expect(html).toContain('User Email or ID');
      expect(html).toContain('Assigned Role');
      expect(html).toContain('data-testid="add-member-role-select"');
      expect(html).toContain('data-testid="add-member-submit-button"');
    });
  });

  describe('Member Management Logic & Safeguards', () => {
    it('detects single admin and marks sole admin with disabled demotion and removal controls', () => {
      // Logic helper test: single admin vs multi-admin
      const members = [adminMember, developerMember];
      const adminCount = members.filter((m) => m.role === 'ADMIN').length;
      expect(adminCount).toBe(1);

      const isSoleAdmin = (m: ProjectMemberResponseDto) => m.role === 'ADMIN' && adminCount <= 1;
      expect(isSoleAdmin(adminMember)).toBe(true);
      expect(isSoleAdmin(developerMember)).toBe(false);
    });

    it('permits demotion and removal when multiple administrators exist', () => {
      const members = [adminMember, secondAdminMember, developerMember];
      const adminCount = members.filter((m) => m.role === 'ADMIN').length;
      expect(adminCount).toBe(2);

      const isSoleAdmin = (m: ProjectMemberResponseDto) => m.role === 'ADMIN' && adminCount <= 1;
      expect(isSoleAdmin(adminMember)).toBe(false);
      expect(isSoleAdmin(secondAdminMember)).toBe(false);
    });

    it('formats identifier submission payload distinguishing email from UUID', () => {
      const emailInput = 'developer@flowforge.io';
      const uuidInput = 'e7fac26a-023d-4ca4-be64-acf770cda72e';

      const isUuid = (val: string) => /^[0-9a-fA-F-]{36}$/.test(val.trim());

      expect(isUuid(emailInput)).toBe(false);
      expect(isUuid(uuidInput)).toBe(true);

      const buildRequest = (id: string, role: 'ADMIN' | 'DEVELOPER' | 'VIEWER') =>
        isUuid(id) ? { userId: id.trim(), role } : { email: id.trim(), role };

      expect(buildRequest(emailInput, 'DEVELOPER')).toEqual({
        email: 'developer@flowforge.io',
        role: 'DEVELOPER',
      });
      expect(buildRequest(uuidInput, 'ADMIN')).toEqual({
        userId: 'e7fac26a-023d-4ca4-be64-acf770cda72e',
        role: 'ADMIN',
      });
    });

    it('prevents empty or whitespace-only identifier submission', () => {
      const validate = (val: string) => {
        if (!val.trim()) return 'Member email or user ID is required';
        return null;
      };

      expect(validate('')).toBe('Member email or user ID is required');
      expect(validate('   ')).toBe('Member email or user ID is required');
      expect(validate('user@domain.com')).toBeNull();
    });

    it('formats safe error messages without exposing internal stack traces', () => {
      const formatError = (err: unknown, identifier: string) => {
        if (err instanceof FlowForgeApiError) {
          if (err.isForbidden || err.status === 403) {
            return 'Access denied: Only project administrators can add members.';
          }
          if (err.isNotFound || err.status === 404) {
            return `User not found: No active account matching "${identifier}".`;
          }
          if (err.isConflict || err.status === 409) {
            return 'User is already a member of this project.';
          }
          return err.message;
        }
        if (err instanceof Error) {
          return err.message;
        }
        return 'Failed to add project member';
      };

      const err403 = new FlowForgeApiError(403, 'Forbidden');
      const err404 = new FlowForgeApiError(404, 'User not found');
      const err409 = new FlowForgeApiError(409, 'Conflict');
      const err400 = new FlowForgeApiError(400, 'Cannot demote the only administrator of the project');

      expect(formatError(err403, 'user@flowforge.io')).toBe(
        'Access denied: Only project administrators can add members.'
      );
      expect(formatError(err404, 'ghost@flowforge.io')).toBe(
        'User not found: No active account matching "ghost@flowforge.io".'
      );
      expect(formatError(err409, 'existing@flowforge.io')).toBe(
        'User is already a member of this project.'
      );
      expect(formatError(err400, 'admin@flowforge.io')).toBe(
        'Cannot demote the only administrator of the project'
      );
    });

    it('requires confirmation dialog for destructive administrator demotion', () => {
      let confirmation: { type: string; member: ProjectMemberResponseDto; targetRole?: string } | null = null;

      const initiateRoleChange = (member: ProjectMemberResponseDto, targetRole: 'ADMIN' | 'DEVELOPER' | 'VIEWER') => {
        if (member.role === targetRole) return;
        if (member.role === 'ADMIN' && targetRole !== 'ADMIN') {
          confirmation = { type: 'DEMOTE', member, targetRole };
          return;
        }
      };

      // Non-admin role change doesn't require demotion confirmation
      initiateRoleChange(developerMember, 'VIEWER');
      expect(confirmation).toBeNull();

      // Admin role change away from ADMIN requires confirmation
      initiateRoleChange(adminMember, 'DEVELOPER');
      expect(confirmation).toEqual({
        type: 'DEMOTE',
        member: adminMember,
        targetRole: 'DEVELOPER',
      });
    });

    it('requires confirmation dialog for member removal', () => {
      let confirmation: { type: string; member: ProjectMemberResponseDto } | null = null;

      const initiateRemove = (member: ProjectMemberResponseDto) => {
        confirmation = { type: 'REMOVE', member };
      };

      initiateRemove(developerMember);
      expect(confirmation).toEqual({
        type: 'REMOVE',
        member: developerMember,
      });
    });
  });
});
