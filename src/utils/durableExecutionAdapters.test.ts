import { describe, it, expect, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  WorkflowVersionResponseDto,
  WorkflowRunResponseDto,
  TaskRunResponseDto,
} from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';
import {
  isCanvasDirty,
  applyDurableRunTaskResults,
  resetCanvasExecutionStatus,
  executeDurableWorkflowRun,
} from './durableExecutionAdapters';

function createNode(
  id: string,
  label: string,
  type = 'HTTP_REQUEST',
  parameters: Record<string, unknown> = {}
): Node<TaskNodeData> {
  return {
    id,
    type: 'customTask',
    position: { x: 100, y: 100 },
    data: {
      label,
      taskType: type as any,
      timeoutMs: 30000,
      maxRetries: 3,
      parameters,
      status: 'IDLE',
    },
  };
}

describe('durableExecutionAdapters', () => {
  const baseVersion: WorkflowVersionResponseDto = {
    id: 'ver-123',
    workflowId: 'wf-456',
    versionNumber: 1,
    versionTag: 'v1.0',
    description: 'Initial pipeline',
    graphPayload: {
      schemaVersion: 1,
      nodes: [
        {
          id: 'task-a',
          type: 'customTask',
          position: { x: 100, y: 100 },
          data: {
            label: 'Task A',
            taskType: 'HTTP_REQUEST',
            timeoutMs: 30000,
            maxRetries: 3,
            parameters: { url: 'https://api.example.com' },
          },
        },
        {
          id: 'task-b',
          type: 'customTask',
          position: { x: 300, y: 100 },
          data: {
            label: 'Task B',
            taskType: 'DATABASE_QUERY',
            timeoutMs: 30000,
            maxRetries: 3,
            parameters: { query: 'SELECT 1' },
          },
        },
      ],
      edges: [
        {
          id: 'e-task-a-task-b',
          source: 'task-a',
          target: 'task-b',
        },
      ],
    },
    taskCount: 2,
    edgeCount: 1,
    isValidDag: true,
    createdAt: '2026-10-20T10:00:00Z',
  };

  describe('isCanvasDirty', () => {
    it('returns false when nodes, edges, and task configurations match the saved version exactly', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A', 'HTTP_REQUEST', { url: 'https://api.example.com' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];
      const edges: Edge[] = [
        { id: 'e1', source: 'task-a', target: 'task-b' },
      ];

      expect(isCanvasDirty(nodes, edges, baseVersion)).toBe(false);
    });

    it('returns true when currentVersion is null or graphPayload is missing', () => {
      const nodes = [createNode('task-a', 'Task A')];
      const edges: Edge[] = [];

      expect(isCanvasDirty(nodes, edges, null)).toBe(true);
      expect(isCanvasDirty(nodes, edges, { ...baseVersion, graphPayload: null as any })).toBe(true);
    });

    it('returns true when node count differs (node added or removed)', () => {
      const nodesOneNode = [createNode('task-a', 'Task A')];
      const edges: Edge[] = [];

      expect(isCanvasDirty(nodesOneNode, edges, baseVersion)).toBe(true);
    });

    it('returns true when edge count differs (dependency added or removed)', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A', 'HTTP_REQUEST', { url: 'https://api.example.com' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];
      // 0 edges instead of 1
      expect(isCanvasDirty(nodes, [], baseVersion)).toBe(true);
    });

    it('returns true when a task node label has been modified', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A Modified', 'HTTP_REQUEST', { url: 'https://api.example.com' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];
      const edges: Edge[] = [{ id: 'e1', source: 'task-a', target: 'task-b' }];

      expect(isCanvasDirty(nodes, edges, baseVersion)).toBe(true);
    });

    it('returns true when a task node taskType has been modified', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A', 'EXECUTE_SCRIPT', { url: 'https://api.example.com' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];
      const edges: Edge[] = [{ id: 'e1', source: 'task-a', target: 'task-b' }];

      expect(isCanvasDirty(nodes, edges, baseVersion)).toBe(true);
    });

    it('returns true when a task parameter has been modified', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A', 'HTTP_REQUEST', { url: 'https://api.example.com/v2' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];
      const edges: Edge[] = [{ id: 'e1', source: 'task-a', target: 'task-b' }];

      expect(isCanvasDirty(nodes, edges, baseVersion)).toBe(true);
    });

    it('returns true when edge direction is changed', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A', 'HTTP_REQUEST', { url: 'https://api.example.com' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];
      // Reversed dependency: task-b -> task-a
      const edges: Edge[] = [{ id: 'e1', source: 'task-b', target: 'task-a' }];

      expect(isCanvasDirty(nodes, edges, baseVersion)).toBe(true);
    });
  });

  describe('applyDurableRunTaskResults', () => {
    it('maps task run statuses, durations, attempts, and errors to matching canvas nodes', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A'),
        createNode('task-b', 'Task B'),
      ];

      const taskRuns: TaskRunResponseDto[] = [
        {
          id: 'tr-1',
          taskId: 'task-a',
          status: 'COMPLETED',
          attemptCount: 1,
          durationMs: 250,
          errorMessage: null,
          startedAt: '2026-10-20T10:00:00Z',
          completedAt: '2026-10-20T10:00:00.25Z',
          createdAt: '2026-10-20T10:00:00Z',
        },
        {
          id: 'tr-2',
          taskId: 'task-b',
          status: 'FAILED',
          attemptCount: 3,
          durationMs: 1200,
          errorMessage: 'Connection timed out',
          startedAt: '2026-10-20T10:00:00.25Z',
          completedAt: '2026-10-20T10:00:01.45Z',
          createdAt: '2026-10-20T10:00:00Z',
        },
      ];

      const updated = applyDurableRunTaskResults(nodes, taskRuns);

      expect(updated[0].data.status).toBe('COMPLETED');
      expect(updated[0].data.executionDurationMs).toBe(250);
      expect(updated[0].data.attemptCount).toBe(1);
      expect(updated[0].data.errorMessage).toBeUndefined();

      expect(updated[1].data.status).toBe('FAILED');
      expect(updated[1].data.executionDurationMs).toBe(1200);
      expect(updated[1].data.attemptCount).toBe(3);
      expect(updated[1].data.errorMessage).toBe('Connection timed out');
    });

    it('sets unexecuted tasks or missing results to IDLE without fabricating success', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('task-a', 'Task A'),
        createNode('task-b', 'Task B'),
      ];

      // Only task-a has a result (task-b never ran)
      const taskRuns: TaskRunResponseDto[] = [
        {
          id: 'tr-1',
          taskId: 'task-a',
          status: 'COMPLETED',
          attemptCount: 1,
          durationMs: 100,
          errorMessage: null,
          startedAt: '2026-10-20T10:00:00Z',
          completedAt: '2026-10-20T10:00:00.1Z',
          createdAt: '2026-10-20T10:00:00Z',
        },
      ];

      const updated = applyDurableRunTaskResults(nodes, taskRuns);

      expect(updated[0].data.status).toBe('COMPLETED');
      expect(updated[1].data.status).toBe('IDLE');
      expect(updated[1].data.executionDurationMs).toBeUndefined();
    });

    it('handles empty or undefined task runs safely without error', () => {
      const nodes = [createNode('task-a', 'Task A')];
      const updated = applyDurableRunTaskResults(nodes, undefined);
      expect(updated[0].data.status).toBe('IDLE');
    });
  });

  describe('resetCanvasExecutionStatus', () => {
    it('resets all nodes status to IDLE and clears previous duration and errors', () => {
      const nodes: Node<TaskNodeData>[] = [
        {
          ...createNode('task-a', 'Task A'),
          data: {
            label: 'Task A',
            taskType: 'HTTP_REQUEST',
            status: 'FAILED',
            executionDurationMs: 500,
            errorMessage: 'Error',
            timeoutMs: 30000,
            maxRetries: 3,
            parameters: {},
          },
        },
      ];

      const reset = resetCanvasExecutionStatus(nodes);

      expect(reset[0].data.status).toBe('IDLE');
      expect(reset[0].data.executionDurationMs).toBeUndefined();
      expect(reset[0].data.errorMessage).toBeUndefined();
      expect(reset[0].data.label).toBe('Task A');
    });
  });

  describe('executeDurableWorkflowRun', () => {
    const mockNodes = [
      createNode('task-a', 'Task A', 'HTTP_REQUEST', { url: 'https://api.example.com' }),
      createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
    ];
    const mockEdges: Edge[] = [{ id: 'e1', source: 'task-a', target: 'task-b' }];

    it('prevents execution when an execution is already in flight (duplicate submission guard)', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const apiFn = vi.fn();

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: true,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('IN_FLIGHT');
      expect(apiFn).not.toHaveBeenCalled();
    });

    it('safely rejects mock workflows without calling backend API', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const apiFn = vi.fn();

      const result = await executeDurableWorkflowRun({
        workflowId: 'mock-wf-id',
        isMockWorkflow: true,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('MOCK_WORKFLOW');
      expect(apiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toContain('Sample Template');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('rejects execution when no immutable version has been saved yet', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const apiFn = vi.fn();

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: null,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('NO_VERSION');
      expect(apiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Save Required');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('rejects execution when canvas contains unsaved changes that differ from saved version', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const apiFn = vi.fn();

      // Modify canvas node to be dirty
      const dirtyNodes = [
        createNode('task-a', 'Task A Edited', 'HTTP_REQUEST', { url: 'https://api.example.com' }),
        createNode('task-b', 'Task B', 'DATABASE_QUERY', { query: 'SELECT 1' }),
      ];

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: dirtyNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('UNSAVED_CHANGES');
      expect(apiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Unsaved Changes');
      expect(toastCalls[0].msg).toContain('version v1');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('rejects execution when saved version is flagged as cyclic DAG', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const apiFn = vi.fn();

      const cyclicVersion = { ...baseVersion, isValidDag: false };

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: cyclicVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('CYCLIC_VERSION');
      expect(apiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Invalid DAG Version');
      expect(toastCalls[0].type).toBe('error');
    });

    it('successfully executes durable workflow and triggers history refresh on completion', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const executingStates: boolean[] = [];
      let latestCanvasNodes = mockNodes;
      const historyRefresh = vi.fn();

      const mockResponse: WorkflowRunResponseDto = {
        id: 'run-999',
        workflowId: 'wf-456',
        workflowVersionId: 'ver-123',
        versionNumber: 1,
        status: 'COMPLETED',
        triggeredBy: 'manual-ui',
        durationMs: 850,
        startedAt: '2026-10-20T10:00:00Z',
        completedAt: '2026-10-20T10:00:00.85Z',
        createdAt: '2026-10-20T10:00:00Z',
        tasks: [
          {
            id: 'tr-1',
            taskId: 'task-a',
            status: 'COMPLETED',
            attemptCount: 1,
            durationMs: 400,
            errorMessage: null,
            startedAt: '2026-10-20T10:00:00Z',
            completedAt: '2026-10-20T10:00:00.4Z',
            createdAt: '2026-10-20T10:00:00Z',
          },
          {
            id: 'tr-2',
            taskId: 'task-b',
            status: 'COMPLETED',
            attemptCount: 1,
            durationMs: 450,
            errorMessage: null,
            startedAt: '2026-10-20T10:00:00.4Z',
            completedAt: '2026-10-20T10:00:00.85Z',
            createdAt: '2026-10-20T10:00:00Z',
          },
        ],
      };

      const apiFn = vi.fn().mockResolvedValue(mockResponse);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: (val) => executingStates.push(val),
        setNodes: (updateFn) => {
          latestCanvasNodes = updateFn(latestCanvasNodes);
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        onExecutionComplete: historyRefresh,
        executeDurableApiFn: apiFn,
      });

      expect(apiFn).toHaveBeenCalledWith('wf-456', {
        versionNumber: 1,
        triggeredBy: 'manual-ui',
      });

      expect(executingStates).toEqual([true, false]);
      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect(result.response?.id).toBe('run-999');

      // Task status updated on canvas
      expect(latestCanvasNodes[0].data.status).toBe('COMPLETED');
      expect(latestCanvasNodes[0].data.executionDurationMs).toBe(400);
      expect(latestCanvasNodes[1].data.status).toBe('COMPLETED');
      expect(latestCanvasNodes[1].data.executionDurationMs).toBe(450);

      // Run history callback triggered
      expect(historyRefresh).toHaveBeenCalledTimes(1);
      expect(historyRefresh).toHaveBeenCalledWith(mockResponse);

      // Toast feedback
      expect(toastCalls[0].title).toBe('Execution Completed');
      expect(toastCalls[0].type).toBe('success');
      expect(toastCalls[0].msg).toContain('850ms');
    });

    it('handles FAILED terminal workflow execution, updates canvas task errors, and refreshes history', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      let latestCanvasNodes = mockNodes;
      const historyRefresh = vi.fn();

      const failedResponse: WorkflowRunResponseDto = {
        id: 'run-fail',
        workflowId: 'wf-456',
        workflowVersionId: 'ver-123',
        versionNumber: 1,
        status: 'FAILED',
        triggeredBy: 'manual-ui',
        durationMs: 500,
        startedAt: '2026-10-20T10:00:00Z',
        completedAt: '2026-10-20T10:00:00.5Z',
        createdAt: '2026-10-20T10:00:00Z',
        tasks: [
          {
            id: 'tr-1',
            taskId: 'task-a',
            status: 'COMPLETED',
            attemptCount: 1,
            durationMs: 150,
            errorMessage: null,
            startedAt: '2026-10-20T10:00:00Z',
            completedAt: '2026-10-20T10:00:00.15Z',
            createdAt: '2026-10-20T10:00:00Z',
          },
          {
            id: 'tr-2',
            taskId: 'task-b',
            status: 'FAILED',
            attemptCount: 3,
            durationMs: 350,
            errorMessage: 'Database query timeout',
            startedAt: '2026-10-20T10:00:00.15Z',
            completedAt: '2026-10-20T10:00:00.5Z',
            createdAt: '2026-10-20T10:00:00Z',
          },
        ],
      };

      const apiFn = vi.fn().mockResolvedValue(failedResponse);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: (updateFn) => {
          latestCanvasNodes = updateFn(latestCanvasNodes);
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        onExecutionComplete: historyRefresh,
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(latestCanvasNodes[1].data.status).toBe('FAILED');
      expect(latestCanvasNodes[1].data.errorMessage).toBe('Database query timeout');

      // Even though failed, run history is refreshed
      expect(historyRefresh).toHaveBeenCalledTimes(1);
      expect(toastCalls[0].title).toBe('Execution Failed');
      expect(toastCalls[0].type).toBe('error');
      expect(toastCalls[0].msg).toContain('task-b: Database query timeout');
    });

    it('handles HTTP 429 Capacity Exhausted error and respects Retry-After without retrying', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const error429 = new FlowForgeApiError(
        429,
        'Server capacity exhausted: Maximum concurrent workflows reached.',
        ['concurrencyLimit=5'],
        undefined,
        15 // Retry-After 15s
      );

      const apiFn = vi.fn().mockRejectedValue(error429);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(429);
      expect(result.error?.isCapacityExhausted).toBe(true);
      expect(apiFn).toHaveBeenCalledTimes(1); // Never auto-retries

      expect(toastCalls[0].title).toBe('Capacity Exhausted (429)');
      expect(toastCalls[0].msg).toContain('Please retry in 15 seconds');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('handles HTTP 504 Gateway Timeout error, warns user, and refreshes history', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const historyRefresh = vi.fn();
      const error504 = new FlowForgeApiError(
        504,
        'Execution exceeded maximum wait duration of 15000ms.'
      );

      const apiFn = vi.fn().mockRejectedValue(error504);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        onExecutionComplete: historyRefresh,
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(504);
      expect(result.error?.isTimeout).toBe(true);

      // On 504, run history is refreshed because backend saved the run record
      expect(historyRefresh).toHaveBeenCalledTimes(1);
      expect(toastCalls[0].title).toBe('Gateway Timeout (504)');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('handles HTTP 400 Bad Request error and displays actionable details', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const error400 = new FlowForgeApiError(
        400,
        'Cannot execute workflow version with cyclic dependencies.',
        ['Cycle: task-a -> task-b -> task-a']
      );

      const apiFn = vi.fn().mockRejectedValue(error400);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(400);
      expect(toastCalls[0].title).toBe('Execution Rejected (400)');
      expect(toastCalls[0].msg).toContain('Cycle: task-a -> task-b -> task-a');
      expect(toastCalls[0].type).toBe('error');
    });

    it('handles HTTP 404 Not Found error gracefully', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const error404 = new FlowForgeApiError(404, 'Workflow wf-456 version 1 not found');

      const apiFn = vi.fn().mockRejectedValue(error404);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(404);
      expect(toastCalls[0].title).toBe('Resource Not Found (404)');
      expect(toastCalls[0].type).toBe('error');
    });

    it('handles network failure (HTTP 0) when backend server is offline', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const errorNetwork = new FlowForgeApiError(0, 'Network failure: Unable to connect');

      const apiFn = vi.fn().mockRejectedValue(errorNetwork);

      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-456',
        isMockWorkflow: false,
        currentVersion: baseVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeDurableApiFn: apiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.isNetworkFailure).toBe(true);
      expect(toastCalls[0].title).toBe('Server Offline');
      expect(toastCalls[0].type).toBe('error');
    });
  });
});
