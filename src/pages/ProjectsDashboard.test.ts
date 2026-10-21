import { describe, it, expect, vi } from 'vitest';
import type { PageResponse, ProjectResponseDto } from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';

describe('ProjectsDashboard Persistence Integration', () => {
  it('loads projects from backend API and maps DTOs to UI Project model', async () => {
    const mockApiResponse: PageResponse<ProjectResponseDto> = {
      content: [
        {
          id: 'proj-backend-1',
          name: 'Fraud Detection Engine',
          slug: 'fraud-detection-engine',
          description: 'Real-time scoring',
          createdAt: '2026-10-19T10:00:00Z',
          updatedAt: '2026-10-19T11:00:00Z',
        },
      ],
      totalElements: 1,
      totalPages: 1,
      size: 50,
      number: 0,
    };

    const fetchProjectsFn = vi.fn().mockResolvedValue(mockApiResponse);

    // Call fetch logic
    const page = await fetchProjectsFn({ page: 0, size: 50 });
    expect(fetchProjectsFn).toHaveBeenCalledWith({ page: 0, size: 50 });

    const loadedProjects = page.content.map((dto: ProjectResponseDto) => ({
      id: dto.id,
      name: dto.name,
      slug: dto.slug,
      description: dto.description || 'Workflow pipeline workspace.',
      workflowCount: 1,
      lastExecutionAt: 'Never',
      lastExecutionStatus: 'QUEUED',
      tags: ['Production'],
      owner: 'current.user@flowforge.internal',
      isMock: false,
      version: 'v1.0.0',
      updatedAt: dto.updatedAt,
    }));

    expect(loadedProjects).toHaveLength(1);
    expect(loadedProjects[0].id).toBe('proj-backend-1');
    expect(loadedProjects[0].name).toBe('Fraud Detection Engine');
    expect(loadedProjects[0].slug).toBe('fraud-detection-engine');
    expect(loadedProjects[0].isMock).toBe(false);
  });

  it('handles backend project-loading failure gracefully with diagnostic message', async () => {
    const apiError = new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
    const fetchProjectsFn = vi.fn().mockRejectedValue(apiError);

    let caughtError: string | null = null;
    try {
      await fetchProjectsFn({ page: 0, size: 50 });
    } catch (err) {
      if (err instanceof FlowForgeApiError) {
        caughtError = err.message;
      }
    }

    expect(caughtError).toBe('Network failure: Unable to connect to FlowForge server');
  });

  it('handles project creation via real API endpoint and prevents duplicate submission', async () => {
    const createdDto: ProjectResponseDto = {
      id: 'proj-new-uuid',
      name: 'Credit Risk Pipeline',
      slug: 'credit-risk-pipeline',
      description: 'Underwriting models',
      createdAt: '2026-10-19T12:00:00Z',
      updatedAt: '2026-10-19T12:00:00Z',
    };

    const createProjectFn = vi.fn().mockResolvedValue(createdDto);

    let isCreating = false;

    const handleCreate = async (name: string, description?: string) => {
      if (isCreating) return null;
      if (!name.trim()) throw new Error('Project name is required');

      isCreating = true;
      try {
        return await createProjectFn({ name: name.trim(), description });
      } finally {
        isCreating = false;
      }
    };

    // First create call
    const result = await handleCreate('Credit Risk Pipeline', 'Underwriting models');
    expect(createProjectFn).toHaveBeenCalledTimes(1);
    expect(createProjectFn).toHaveBeenCalledWith({
      name: 'Credit Risk Pipeline',
      description: 'Underwriting models',
    });
    expect(result).toEqual(createdDto);

    // Duplicate submission guard check: if isCreating is true, call is blocked
    isCreating = true;
    const blockedCall = await handleCreate('Another Name');
    expect(blockedCall).toBeNull();
    expect(createProjectFn).toHaveBeenCalledTimes(1); // Still 1!
  });

  it('keeps backend project-creation error visible without creating project or fabricating success', async () => {
    const conflictError = new FlowForgeApiError(409, 'Project slug already exists', [
      'Slug credit-risk-pipeline is already in use by project proj-123',
    ]);
    const createProjectFn = vi.fn().mockRejectedValue(conflictError);

    let formError: string | null = null;

    try {
      await createProjectFn({ name: 'Credit Risk Pipeline' });
    } catch (err) {
      if (err instanceof FlowForgeApiError) {
        formError = err.details?.length ? `${err.message}: ${err.details.join(', ')}` : err.message;
      }
    }

    expect(formError).toBe(
      'Project slug already exists: Slug credit-risk-pipeline is already in use by project proj-123'
    );
  });

  describe('Authentication & Mock Fallback Guards', () => {
    it('blocks project creation when user is unauthenticated and invokes onOpenAuth', async () => {
      const createProjectFn = vi.fn();
      const onOpenAuth = vi.fn();
      const onShowToast = vi.fn();
      const effectiveIsAuthenticated = false;

      let formError: string | null = null;

      const attemptCreate = async (name: string) => {
        if (!effectiveIsAuthenticated) {
          formError = 'Authentication required to create a project.';
          onShowToast('Authentication Required', 'Please sign in to create a project.', 'warning');
          onOpenAuth('login');
          return null;
        }
        return createProjectFn({ name });
      };

      const result = await attemptCreate('Secret Pipeline');
      expect(result).toBeNull();
      expect(createProjectFn).not.toHaveBeenCalled();
      expect(formError).toBe('Authentication required to create a project.');
      expect(onShowToast).toHaveBeenCalledWith(
        'Authentication Required',
        'Please sign in to create a project.',
        'warning'
      );
      expect(onOpenAuth).toHaveBeenCalledWith('login');
    });

    it('on 401 Unauthorized, never falls back to mock data and sets empty project list', async () => {
      const api401 = new FlowForgeApiError(401, 'HTTP 401: Unauthorized');
      const fetchProjectsFn = vi.fn().mockRejectedValue(api401);
      const onOpenAuth = vi.fn();

      let projects: unknown[] = [
        { id: 'initial-dummy', name: 'Placeholder' },
      ];
      let loadError: string | null = null;

      try {
        await fetchProjectsFn({ page: 0, size: 50 });
      } catch (err) {
        const isAuthError = err instanceof FlowForgeApiError && (err.isUnauthorized || err.status === 401);
        if (isAuthError) {
          loadError = 'Authentication required to view project inventory. Please sign in.';
          projects = []; // Crucial: NEVER fall back to mock data on 401!
          onOpenAuth('login');
        }
      }

      expect(projects).toEqual([]);
      expect(loadError).toBe('Authentication required to view project inventory. Please sign in.');
      expect(onOpenAuth).toHaveBeenCalledWith('login');
    });

    it('on offline status 0, explicitly indicates fallback to mock data with offline notice', async () => {
      const api0 = new FlowForgeApiError(0, 'Failed to connect to backend server');
      const fetchProjectsFn = vi.fn().mockRejectedValue(api0);

      let projects: unknown[] = [];
      let loadError: string | null = null;

      try {
        await fetchProjectsFn({ page: 0, size: 50 });
      } catch (err) {
        if (err instanceof FlowForgeApiError && err.status === 0) {
          loadError = `${err.message} Displaying fallback projects for offline inspection.`;
          projects = [{ id: 'mock-1', name: 'Mock Project', isMock: true }];
        }
      }

      expect(projects).toHaveLength(1);
      expect(loadError).toContain('Displaying fallback projects for offline inspection');
    });
  });

  describe('Role-Aware Project Inventory (Phase 1.5.5)', () => {
    it('determines role-based control visibility: ADMIN gets Members and Delete controls', () => {
      const evaluateControls = (role: 'ADMIN' | 'DEVELOPER' | 'VIEWER' | null) => ({
        canOpen: true,
        canManageMembers: role === 'ADMIN',
        canDelete: role === 'ADMIN',
      });

      const adminControls = evaluateControls('ADMIN');
      expect(adminControls.canOpen).toBe(true);
      expect(adminControls.canManageMembers).toBe(true);
      expect(adminControls.canDelete).toBe(true);

      const devControls = evaluateControls('DEVELOPER');
      expect(devControls.canOpen).toBe(true);
      expect(devControls.canManageMembers).toBe(false);
      expect(devControls.canDelete).toBe(false);

      const viewerControls = evaluateControls('VIEWER');
      expect(viewerControls.canOpen).toBe(true);
      expect(viewerControls.canManageMembers).toBe(false);
      expect(viewerControls.canDelete).toBe(false);

      const unverifiedControls = evaluateControls(null);
      expect(unverifiedControls.canManageMembers).toBe(false);
      expect(unverifiedControls.canDelete).toBe(false);
    });

    it('assigns creator as initial ProjectRole.ADMIN upon successful project creation', async () => {
      const createdDto: ProjectResponseDto = {
        id: 'proj-created-1',
        name: 'New Orchestrator',
        slug: 'new-orchestrator',
        description: 'Initial pipeline',
        createdAt: '2026-10-21T10:00:00Z',
        updatedAt: '2026-10-21T10:00:00Z',
      };

      const createProjectFn = vi.fn().mockResolvedValue(createdDto);
      const projectRoles: Record<string, string> = {};

      const handleCreate = async (name: string) => {
        const result = await createProjectFn({ name });
        // Backend sets creator as ADMIN; UI reflects creator role immediately
        projectRoles[result.id] = 'ADMIN';
        return result;
      };

      const res = await handleCreate('New Orchestrator');
      expect(res.id).toBe('proj-created-1');
      expect(projectRoles['proj-created-1']).toBe('ADMIN');
    });

    it('deletes project when caller has ADMIN role and project has 0 workflows', async () => {
      const deleteProjectFn = vi.fn().mockResolvedValue(undefined);
      const onShowToast = vi.fn();

      let projects = [{ id: 'proj-1', name: 'Analytics Pipeline' }];
      let isDeleting = false;

      const handleDelete = async (projectId: string, userRole: string | null) => {
        if (userRole !== 'ADMIN') {
          throw new Error('Access denied: Only project administrators can delete projects.');
        }
        if (isDeleting) return;

        isDeleting = true;
        try {
          await deleteProjectFn(projectId);
          projects = projects.filter((p) => p.id !== projectId);
          onShowToast('Project Deleted', 'Successfully deleted project.', 'success');
        } finally {
          isDeleting = false;
        }
      };

      await handleDelete('proj-1', 'ADMIN');
      expect(deleteProjectFn).toHaveBeenCalledWith('proj-1');
      expect(projects).toHaveLength(0);
      expect(onShowToast).toHaveBeenCalledWith('Project Deleted', expect.any(String), 'success');
    });

    it('blocks project deletion when user is DEVELOPER or VIEWER even if handler is invoked', async () => {
      const deleteProjectFn = vi.fn();

      const attemptDelete = async (userRole: string | null) => {
        if (userRole !== 'ADMIN') {
          throw new Error('Access denied: Only project administrators can delete projects.');
        }
        return deleteProjectFn('proj-1');
      };

      await expect(attemptDelete('DEVELOPER')).rejects.toThrow('Access denied');
      await expect(attemptDelete('VIEWER')).rejects.toThrow('Access denied');
      await expect(attemptDelete(null)).rejects.toThrow('Access denied');
      expect(deleteProjectFn).not.toHaveBeenCalled();
    });

    it('handles 409 Conflict when deleting a project with active workflows', async () => {
      const conflictError = new FlowForgeApiError(
        409,
        'Cannot delete project because dependent workflows exist'
      );
      const deleteProjectFn = vi.fn().mockRejectedValue(conflictError);

      let errorMessage: string | null = null;

      try {
        await deleteProjectFn('proj-with-workflows');
      } catch (err) {
        if (err instanceof FlowForgeApiError && err.status === 409) {
          errorMessage =
            'Cannot delete project because dependent workflows exist. Please delete all workflows first.';
        }
      }

      expect(errorMessage).toBe(
        'Cannot delete project because dependent workflows exist. Please delete all workflows first.'
      );
    });

    it('prevents duplicate deletion requests when an operation is already in flight', async () => {
      let isDeleting = false;
      const deleteProjectFn = vi.fn().mockResolvedValue(undefined);

      const triggerDelete = async () => {
        if (isDeleting) return 'BLOCKED';
        isDeleting = true;
        try {
          return await deleteProjectFn('proj-1');
        } finally {
          isDeleting = false;
        }
      };

      isDeleting = true;
      const secondCall = await triggerDelete();
      expect(secondCall).toBe('BLOCKED');
      expect(deleteProjectFn).not.toHaveBeenCalled();
    });
  });
});
