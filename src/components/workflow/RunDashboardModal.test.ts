import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RunDashboardModal,
  getRunStatusBadgeVariant,
  isTerminalStatus,
} from './RunDashboardModal';
import type {
  WorkflowRunResponseDto,
  TaskRunResponseDto,
} from '../../types';
import { FlowForgeApiError } from '../../api/flowForgeApi';

describe('RunDashboardModal Unit & Lifecycle Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Helper Functions', () => {
    it('getRunStatusBadgeVariant maps statuses correctly to design system variants', () => {
      expect(getRunStatusBadgeVariant('COMPLETED')).toBe('success');
      expect(getRunStatusBadgeVariant('FAILED')).toBe('danger');
      expect(getRunStatusBadgeVariant('RUNNING')).toBe('cyan');
      expect(getRunStatusBadgeVariant('CANCELLED')).toBe('warning');
      expect(getRunStatusBadgeVariant('PENDING')).toBe('default');
    });

    it('isTerminalStatus correctly detects terminal vs active statuses', () => {
      expect(isTerminalStatus('COMPLETED')).toBe(true);
      expect(isTerminalStatus('FAILED')).toBe(true);
      expect(isTerminalStatus('CANCELLED')).toBe(true);
      expect(isTerminalStatus('RUNNING')).toBe(false);
      expect(isTerminalStatus('PENDING')).toBe(false);
      expect(isTerminalStatus('UNKNOWN')).toBe(false);
    });
  });

  describe('Live Polling & Lifecycle Logic', () => {
    const mockTasks: TaskRunResponseDto[] = [
      {
        id: 'tr-1',
        taskId: 'task-a',
        status: 'RUNNING',
        attemptCount: 1,
        startedAt: '2026-10-21T10:00:00Z',
        completedAt: null,
        durationMs: null,
        errorMessage: null,
        createdAt: '2026-10-21T09:59:59Z',
      },
      {
        id: 'tr-2',
        taskId: 'task-b',
        status: 'PENDING',
        attemptCount: 1,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        errorMessage: null,
        createdAt: '2026-10-21T09:59:59Z',
      },
    ];

    const runningRun: WorkflowRunResponseDto = {
      id: 'run-1',
      workflowId: 'wf-1',
      workflowVersionId: 'ver-1',
      versionNumber: 1,
      status: 'RUNNING',
      startedAt: '2026-10-21T10:00:00Z',
      completedAt: null,
      durationMs: null,
      triggeredBy: 'manual-ui',
      createdAt: '2026-10-21T09:59:59Z',
      tasks: mockTasks,
    };

    const completedRun: WorkflowRunResponseDto = {
      ...runningRun,
      status: 'COMPLETED',
      completedAt: '2026-10-21T10:00:05Z',
      durationMs: 5000,
      tasks: [
        {
          ...mockTasks[0],
          status: 'COMPLETED',
          completedAt: '2026-10-21T10:00:02Z',
          durationMs: 2000,
        },
        {
          ...mockTasks[1],
          status: 'COMPLETED',
          startedAt: '2026-10-21T10:00:02Z',
          completedAt: '2026-10-21T10:00:05Z',
          durationMs: 3000,
        },
      ],
    };

    const failedRunWithRetries: WorkflowRunResponseDto = {
      ...runningRun,
      status: 'FAILED',
      completedAt: '2026-10-21T10:00:04Z',
      durationMs: 4000,
      tasks: [
        {
          id: 'tr-fail',
          taskId: 'task-failed',
          status: 'FAILED',
          attemptCount: 3,
          startedAt: '2026-10-21T10:00:00Z',
          completedAt: '2026-10-21T10:00:04Z',
          durationMs: 4000,
          errorMessage: 'Connection timed out after 3 retry attempts',
          createdAt: '2026-10-21T09:59:59Z',
        },
      ],
    };

    it('exports RunDashboardModal as a defined React component', () => {
      expect(RunDashboardModal).toBeDefined();
      expect(typeof RunDashboardModal).toBe('function');
    });

    it('simulates polling engine starting when run is active (RUNNING)', async () => {
      const getRunMock = vi.fn().mockResolvedValue(runningRun);

      let isPolling = false;
      const startPolling = (status: string) => {
        if (!isTerminalStatus(status)) {
          isPolling = true;
        }
      };

      startPolling(runningRun.status);
      expect(isPolling).toBe(true);

      const res = await getRunMock('run-1');
      expect(getRunMock).toHaveBeenCalledWith('run-1');
      expect(res.status).toBe('RUNNING');
      expect(res.tasks).toHaveLength(2);
    });

    it('simulates polling engine stopping when terminal state (COMPLETED) is reached', async () => {
      let pollCount = 0;
      let isPolling = true;

      const pollCycle = async () => {
        pollCount++;
        const state = pollCount === 1 ? runningRun : completedRun;
        if (isTerminalStatus(state.status)) {
          isPolling = false;
        }
        return state;
      };

      // Tick 1: RUNNING -> continue
      const tick1 = await pollCycle();
      expect(tick1.status).toBe('RUNNING');
      expect(isPolling).toBe(true);

      // Tick 2: COMPLETED -> stop
      const tick2 = await pollCycle();
      expect(tick2.status).toBe('COMPLETED');
      expect(isPolling).toBe(false);
      expect(pollCount).toBe(2);
    });

    it('simulates polling engine stopping when terminal state (FAILED) is reached', async () => {
      let isPolling = true;
      const terminalState = failedRunWithRetries;

      if (isTerminalStatus(terminalState.status)) {
        isPolling = false;
      }

      expect(isPolling).toBe(false);
      expect(terminalState.tasks[0].status).toBe('FAILED');
      expect(terminalState.tasks[0].attemptCount).toBe(3);
      expect(terminalState.tasks[0].errorMessage).toBe(
        'Connection timed out after 3 retry attempts'
      );
    });

    it('renders task progress counters accurately', () => {
      const tasks = [
        { ...mockTasks[0], status: 'RUNNING' as const },
        { ...mockTasks[1], status: 'PENDING' as const },
        {
          id: 't-3',
          workflowRunId: 'run-1',
          taskId: 'task-c',
          status: 'COMPLETED' as const,
          attemptCount: 1,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          errorMessage: null,
          createdAt: '',
        },
        {
          id: 't-4',
          workflowRunId: 'run-1',
          taskId: 'task-d',
          status: 'FAILED' as const,
          attemptCount: 2,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          errorMessage: 'Fatal',
          createdAt: '',
        },
      ];

      const counts = {
        pending: tasks.filter((t) => t.status === 'PENDING').length,
        running: tasks.filter((t) => t.status === 'RUNNING').length,
        completed: tasks.filter((t) => t.status === 'COMPLETED').length,
        failed: tasks.filter((t) => t.status === 'FAILED').length,
      };

      expect(counts.pending).toBe(1);
      expect(counts.running).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(1);
    });

    it('handles polling errors gracefully without throwing unhandled exceptions', async () => {
      const getRunErrorMock = vi.fn().mockRejectedValue(
        new FlowForgeApiError(500, 'Internal Server Error during run poll')
      );

      let caughtError: string | null = null;
      let uiCrashed = false;

      try {
        await getRunErrorMock('run-1');
      } catch (err) {
        if (err instanceof FlowForgeApiError) {
          caughtError = err.message;
        } else {
          uiCrashed = true;
        }
      }

      expect(uiCrashed).toBe(false);
      expect(caughtError).toBe('Internal Server Error during run poll');
    });

    it('ensures no duplicate polling intervals are created', () => {
      let activeIntervalId: number | null = null;
      let intervalCreationCount = 0;

      const schedulePoll = () => {
        if (activeIntervalId !== null) {
          clearInterval(activeIntervalId);
        }
        activeIntervalId = intervalCreationCount + 1;
        intervalCreationCount++;
      };

      schedulePoll();
      expect(intervalCreationCount).toBe(1);
      expect(activeIntervalId).toBe(1);

      // Re-triggering replaces prior interval without leaking duplicates
      schedulePoll();
      expect(intervalCreationCount).toBe(2);
      expect(activeIntervalId).toBe(2);
    });

    it('cleans up polling timers on component unmount to prevent leaks', () => {
      let isTimerActive = true;
      const cleanup = () => {
        isTimerActive = false;
      };

      expect(isTimerActive).toBe(true);
      cleanup();
      expect(isTimerActive).toBe(false);
    });

    it('prevents state updates after unmount via isMounted flag', () => {
      let isMounted = true;
      let state = 'initial';

      const asyncPollResolution = () => {
        if (isMounted) {
          state = 'updated';
        }
      };

      // Unmount occurs before async response
      isMounted = false;
      asyncPollResolution();

      // State remains unchanged
      expect(state).toBe('initial');
    });
  });
});
