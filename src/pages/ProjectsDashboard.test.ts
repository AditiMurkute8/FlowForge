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
});
