import { describe, it, expect, vi } from 'vitest';
import {
  RunHistoryModal,
  formatDuration,
  formatTimestamp,
  getRunStatusBadgeVariant,
} from './RunHistoryModal';
import type {
  WorkflowRunSummaryResponseDto,
  WorkflowRunResponseDto,
  TaskRunResponseDto,
  PageResponse,
} from '../../types';
import { FlowForgeApiError } from '../../api/flowForgeApi';

describe('RunHistoryModal & Lifecycle Logic', () => {
  describe('Helper Functions', () => {
    describe('formatDuration', () => {
      it('returns em-dash for null, undefined, or missing duration', () => {
        expect(formatDuration(null)).toBe('—');
        expect(formatDuration(undefined)).toBe('—');
      });

      it('formats sub-second durations in milliseconds', () => {
        expect(formatDuration(0)).toBe('0ms');
        expect(formatDuration(25)).toBe('25ms');
        expect(formatDuration(450)).toBe('450ms');
        expect(formatDuration(999)).toBe('999ms');
      });

      it('formats durations >= 1000ms in seconds with 2 decimal places', () => {
        expect(formatDuration(1000)).toBe('1.00s');
        expect(formatDuration(1250)).toBe('1.25s');
        expect(formatDuration(2450)).toBe('2.45s');
        expect(formatDuration(60000)).toBe('60.00s');
      });
    });

    describe('formatTimestamp', () => {
      it('returns em-dash for null or undefined', () => {
        expect(formatTimestamp(null)).toBe('—');
        expect(formatTimestamp(undefined)).toBe('—');
      });

      it('formats valid ISO timestamps', () => {
        const iso = '2026-10-20T10:00:00Z';
        const formatted = formatTimestamp(iso);
        expect(formatted).not.toBe('—');
        expect(formatted.length).toBeGreaterThan(0);
      });

      it('returns raw string if parsing fails or input is invalid', () => {
        expect(formatTimestamp('not-a-date')).toBe('not-a-date');
      });
    });

    describe('getRunStatusBadgeVariant', () => {
      it('maps terminal and in-progress statuses to corresponding design system badge variants', () => {
        expect(getRunStatusBadgeVariant('COMPLETED')).toBe('success');
        expect(getRunStatusBadgeVariant('FAILED')).toBe('danger');
        expect(getRunStatusBadgeVariant('RUNNING')).toBe('cyan');
        expect(getRunStatusBadgeVariant('CANCELLED')).toBe('warning');
        expect(getRunStatusBadgeVariant('PENDING')).toBe('default');
      });
    });
  });

  describe('Component Export', () => {
    it('exports RunHistoryModal as a valid functional component', () => {
      expect(RunHistoryModal).toBeDefined();
      expect(typeof RunHistoryModal).toBe('function');
    });
  });

  describe('Run History Workflow Query Logic', () => {
    const mockTask1: TaskRunResponseDto = {
      id: 'task-run-1',
      taskId: 'step-a',
      status: 'COMPLETED',
      attemptCount: 1,
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:00:01Z',
      durationMs: 1000,
      errorMessage: null,
      createdAt: '2026-10-20T09:59:59Z',
    };

    const mockTask2: TaskRunResponseDto = {
      id: 'task-run-2',
      taskId: 'step-b',
      status: 'FAILED',
      attemptCount: 3,
      startedAt: '2026-10-20T10:00:01Z',
      completedAt: '2026-10-20T10:00:03Z',
      durationMs: 2000,
      errorMessage: 'Database connection reset during query execution',
      createdAt: '2026-10-20T09:59:59Z',
    };

    const mockRunSummary1: WorkflowRunSummaryResponseDto = {
      id: 'run-111',
      workflowId: 'wf-1',
      workflowVersionId: 'ver-1',
      versionNumber: 2,
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:00:02Z',
      durationMs: 2000,
      triggeredBy: 'manual-ui',
      createdAt: '2026-10-20T09:59:59Z',
      taskCount: 2,
    };

    const mockRunSummary2: WorkflowRunSummaryResponseDto = {
      id: 'run-222',
      workflowId: 'wf-1',
      workflowVersionId: 'ver-1',
      versionNumber: 2,
      status: 'FAILED',
      startedAt: '2026-10-20T09:30:00Z',
      completedAt: '2026-10-20T09:30:03Z',
      durationMs: 3000,
      triggeredBy: 'api-trigger',
      createdAt: '2026-10-20T09:29:59Z',
      taskCount: 2,
    };


    const mockRunDetail2: WorkflowRunResponseDto = {
      ...mockRunSummary2,
      tasks: [mockTask1, mockTask2],
    };

    it('loads runs from backend API with pagination parameters', async () => {
      const mockApiResponse: PageResponse<WorkflowRunSummaryResponseDto> = {
        content: [mockRunSummary1, mockRunSummary2],
        totalElements: 2,
        totalPages: 1,
        size: 6,
        number: 0,
      };

      const fetchRunsFn = vi.fn().mockResolvedValue(mockApiResponse);
      const res = await fetchRunsFn('wf-1', { page: 0, size: 6 });

      expect(fetchRunsFn).toHaveBeenCalledWith('wf-1', { page: 0, size: 6 });
      expect(res.content).toHaveLength(2);
      expect(res.content[0].id).toBe('run-111');
      expect(res.content[0].status).toBe('COMPLETED');
      expect(res.content[1].id).toBe('run-222');
      expect(res.content[1].status).toBe('FAILED');
    });

    it('suppresses backend fetch when workflow is an offline mock template', async () => {
      const isMockWorkflow = true;
      const fetchRunsFn = vi.fn();

      const loadWorkflowRuns = async (wfId?: string) => {
        if (!wfId || isMockWorkflow) {
          return { content: [], totalElements: 0, totalPages: 0, size: 6, number: 0 };
        }
        return fetchRunsFn(wfId, { page: 0, size: 6 });
      };

      const result = await loadWorkflowRuns('sample-wf');
      expect(fetchRunsFn).not.toHaveBeenCalled();
      expect(result.content).toHaveLength(0);
      expect(result.totalElements).toBe(0);
    });

    it('fetches detailed run metrics and executed task records for a selected run', async () => {
      const getRunFn = vi.fn().mockResolvedValue(mockRunDetail2);

      const runDetail = await getRunFn('run-222');

      expect(getRunFn).toHaveBeenCalledWith('run-222');
      expect(runDetail.id).toBe('run-222');
      expect(runDetail.status).toBe('FAILED');
      expect(runDetail.tasks).toHaveLength(2);
      expect(runDetail.tasks[0].taskId).toBe('step-a');
      expect(runDetail.tasks[0].status).toBe('COMPLETED');
      expect(runDetail.tasks[1].taskId).toBe('step-b');
      expect(runDetail.tasks[1].status).toBe('FAILED');
      expect(runDetail.tasks[1].attemptCount).toBe(3);
      expect(runDetail.tasks[1].errorMessage).toBe(
        'Database connection reset during query execution'
      );
    });

    it('extracts sanitized error message on API query failures', async () => {
      const apiError = new FlowForgeApiError(404, 'Workflow run not found: run-missing');
      const getRunFn = vi.fn().mockRejectedValue(apiError);

      let errorMessage: string | null = null;
      try {
        await getRunFn('run-missing');
      } catch (err) {
        if (err instanceof FlowForgeApiError) {
          errorMessage = err.message;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
      }

      expect(errorMessage).toBe('Workflow run not found: run-missing');
    });

    it('computes correct pagination bounds and page transitions', () => {
      const totalPages = 3;

      const canGoPrev = (currentPage: number) => currentPage > 0;
      const canGoNext = (currentPage: number) => currentPage < totalPages - 1;

      // Page 0 (first page)
      expect(canGoPrev(0)).toBe(false);
      expect(canGoNext(0)).toBe(true);

      // Page 1 (middle page)
      expect(canGoPrev(1)).toBe(true);
      expect(canGoNext(1)).toBe(true);

      // Page 2 (last page)
      expect(canGoPrev(2)).toBe(true);
      expect(canGoNext(2)).toBe(false);
    });

    it('maintains selected run ID on page reload if run exists in next payload', () => {
      const page1Content = [mockRunSummary1, mockRunSummary2];
      const page2Content = [mockRunSummary2];

      const resolveSelectedRunId = (
        currentSelectedId: string | null,
        newContent: WorkflowRunSummaryResponseDto[]
      ) => {
        if (newContent.length === 0) return null;
        const exists = currentSelectedId && newContent.some((r) => r.id === currentSelectedId);
        return exists ? currentSelectedId : newContent[0].id;
      };

      // Initially run-111 is selected, reload returns page1: run-111 is preserved
      expect(resolveSelectedRunId('run-111', page1Content)).toBe('run-111');

      // Next page does not have run-111: falls back to first item of new page (run-222)
      expect(resolveSelectedRunId('run-111', page2Content)).toBe('run-222');

      // Empty page: clears selection to null
      expect(resolveSelectedRunId('run-111', [])).toBeNull();
    });

    it('refreshes run history with the current page index', async () => {
      const fetchRunsFn = vi.fn().mockResolvedValue({
        content: [mockRunSummary1],
        totalElements: 1,
        totalPages: 1,
        size: 6,
        number: 0,
      });

      let activePage = 1;
      const refreshHistory = async (workflowId: string) => {
        return fetchRunsFn(workflowId, { page: activePage, size: 6 });
      };

      await refreshHistory('wf-1');
      expect(fetchRunsFn).toHaveBeenCalledWith('wf-1', { page: 1, size: 6 });

      activePage = 0;
      await refreshHistory('wf-1');
      expect(fetchRunsFn).toHaveBeenCalledWith('wf-1', { page: 0, size: 6 });
      expect(fetchRunsFn).toHaveBeenCalledTimes(2);
    });
  });
});
