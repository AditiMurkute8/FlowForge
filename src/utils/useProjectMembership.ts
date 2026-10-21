import { useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import type {
  ProjectRole,
  ProjectMemberResponseDto,
  AddProjectMemberRequest,
} from '../types';
import {
  fetchProjectMembers as defaultFetchMembers,
  addOrUpdateProjectMember as defaultAddOrUpdateMember,
  removeProjectMember as defaultRemoveMember,
  FlowForgeApiError,
} from '../api/flowForgeApi';
import {
  computeProjectPermissions,
  resolveUserRoleFromMembers,
  canSafelyDemoteOrRemove,
  type ProjectPermissions,
  FAIL_CLOSED_PERMISSIONS,
} from './rbacPermissions';

export interface ProjectMembershipState {
  readonly members: ProjectMemberResponseDto[];
  readonly role: ProjectRole | null;
  readonly permissions: ProjectPermissions;
  readonly isLoading: boolean;
  readonly isMutating: boolean;
  readonly error: string | null;
}

export interface ProjectMembershipManagerConfig {
  fetchMembersFn?: typeof defaultFetchMembers;
  addOrUpdateFn?: typeof defaultAddOrUpdateMember;
  removeFn?: typeof defaultRemoveMember;
  overrideRole?: ProjectRole | null;
  isMock?: boolean;
}

export class ProjectMembershipManager {
  private state: ProjectMembershipState;
  private readonly listeners: Set<() => void> = new Set();
  private readonly fetchMembersFn: typeof defaultFetchMembers;
  private readonly addOrUpdateFn: typeof defaultAddOrUpdateMember;
  private readonly removeFn: typeof defaultRemoveMember;
  private readonly overrideRole?: ProjectRole | null;
  private readonly isMock?: boolean;
  private activeLoadId: number = 0;
  private isMutatingLock: boolean = false;
  private currentProjectId: string | null = null;
  private currentUser: { id?: string; email?: string } | null = null;
  private currentIsAuthenticated: boolean = false;

  constructor(config: ProjectMembershipManagerConfig = {}) {
    this.fetchMembersFn = config.fetchMembersFn ?? defaultFetchMembers;
    this.addOrUpdateFn = config.addOrUpdateFn ?? defaultAddOrUpdateMember;
    this.removeFn = config.removeFn ?? defaultRemoveMember;
    this.overrideRole = config.overrideRole;
    this.isMock = config.isMock;

    const initialRole = config.overrideRole ?? null;
    const initialPermissions = config.overrideRole
      ? computeProjectPermissions(config.overrideRole, false, null)
      : FAIL_CLOSED_PERMISSIONS;

    this.state = {
      members: [],
      role: initialRole,
      permissions: initialPermissions,
      isLoading: false,
      isMutating: false,
      error: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProjectMembershipState => {
    return this.state;
  };

  private setState(partial: Partial<ProjectMembershipState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  async load(
    projectId?: string | null,
    user?: { id?: string; email?: string } | null,
    isAuthenticated = false
  ): Promise<void> {
    this.currentProjectId = projectId ?? null;
    this.currentUser = user ?? null;
    this.currentIsAuthenticated = isAuthenticated;

    // Fast-path: Mock workflows or manual test role overrides
    if (this.isMock || this.overrideRole) {
      const role = this.overrideRole ?? 'ADMIN';
      this.setState({
        members: [],
        role,
        permissions: computeProjectPermissions(role, false, null),
        isLoading: false,
        error: null,
      });
      return;
    }

    if (!projectId || !isAuthenticated) {
      this.setState({
        members: [],
        role: null,
        permissions: FAIL_CLOSED_PERMISSIONS,
        isLoading: false,
        error: null,
      });
      return;
    }

    const loadId = ++this.activeLoadId;
    this.setState({
      isLoading: true,
      error: null,
      permissions: FAIL_CLOSED_PERMISSIONS,
    });

    try {
      const members = await this.fetchMembersFn(projectId);

      // Discard stale responses if projectId changed or a newer load fired
      if (loadId !== this.activeLoadId) {
        return;
      }

      const role = resolveUserRoleFromMembers(members, user);
      const permissions = computeProjectPermissions(role, false, null);

      this.setState({
        members,
        role,
        permissions,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      if (loadId !== this.activeLoadId) {
        return;
      }

      let errorMsg = 'Failed to load project membership.';
      if (err instanceof FlowForgeApiError) {
        if (err.isUnauthorized || err.status === 401) {
          errorMsg = 'Authentication required to access project membership.';
        } else if (err.isForbidden || err.status === 403) {
          errorMsg = 'Access denied: You do not have permission to view members of this project.';
        } else if (err.isNotFound || err.status === 404) {
          errorMsg = 'Project not found or you are not a member of this project.';
        } else {
          errorMsg = err.message || errorMsg;
        }
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }

      this.setState({
        members: [],
        role: null,
        permissions: FAIL_CLOSED_PERMISSIONS,
        isLoading: false,
        error: errorMsg,
      });
    }
  }

  async addOrUpdateMember(
    request: AddProjectMemberRequest,
    projectIdOverride?: string
  ): Promise<ProjectMemberResponseDto> {
    const targetProjectId = projectIdOverride || this.currentProjectId;
    if (!targetProjectId) {
      throw new Error('Cannot add member: No project selected');
    }

    if (this.isMutatingLock) {
      throw new Error('A membership mutation is already in progress');
    }

    // Client-side safeguard against demoting the sole admin
    if (request.userId) {
      const safeguard = canSafelyDemoteOrRemove(this.state.members, request.userId, request.role);
      if (!safeguard.allowed) {
        throw new Error(safeguard.reason);
      }
    }

    this.isMutatingLock = true;
    this.setState({ isMutating: true });

    try {
      const response = await this.addOrUpdateFn(targetProjectId, request);
      // Automatically refresh membership data after mutation
      await this.load(targetProjectId, this.currentUser, this.currentIsAuthenticated);
      return response;
    } finally {
      this.isMutatingLock = false;
      this.setState({ isMutating: false });
    }
  }

  async removeMember(userId: string, projectIdOverride?: string): Promise<void> {
    const targetProjectId = projectIdOverride || this.currentProjectId;
    if (!targetProjectId) {
      throw new Error('Cannot remove member: No project selected');
    }

    if (this.isMutatingLock) {
      throw new Error('A membership mutation is already in progress');
    }

    // Client-side safeguard against removing the sole admin
    const safeguard = canSafelyDemoteOrRemove(this.state.members, userId);
    if (!safeguard.allowed) {
      throw new Error(safeguard.reason);
    }

    this.isMutatingLock = true;
    this.setState({ isMutating: true });

    try {
      await this.removeFn(targetProjectId, userId);
      // Automatically refresh membership data after removal
      await this.load(targetProjectId, this.currentUser, this.currentIsAuthenticated);
    } finally {
      this.isMutatingLock = false;
      this.setState({ isMutating: false });
    }
  }

  dispose(): void {
    this.activeLoadId++;
    this.listeners.clear();
  }
}

export type UseProjectMembershipOptions = ProjectMembershipManagerConfig;

export interface UseProjectMembershipResult extends ProjectMembershipState {
  refresh: () => Promise<void>;
  addOrUpdateMember: (request: AddProjectMemberRequest) => Promise<ProjectMemberResponseDto>;
  removeMember: (userId: string) => Promise<void>;
}

/**
 * Custom hook providing reactive project membership and RBAC permissions.
 * Bridges ProjectMembershipManager to React state via useSyncExternalStore.
 */
export function useProjectMembership(
  projectId?: string | null,
  options: UseProjectMembershipOptions = {}
): UseProjectMembershipResult {
  const { user, isAuthenticated } = useAuth();
  const managerRef = useRef<ProjectMembershipManager | null>(null);

  if (!managerRef.current) {
    managerRef.current = new ProjectMembershipManager(options);
  }

  const manager = managerRef.current;

  const state = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot
  );

  useEffect(() => {
    void manager.load(projectId, user, isAuthenticated);
  }, [manager, projectId, user, isAuthenticated]);

  const refresh = useCallback(async () => {
    await manager.load(projectId, user, isAuthenticated);
  }, [manager, projectId, user, isAuthenticated]);

  const addOrUpdateMember = useCallback(
    async (request: AddProjectMemberRequest) => {
      return manager.addOrUpdateMember(request, projectId ?? undefined);
    },
    [manager, projectId]
  );

  const removeMember = useCallback(
    async (userId: string) => {
      return manager.removeMember(userId, projectId ?? undefined);
    },
    [manager, projectId]
  );

  return {
    ...state,
    refresh,
    addOrUpdateMember,
    removeMember,
  };
}
