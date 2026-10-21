import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectMembershipManager } from './useProjectMembership';
import type { ProjectMemberResponseDto } from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';

describe('ProjectMembershipManager & RBAC Lifecycle', () => {
  const mockUser = {
    id: 'user-current-id',
    email: 'current@flowforge.io',
    fullName: 'Current User',
  };

  const adminMember: ProjectMemberResponseDto = {
    id: 'pm-1',
    projectId: 'proj-1',
    userId: 'user-current-id',
    email: 'current@flowforge.io',
    fullName: 'Current User',
    role: 'ADMIN',
    createdAt: '2026-10-20T10:00:00Z',
  };

  const developerMember: ProjectMemberResponseDto = {
    ...adminMember,
    role: 'DEVELOPER',
  };

  const viewerMember: ProjectMemberResponseDto = {
    ...adminMember,
    role: 'VIEWER',
  };

  const otherAdminMember: ProjectMemberResponseDto = {
    id: 'pm-2',
    projectId: 'proj-1',
    userId: 'user-other-id',
    email: 'other@flowforge.io',
    fullName: 'Other Admin',
    role: 'ADMIN',
    createdAt: '2026-10-20T10:30:00Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves ADMIN role and full capabilities when user is verified admin', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([adminMember]);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-1', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBe('ADMIN');
    expect(snapshot.permissions.canRead).toBe(true);
    expect(snapshot.permissions.canEditWorkflows).toBe(true);
    expect(snapshot.permissions.canExecuteRuns).toBe(true);
    expect(snapshot.permissions.canManageMembers).toBe(true);
    expect(snapshot.permissions.canDeleteProject).toBe(true);
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.error).toBeNull();
  });

  it('resolves DEVELOPER role with edit and run capabilities but denies admin operations', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([developerMember]);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-1', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBe('DEVELOPER');
    expect(snapshot.permissions.canRead).toBe(true);
    expect(snapshot.permissions.canEditWorkflows).toBe(true);
    expect(snapshot.permissions.canExecuteRuns).toBe(true);
    expect(snapshot.permissions.canManageMembers).toBe(false);
    expect(snapshot.permissions.canDeleteProject).toBe(false);
  });

  it('resolves VIEWER role with read-only capabilities and blocks all mutations', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([viewerMember]);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-1', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBe('VIEWER');
    expect(snapshot.permissions.canRead).toBe(true);
    expect(snapshot.permissions.canEditWorkflows).toBe(false);
    expect(snapshot.permissions.canExecuteRuns).toBe(false);
    expect(snapshot.permissions.canManageMembers).toBe(false);
    expect(snapshot.permissions.canDeleteProject).toBe(false);
  });

  it('fails closed when user is unauthenticated or projectId is null', async () => {
    const fetchMembersFn = vi.fn();
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load(null, mockUser, true);
    expect(manager.getSnapshot().role).toBeNull();
    expect(manager.getSnapshot().permissions.canRead).toBe(false);

    await manager.load('proj-1', null, false);
    expect(manager.getSnapshot().role).toBeNull();
    expect(manager.getSnapshot().permissions.canRead).toBe(false);

    expect(fetchMembersFn).not.toHaveBeenCalled();
  });

  it('fails closed when user is not found in project membership list', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([otherAdminMember]);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-1', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBeNull();
    expect(snapshot.permissions.canRead).toBe(false);
    expect(snapshot.permissions.canEditWorkflows).toBe(false);
    expect(snapshot.permissions.canExecuteRuns).toBe(false);
    expect(snapshot.permissions.canManageMembers).toBe(false);
  });

  it('fails closed when backend returns 404 (non-member anti-leakage or non-existent project)', async () => {
    const notFoundError = new FlowForgeApiError(404, 'Project not found: proj-secret');
    const fetchMembersFn = vi.fn().mockRejectedValue(notFoundError);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-secret', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBeNull();
    expect(snapshot.permissions.canRead).toBe(false);
    expect(snapshot.error).toBe('Project not found or you are not a member of this project.');
  });

  it('fails closed when backend returns 403 Forbidden', async () => {
    const forbiddenError = new FlowForgeApiError(403, 'Forbidden');
    const fetchMembersFn = vi.fn().mockRejectedValue(forbiddenError);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-1', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBeNull();
    expect(snapshot.permissions.canRead).toBe(false);
    expect(snapshot.error).toBe(
      'Access denied: You do not have permission to view members of this project.'
    );
  });

  it('fails closed on network failure or 500 server error', async () => {
    const netError = new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
    const fetchMembersFn = vi.fn().mockRejectedValue(netError);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    await manager.load('proj-1', mockUser, true);

    const snapshot = manager.getSnapshot();
    expect(snapshot.role).toBeNull();
    expect(snapshot.permissions.canRead).toBe(false);
    expect(snapshot.error).toContain('Network failure');
  });

  it('prevents stale responses from overwriting active state when switching projects', async () => {
    let resolveFirst: (val: ProjectMemberResponseDto[]) => void = () => {};
    const firstPromise = new Promise<ProjectMemberResponseDto[]>((resolve) => {
      resolveFirst = resolve;
    });

    const fetchMembersFn = vi.fn().mockImplementation((id: string) => {
      if (id === 'proj-first') {
        return firstPromise;
      }
      return Promise.resolve([developerMember]);
    });

    const manager = new ProjectMembershipManager({ fetchMembersFn });

    // Start loading first project
    const load1 = manager.load('proj-first', mockUser, true);

    // Immediately start loading second project
    const load2 = manager.load('proj-second', mockUser, true);
    await load2;

    expect(manager.getSnapshot().role).toBe('DEVELOPER');

    // Late resolution of first project
    resolveFirst([adminMember]);
    await load1;

    // Must remain DEVELOPER from second project, NOT overwritten!
    expect(manager.getSnapshot().role).toBe('DEVELOPER');
  });

  it('prevents duplicate mutation requests when a mutation is in flight', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([adminMember, otherAdminMember]);
    let resolveAdd: (val: ProjectMemberResponseDto) => void = () => {};
    const addPromise = new Promise<ProjectMemberResponseDto>((resolve) => {
      resolveAdd = resolve;
    });
    const addOrUpdateFn = vi.fn().mockReturnValue(addPromise);

    const manager = new ProjectMembershipManager({ fetchMembersFn, addOrUpdateFn });
    await manager.load('proj-1', mockUser, true);

    // Fire first add
    const firstCall = manager.addOrUpdateMember({ email: 'new@flowforge.io', role: 'DEVELOPER' });

    // Immediate second add call should be rejected
    await expect(
      manager.addOrUpdateMember({ email: 'dup@flowforge.io', role: 'DEVELOPER' })
    ).rejects.toThrow('A membership mutation is already in progress');

    resolveAdd({
      id: 'pm-3',
      projectId: 'proj-1',
      userId: 'u-3',
      email: 'new@flowforge.io',
      fullName: 'New',
      role: 'DEVELOPER',
      createdAt: '2026-10-21T10:00:00Z',
    });

    await firstCall;
    expect(addOrUpdateFn).toHaveBeenCalledTimes(1);
  });

  it('client-side usability safeguard blocks attempting to remove or demote the sole administrator', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([adminMember]);
    const addOrUpdateFn = vi.fn();
    const removeFn = vi.fn();

    const manager = new ProjectMembershipManager({ fetchMembersFn, addOrUpdateFn, removeFn });
    await manager.load('proj-1', mockUser, true);

    // Demotion attempt
    await expect(
      manager.addOrUpdateMember({ userId: adminMember.userId, role: 'DEVELOPER' })
    ).rejects.toThrow('Cannot demote the only administrator of the project');

    expect(addOrUpdateFn).not.toHaveBeenCalled();

    // Removal attempt
    await expect(manager.removeMember(adminMember.userId)).rejects.toThrow(
      'Cannot remove the only administrator of the project'
    );

    expect(removeFn).not.toHaveBeenCalled();
  });

  it('allows removing or demoting an administrator when multiple administrators exist', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([adminMember, otherAdminMember]);
    const addOrUpdateFn = vi.fn().mockResolvedValue({ ...adminMember, role: 'DEVELOPER' });
    const removeFn = vi.fn().mockResolvedValue(undefined);

    const manager = new ProjectMembershipManager({ fetchMembersFn, addOrUpdateFn, removeFn });
    await manager.load('proj-1', mockUser, true);

    // Demotion is allowed because otherAdminMember exists
    await manager.addOrUpdateMember({ userId: adminMember.userId, role: 'DEVELOPER' });
    expect(addOrUpdateFn).toHaveBeenCalledWith('proj-1', {
      userId: adminMember.userId,
      role: 'DEVELOPER',
    });

    // Removal is allowed
    await manager.removeMember(adminMember.userId);
    expect(removeFn).toHaveBeenCalledWith('proj-1', adminMember.userId);
  });

  it('refreshes membership list automatically after successful addOrUpdate or remove', async () => {
    let callCount = 0;
    const fetchMembersFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? [adminMember, otherAdminMember] : [otherAdminMember];
    });

    const removeFn = vi.fn().mockResolvedValue(undefined);
    const manager = new ProjectMembershipManager({ fetchMembersFn, removeFn });

    await manager.load('proj-1', mockUser, true);
    expect(manager.getSnapshot().members).toHaveLength(2);

    await manager.removeMember(adminMember.userId);

    expect(fetchMembersFn).toHaveBeenCalledTimes(2);
    expect(manager.getSnapshot().members).toHaveLength(1);
  });

  it('notifies subscribers upon state transitions', async () => {
    const fetchMembersFn = vi.fn().mockResolvedValue([adminMember]);
    const manager = new ProjectMembershipManager({ fetchMembersFn });

    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    await manager.load('proj-1', mockUser, true);
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();

    await manager.load('proj-1', mockUser, true);
    expect(listener).not.toHaveBeenCalled();
  });
});
