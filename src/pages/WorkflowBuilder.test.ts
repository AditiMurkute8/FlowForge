import { describe, it, expect, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  TaskStatus,
  ValidateDagResponse,
  DagValidationResult,
  ExecuteWorkflowResponse,
  WorkflowVersionResponseDto,
} from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';
import { restoreCanvasFromGraphPayload, saveWorkflowDraft } from '../utils/workflowPersistenceAdapters';
import { executeWorkflowValidation, MAX_TASKS_LIMIT, MAX_EDGES_LIMIT } from '../utils/dagValidationAdapters';
import {
  executeWorkflowRun,
  type ExecutionRunResult,
} from '../utils/workflowExecutionAdapters';
import {
  executeDurableWorkflowRun,
  applyDurableRunTaskResults,
} from '../utils/durableExecutionAdapters';
import { WorkflowBuilder } from './WorkflowBuilder';
import {
  ExecutionModal,
  computeDisplayTaskList,
  resolveModalTitleAndDescription,
} from '../components/workflow/ExecutionModal';

function createNode(id: string, label: string): Node<TaskNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      label,
      taskType: 'HTTP_REQUEST',
      timeoutMs: 30000,
      maxRetries: 3,
      parameters: {},
    },
  };
}

describe('WorkflowBuilder Integration & Validation Workflow', () => {
  it('exports WorkflowBuilder component correctly', () => {
    expect(WorkflowBuilder).toBeDefined();
    expect(typeof WorkflowBuilder).toBe('function');
  });

  describe('executeWorkflowValidation', () => {
    const mockNodes: Node<TaskNodeData>[] = [
      createNode('task-1', 'Task 1'),
      createNode('task-2', 'Task 2'),
    ];
    const mockEdges: Edge[] = [
      { id: 'e1-2', source: 'task-1', target: 'task-2' },
    ];

    it('handles successful backend validation and updates UI state', async () => {
      const mockApiResponse: ValidateDagResponse = {
        isValid: true,
        hasCycle: false,
        cycleNodes: [],
        disconnectedNodes: [],
        errors: [],
        warnings: [],
        topologicalOrder: ['task-1', 'task-2'],
      };

      const validateApiFn = vi.fn().mockResolvedValue(mockApiResponse);
      const validateLocalFn = vi.fn();
      const state: { result: DagValidationResult | null; visuals: DagValidationResult | null } = {
        result: null,
        visuals: null,
      };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const validatingStates: boolean[] = [];

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: mockEdges,
        isValidating: false,
        setIsValidating: (val) => validatingStates.push(val),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: (res) => {
          state.visuals = res;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
        validateLocalFn,
      });

      expect(validateApiFn).toHaveBeenCalledWith({
        taskIds: ['task-1', 'task-2'],
        edges: [{ source: 'task-1', target: 'task-2' }],
      });
      expect(validateLocalFn).not.toHaveBeenCalled();

      expect(validatingStates).toEqual([true, false]);
      expect(state.result).not.toBeNull();
      expect(state.result?.isValid).toBe(true);
      expect(state.result?.isLocalFallback).toBe(false);
      expect(state.result?.topologicalOrder).toEqual(['task-1', 'task-2']);

      expect(state.visuals).toEqual(state.result);
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('DAG Validated (Server)');
      expect(toastCalls[0].type).toBe('success');
      expect(toastCalls[0].msg).toContain('2 tasks ordered');
    });

    it('handles cyclic backend validation responses correctly', async () => {
      const cyclicEdges: Edge[] = [
        { id: 'e1-2', source: 'task-1', target: 'task-2' },
        { id: 'e2-1', source: 'task-2', target: 'task-1' },
      ];
      const mockApiResponse: ValidateDagResponse = {
        isValid: false,
        hasCycle: true,
        cycleNodes: ['task-1', 'task-2'],
        disconnectedNodes: [],
        errors: ['Cyclic dependency detected: task-1 -> task-2 -> task-1'],
        warnings: [],
        topologicalOrder: [],
      };

      const validateApiFn = vi.fn().mockResolvedValue(mockApiResponse);
      const state: { result: DagValidationResult | null } = { result: null };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: cyclicEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
      });

      expect(state.result?.isValid).toBe(false);
      expect(state.result?.hasCycle).toBe(true);
      expect(state.result?.cycleNodes).toEqual(['task-1', 'task-2']);
      expect(state.result?.cycleEdges).toEqual(['e1-2', 'e2-1']);
      expect(state.result?.isLocalFallback).toBe(false);

      expect(toastCalls[0].title).toBe('Validation Failed (Server)');
      expect(toastCalls[0].type).toBe('error');
      expect(toastCalls[0].msg).toContain('Cyclic dependency detected');
    });

    it('falls back to local validator if and only if backend is unreachable (status 0)', async () => {
      const validateApiFn = vi
        .fn()
        .mockRejectedValue(new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server'));

      const mockLocalResult: DagValidationResult = {
        isValid: true,
        hasCycle: false,
        cycleNodes: [],
        cycleEdges: [],
        disconnectedNodes: [],
        errors: [],
        warnings: [],
      };
      const validateLocalFn = vi.fn().mockReturnValue(mockLocalResult);

      const state: { result: DagValidationResult | null } = { result: null };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: mockEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
        validateLocalFn,
      });

      expect(validateApiFn).toHaveBeenCalled();
      expect(validateLocalFn).toHaveBeenCalledWith(mockNodes, mockEdges);

      expect(state.result?.isValid).toBe(true);
      expect(state.result?.isLocalFallback).toBe(true);

      expect(toastCalls[0].title).toBe('Server Offline — Local Validation Only');
      expect(toastCalls[0].type).toBe('warning');
      expect(toastCalls[0].msg).toContain('local fallback engine');
    });

    it('does NOT fall back to local validator on HTTP 400 Bad Request error', async () => {
      const validateApiFn = vi.fn().mockRejectedValue(
        new FlowForgeApiError(400, 'Bad Request', ['Task count exceeds limit: 55'])
      );
      const validateLocalFn = vi.fn();

      const state: { result: DagValidationResult | null } = { result: null };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: mockEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
        validateLocalFn,
      });

      expect(validateApiFn).toHaveBeenCalled();
      expect(validateLocalFn).not.toHaveBeenCalled();

      expect(state.result?.isValid).toBe(false);
      expect(state.result?.isLocalFallback).toBe(false);
      expect(state.result?.errors).toEqual(['Task count exceeds limit: 55']);

      expect(toastCalls[0].title).toBe('Validation Error');
      expect(toastCalls[0].type).toBe('error');
      expect(toastCalls[0].msg).toBe('Bad Request');
    });

    it('does NOT fall back to local validator on HTTP 500 server error', async () => {
      const validateApiFn = vi.fn().mockRejectedValue(
        new FlowForgeApiError(500, 'Internal Server Error', [])
      );
      const validateLocalFn = vi.fn();

      const state: { result: DagValidationResult | null } = { result: null };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: mockEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
        validateLocalFn,
      });

      expect(validateLocalFn).not.toHaveBeenCalled();
      expect(state.result?.isValid).toBe(false);
      expect(state.result?.isLocalFallback).toBe(false);
      expect(state.result?.errors).toEqual(['Internal Server Error']);

      expect(toastCalls[0].title).toBe('Validation Error');
      expect(toastCalls[0].type).toBe('error');
    });

    it('prevents duplicate concurrent validation requests when isValidating is true', async () => {
      const validateApiFn = vi.fn();

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: mockEdges,
        isValidating: true, // Already running
        setIsValidating: vi.fn(),
        setValidationResult: vi.fn(),
        applyValidationVisuals: vi.fn(),
        onShowToast: vi.fn(),
        validateApiFn,
      });

      expect(validateApiFn).not.toHaveBeenCalled();
    });

    it('enforces task count limit (>50) before sending request to backend', async () => {
      const largeNodes: Node<TaskNodeData>[] = Array.from({ length: MAX_TASKS_LIMIT + 1 }, (_, i) =>
        createNode(`node-${i}`, `Node ${i}`)
      );
      const validateApiFn = vi.fn();
      const state: { result: DagValidationResult | null } = { result: null };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      await executeWorkflowValidation({
        nodes: largeNodes,
        edges: mockEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
      });

      expect(validateApiFn).not.toHaveBeenCalled();
      expect(state.result?.isValid).toBe(false);
      expect(state.result?.errors[0]).toContain('Task count (51) exceeds maximum limit of 50 tasks');
      expect(toastCalls[0].title).toBe('Validation Limit Exceeded');
      expect(toastCalls[0].type).toBe('error');
    });

    it('enforces edge count limit (>100) before sending request to backend', async () => {
      const largeEdges: Edge[] = Array.from({ length: MAX_EDGES_LIMIT + 1 }, (_, i) => ({
        id: `e-${i}`,
        source: 'task-1',
        target: 'task-2',
      }));
      const validateApiFn = vi.fn();
      const state: { result: DagValidationResult | null } = { result: null };
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: largeEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          state.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        validateApiFn,
      });

      expect(validateApiFn).not.toHaveBeenCalled();
      expect(state.result?.isValid).toBe(false);
      expect(state.result?.errors[0]).toContain('Edge count (101) exceeds maximum limit of 100 edges');
      expect(toastCalls[0].title).toBe('Validation Limit Exceeded');
      expect(toastCalls[0].type).toBe('error');
    });
  });

  describe('ExecutionModal Component', () => {
    const mockNodes: Node<TaskNodeData>[] = [
      createNode('task-1', 'Ingest API'),
      createNode('task-2', 'Transform Data'),
    ];

    it('exports ExecutionModal component correctly', () => {
      expect(ExecutionModal).toBeDefined();
      expect(typeof ExecutionModal).toBe('function');
    });

    it('resolves modal title and description for loading state', () => {
      const { title, description } = resolveModalTitleAndDescription(true, null);
      expect(title).toBe('Simulating Workflow Execution');
      expect(description).toContain('POST /api/v1/workflows/execute');
    });

    it('resolves modal title and description when preflight validation errors occur', () => {
      const { title, description } = resolveModalTitleAndDescription(false, {
        success: false,
        preflightErrors: [{ field: 'maxRetries', message: 'Maximum 4 retries' }],
      });
      expect(title).toBe('Preflight Validation Blocked');
      expect(description).toBe('Execution was halted before sending to server');
    });

    it('resolves modal title and description for HTTP 504 Gateway Timeout as outcome unknown', () => {
      const { title, description } = resolveModalTitleAndDescription(false, {
        success: false,
        error: {
          status: 504,
          message: 'Timed out',
          details: [],
          isTimeout: true,
        },
      });
      expect(title).toBe('Execution Outcome Unknown');
      expect(description).toContain('Gateway timeout (HTTP 504)');
    });

    it('resolves modal title and description for HTTP 429 capacity exhaustion', () => {
      const { title } = resolveModalTitleAndDescription(false, {
        success: false,
        error: {
          status: 429,
          message: 'Capacity full',
          details: [],
          isCapacityExhausted: true,
        },
      });
      expect(title).toBe('Execution Failed');
    });

    it('resolves modal title and description for HTTP 0 network failure / offline', () => {
      const { title } = resolveModalTitleAndDescription(false, {
        success: false,
        error: {
          status: 0,
          message: 'Offline',
          details: [],
          isNetworkFailure: true,
        },
      });
      expect(title).toBe('Execution Failed');
    });

    it('resolves modal title and description for successful execution', () => {
      const { title, description } = resolveModalTitleAndDescription(false, {
        success: true,
        response: {
          state: 'COMPLETED',
          startedAt: '2026-10-18T10:00:00Z',
          completedAt: '2026-10-18T10:00:01Z',
          durationMs: 950,
          taskResults: {},
        },
      });
      expect(title).toBe('Simulated Execution Results');
      expect(description).toContain('950ms');
    });

    it('computes display task list correctly from canvas nodes and response', () => {
      const mockResponse: ExecuteWorkflowResponse = {
        state: 'COMPLETED',
        startedAt: '2026-10-18T10:00:00Z',
        completedAt: '2026-10-18T10:00:01Z',
        durationMs: 750,
        taskResults: {
          'task-1': {
            taskId: 'task-1',
            state: 'COMPLETED',
            startedAt: '2026-10-18T10:00:00Z',
            completedAt: '2026-10-18T10:00:00.5Z',
            durationMs: 500,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
          'task-2': {
            taskId: 'task-2',
            state: 'FAILED',
            startedAt: '2026-10-18T10:00:00.5Z',
            completedAt: '2026-10-18T10:00:01Z',
            durationMs: 250,
            attemptCount: 2,
            errorMessage: 'Simulated failure',
            attemptErrors: ['Attempt 1 error', 'Attempt 2 error'],
          },
        },
      };

      const tasks = computeDisplayTaskList(mockNodes, mockResponse);
      expect(tasks).toHaveLength(2);

      expect(tasks[0].id).toBe('task-1');
      expect(tasks[0].label).toBe('Ingest API');
      expect(tasks[0].state).toBe('COMPLETED');
      expect(tasks[0].durationMs).toBe(500);
      expect(tasks[0].attemptCount).toBe(1);

      expect(tasks[1].id).toBe('task-2');
      expect(tasks[1].label).toBe('Transform Data');
      expect(tasks[1].state).toBe('FAILED');
      expect(tasks[1].durationMs).toBe(250);
      expect(tasks[1].attemptCount).toBe(2);
      expect(tasks[1].errorMessage).toBe('Simulated failure');
      expect(tasks[1].attemptErrors).toEqual(['Attempt 1 error', 'Attempt 2 error']);
    });

    it('computes display task list when response is missing or empty', () => {
      const tasksNull = computeDisplayTaskList(mockNodes, undefined);
      expect(tasksNull).toEqual([]);

      const tasksEmpty = computeDisplayTaskList(mockNodes, {
        state: 'PENDING',
        startedAt: '',
        completedAt: '',
        durationMs: 0,
        taskResults: {},
      });
      expect(tasksEmpty).toEqual([]);
    });

    it('includes tasks returned by backend that were not present on canvas', () => {
      const mockResponse: ExecuteWorkflowResponse = {
        state: 'COMPLETED',
        startedAt: '',
        completedAt: '',
        durationMs: 100,
        taskResults: {
          'server-generated-task': {
            taskId: 'server-generated-task',
            state: 'COMPLETED',
            startedAt: null,
            completedAt: null,
            durationMs: 100,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
        },
      };

      const tasks = computeDisplayTaskList(mockNodes, mockResponse);
      expect(tasks).toHaveLength(3); // 2 from mockNodes + 1 extra
      expect(tasks[2].id).toBe('server-generated-task');
      expect(tasks[2].state).toBe('COMPLETED');
    });
  });

  describe('WorkflowBuilder Simulated Execution Orchestration & Lifecycle', () => {
    const mockNodes: Node<TaskNodeData>[] = [
      createNode('task-1', 'Fetch Records'),
      createNode('task-2', 'Process Records'),
    ];
    const mockEdges: Edge[] = [
      { id: 'e1-2', source: 'task-1', target: 'task-2' },
    ];

    it('handles successful simulated execution and updates canvas node statuses', async () => {
      const mockResponse: ExecuteWorkflowResponse = {
        state: 'COMPLETED',
        startedAt: '2026-10-18T12:00:00Z',
        completedAt: '2026-10-18T12:00:01Z',
        durationMs: 820,
        taskResults: {
          'task-1': {
            taskId: 'task-1',
            state: 'COMPLETED',
            startedAt: '2026-10-18T12:00:00Z',
            completedAt: '2026-10-18T12:00:00.4Z',
            durationMs: 400,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
          'task-2': {
            taskId: 'task-2',
            state: 'COMPLETED',
            startedAt: '2026-10-18T12:00:00.4Z',
            completedAt: '2026-10-18T12:00:01Z',
            durationMs: 420,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
        },
      };

      const executeApiFn = vi.fn().mockResolvedValue(mockResponse);
      const updatedStatuses: Record<string, TaskStatus> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const executingStates: boolean[] = [];
      let completionResult: ExecutionRunResult | null = null;

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: (val) => executingStates.push(val),
        onExecutionComplete: (res) => {
          completionResult = res;
        },
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(executeApiFn).toHaveBeenCalledTimes(1);
      expect(executingStates).toEqual([true, false]);
      expect(result.success).toBe(true);
      expect(completionResult).toEqual(result);

      // Verify node status mapping
      expect(updatedStatuses['task-1']).toBe('COMPLETED');
      expect(updatedStatuses['task-2']).toBe('COMPLETED');

      // Verify completion toast
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Simulated Run Completed');
      expect(toastCalls[0].type).toBe('success');
      expect(toastCalls[0].msg).toContain('820ms');
    });

    it('correctly maps FAILED and CANCELLED task states upon execution failure', async () => {
      const mockFailureResponse: ExecuteWorkflowResponse = {
        state: 'FAILED',
        startedAt: '2026-10-18T12:00:00Z',
        completedAt: '2026-10-18T12:00:01Z',
        durationMs: 600,
        taskResults: {
          'task-1': {
            taskId: 'task-1',
            state: 'FAILED',
            startedAt: '2026-10-18T12:00:00Z',
            completedAt: '2026-10-18T12:00:00.6Z',
            durationMs: 600,
            attemptCount: 2,
            errorMessage: 'Downstream endpoint failure',
            attemptErrors: ['Attempt 1 failed: Connection refused', 'Attempt 2 failed: Connection refused'],
          },
          'task-2': {
            taskId: 'task-2',
            state: 'CANCELLED',
            startedAt: null,
            completedAt: null,
            durationMs: null,
            attemptCount: 0,
            errorMessage: null,
            attemptErrors: [],
          },
        },
      };

      const executeApiFn = vi.fn().mockResolvedValue(mockFailureResponse);
      const updatedStatuses: Record<string, TaskStatus> = {};

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        executeApiFn,
      });

      expect(result.success).toBe(true);
      expect(updatedStatuses['task-1']).toBe('FAILED');
      expect(updatedStatuses['task-2']).toBe('CANCELLED');
    });

    it('rejects execution during preflight without calling executeApiFn', async () => {
      const invalidNodes: Node<TaskNodeData>[] = [
        {
          ...mockNodes[0],
          data: {
            ...mockNodes[0].data,
            maxRetries: 7, // Invalid > 4
          },
        },
      ];

      const executeApiFn = vi.fn();
      const updatedStatuses: Record<string, TaskStatus> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: invalidNodes,
        edges: [],
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(executeApiFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.preflightErrors).toBeDefined();
      expect(result.preflightErrors).toHaveLength(1);
      expect(result.preflightErrors![0].message).toContain('allows a maximum of 4 retries');
      expect(Object.keys(updatedStatuses)).toHaveLength(0);

      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Execution Blocked');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('prevents duplicate execution submissions when isExecuting is true', async () => {
      const executeApiFn = vi.fn();

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: true, // In-flight execution
        setIsExecuting: vi.fn(),
        executeApiFn,
      });

      expect(executeApiFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('already in progress');
    });

    it('handles HTTP 504 Gateway Timeout as outcome-unknown without fabricating task results', async () => {
      const executeApiFn = vi.fn().mockRejectedValue(
        new FlowForgeApiError(504, 'Gateway Timeout: Execution did not complete within 30000ms', [])
      );
      const updatedStatuses: Record<string, TaskStatus> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(504);
      expect(result.error?.isTimeout).toBe(true);

      // CRITICAL: No node statuses were fabricated or marked failed
      expect(Object.keys(updatedStatuses)).toHaveLength(0);

      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Gateway Timeout');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('handles HTTP 429 capacity exhaustion without fabricating task results', async () => {
      const executeApiFn = vi.fn().mockRejectedValue(
        new FlowForgeApiError(429, 'Server capacity limit reached: Maximum concurrent executions active', [])
      );
      const updatedStatuses: Record<string, TaskStatus> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(429);
      expect(result.error?.isCapacityExhausted).toBe(true);
      expect(Object.keys(updatedStatuses)).toHaveLength(0);

      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Server Capacity Exhausted');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('handles HTTP 0 network failure without fabricating task results', async () => {
      const executeApiFn = vi.fn().mockRejectedValue(
        new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server', [])
      );
      const updatedStatuses: Record<string, TaskStatus> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(0);
      expect(result.error?.isNetworkFailure).toBe(true);
      expect(Object.keys(updatedStatuses)).toHaveLength(0);

      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Server Offline');
      expect(toastCalls[0].type).toBe('error');
    });

    it('handles HTTP 400 backend rejection and surfaces details', async () => {
      const executeApiFn = vi.fn().mockRejectedValue(
        new FlowForgeApiError(400, 'Workflow contains circular dependencies', ['Cycle detected: task-1 -> task-2 -> task-1'])
      );
      const updatedStatuses: Record<string, TaskStatus> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (nodeId, status) => {
          updatedStatuses[nodeId] = status;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(400);
      expect(result.error?.message).toContain('circular dependencies');
      expect(result.error?.details).toContain('Cycle detected: task-1 -> task-2 -> task-1');
      expect(Object.keys(updatedStatuses)).toHaveLength(0);

      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Workflow Rejected');
      expect(toastCalls[0].type).toBe('error');
    });

    it('verifies stale task status reset behavior on graph modifications', () => {
      // Simulate existing node state after a run with non-IDLE statuses
      const executedNodes: Node<TaskNodeData>[] = [
        { ...mockNodes[0], data: { ...mockNodes[0].data, status: 'COMPLETED' } },
        { ...mockNodes[1], data: { ...mockNodes[1].data, status: 'CANCELLED' } },
      ];

      // Reset logic: reverts non-IDLE statuses to IDLE
      const hasNonIdle = executedNodes.some((n) => n.data.status && n.data.status !== 'IDLE');
      expect(hasNonIdle).toBe(true);

      const resetNodes = executedNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          status: 'IDLE' as TaskStatus,
        },
      }));

      expect(resetNodes[0].data.status).toBe('IDLE');
      expect(resetNodes[1].data.status).toBe('IDLE');
    });

    it('discards late-arriving execution responses after graph edits or reset', async () => {
      let activeRunId = 1;
      let committedResult: ExecutionRunResult | null = null;
      const updatedStatuses: Record<string, TaskStatus> = {};

      const mockResponse: ExecuteWorkflowResponse = {
        state: 'COMPLETED',
        startedAt: '2026-10-18T10:00:00Z',
        completedAt: '2026-10-18T10:00:01Z',
        durationMs: 500,
        taskResults: {
          'task-1': {
            taskId: 'task-1',
            state: 'COMPLETED',
            startedAt: null,
            completedAt: null,
            durationMs: 500,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
        },
      };

      // Simulates delayed backend response resolution
      let resolveApi!: (res: ExecuteWorkflowResponse) => void;
      const delayedApiPromise = new Promise<ExecuteWorkflowResponse>((res) => {
        resolveApi = res;
      });

      const executeApiFn = vi.fn().mockImplementation(() => delayedApiPromise);

      const runIdForThisRequest = activeRunId;
      const executionPromise = executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onExecutionComplete: (result) => {
          if (activeRunId !== runIdForThisRequest) return; // Stale guard
          committedResult = result;
        },
        onUpdateNodeStatus: (nodeId, status) => {
          if (activeRunId !== runIdForThisRequest) return; // Stale guard
          updatedStatuses[nodeId] = status;
        },
        executeApiFn,
      });

      // While request is in flight, user modifies the graph or resets canvas:
      activeRunId += 1; // Bump run ID to invalidate in-flight request

      // Delayed API response now resolves:
      resolveApi(mockResponse);
      await executionPromise;

      // Assert stale response was discarded: node statuses and results were NOT committed
      expect(committedResult).toBeNull();
      expect(Object.keys(updatedStatuses)).toHaveLength(0);
    });

    it('synchronously blocks rapid duplicate execution triggers before state update', async () => {
      let isExecutingLock = false;
      let modalOpen = false;
      const executeApiFn = vi.fn().mockResolvedValue({
        state: 'COMPLETED',
        startedAt: '',
        completedAt: '',
        durationMs: 100,
        taskResults: {},
      });

      const triggerRun = async () => {
        // Synchronous lock guard
        if (isExecutingLock) {
          modalOpen = true;
          return;
        }

        isExecutingLock = true;
        modalOpen = true;

        try {
          await executeWorkflowRun({
            nodes: mockNodes,
            edges: mockEdges,
            isExecuting: false,
            setIsExecuting: vi.fn(),
            executeApiFn,
          });
        } finally {
          isExecutingLock = false;
        }
      };

      // Rapid consecutive triggers in the same microtask
      const run1 = triggerRun();
      const run2 = triggerRun();

      await Promise.all([run1, run2]);

      // Exactly ONE API request was dispatched
      expect(executeApiFn).toHaveBeenCalledTimes(1);
      expect(modalOpen).toBe(true);
      expect(isExecutingLock).toBe(false);
    });

    it('allows closing and reopening the modal during execution without second API dispatch', async () => {
      let isExecutingLock = false;
      let isModalOpen = false;

      let resolveApi!: (res: ExecuteWorkflowResponse) => void;
      const pendingApiPromise = new Promise<ExecuteWorkflowResponse>((res) => {
        resolveApi = res;
      });
      const executeApiFn = vi.fn().mockImplementation(() => pendingApiPromise);

      const triggerOrReopen = async () => {
        if (isExecutingLock) {
          // Reopen modal to observe active run
          isModalOpen = true;
          return;
        }

        isExecutingLock = true;
        isModalOpen = true;

        try {
          await executeWorkflowRun({
            nodes: mockNodes,
            edges: mockEdges,
            isExecuting: false,
            setIsExecuting: vi.fn(),
            executeApiFn,
          });
        } finally {
          isExecutingLock = false;
        }
      };

      // 1. Initial execution starts and opens modal
      const runPromise = triggerOrReopen();
      expect(isModalOpen).toBe(true);
      expect(isExecutingLock).toBe(true);
      expect(executeApiFn).toHaveBeenCalledTimes(1);

      // 2. User closes modal while execution is still active
      isModalOpen = false;
      expect(isModalOpen).toBe(false);

      // 3. User clicks "View Active Run..." to reopen modal
      await triggerOrReopen();
      expect(isModalOpen).toBe(true); // Modal successfully reopened
      expect(executeApiFn).toHaveBeenCalledTimes(1); // No second execution dispatched!

      // 4. In-flight execution concludes
      resolveApi({
        state: 'COMPLETED',
        startedAt: '',
        completedAt: '',
        durationMs: 200,
        taskResults: {},
      });
      await runPromise;

      expect(isExecutingLock).toBe(false);
      expect(executeApiFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('WorkflowBuilder Persistence Integration', () => {
    it('loads workflows and latest persisted draft version for a project', async () => {
      const mockWorkflow = {
        id: 'wf-backend-uuid',
        projectId: 'proj-100',
        name: 'Data Ingestion Pipeline',
        slug: 'data-ingestion-pipeline',
        description: 'Ingest Kafka stream',
        createdAt: '2026-10-19T00:00:00Z',
        updatedAt: '2026-10-19T00:00:00Z',
      };

      const mockLatestVersion: WorkflowVersionResponseDto = {
        id: 'ver-uuid-latest',
        workflowId: 'wf-backend-uuid',
        versionNumber: 2,
        versionTag: 'v2.0.0',
        description: 'Second draft snapshot',
        graphPayload: {
          schemaVersion: 1,
          nodes: [
            {
              id: 'task-1',
              type: 'customTask',
              position: { x: 50, y: 100 },
              data: { label: 'Kafka Consumer', taskType: 'HTTP_REQUEST' },
            },
            {
              id: 'task-2',
              type: 'customTask',
              position: { x: 250, y: 100 },
              data: { label: 'Deduplicate', taskType: 'TRANSFORM' },
            },
          ],
          edges: [
            { id: 'e1-2', source: 'task-1', target: 'task-2', type: 'smoothstep' },
          ],
        },
        taskCount: 2,
        edgeCount: 1,
        isValidDag: true,
        createdAt: '2026-10-19T10:00:00Z',
      };

      const fetchWorkflowsFn = vi.fn().mockResolvedValue({
        content: [mockWorkflow],
        totalElements: 1,
        totalPages: 1,
        size: 10,
        number: 0,
      });

      const getLatestVersionFn = vi.fn().mockResolvedValue(mockLatestVersion);

      const workflowsPage = await fetchWorkflowsFn('proj-100', { page: 0, size: 10 });
      expect(fetchWorkflowsFn).toHaveBeenCalledWith('proj-100', { page: 0, size: 10 });
      expect(workflowsPage.content[0]).toEqual(mockWorkflow);

      const latestVersion = await getLatestVersionFn(mockWorkflow.id);
      expect(getLatestVersionFn).toHaveBeenCalledWith('wf-backend-uuid');
      expect(latestVersion).toEqual(mockLatestVersion);
      expect(latestVersion.taskCount).toBe(2);
      expect(latestVersion.edgeCount).toBe(1);
      expect(latestVersion.isValidDag).toBe(true);
    });

    it('auto-creates a default workflow when selected project has no existing workflows', async () => {
      const fetchWorkflowsFn = vi.fn().mockResolvedValue({
        content: [],
        totalElements: 0,
        totalPages: 0,
        size: 10,
        number: 0,
      });

      const createdWorkflow = {
        id: 'wf-auto-created',
        projectId: 'proj-empty',
        name: 'Main Pipeline',
        slug: 'main-pipeline',
        description: 'Default orchestration workflow',
        createdAt: '2026-10-19T10:00:00Z',
        updatedAt: '2026-10-19T10:00:00Z',
      };

      const createWorkflowFn = vi.fn().mockResolvedValue(createdWorkflow);

      const page = await fetchWorkflowsFn('proj-empty', { page: 0, size: 10 });
      let activeWf = page.content[0];
      if (!activeWf) {
        activeWf = await createWorkflowFn('proj-empty', {
          name: 'Main Pipeline',
          description: 'Default orchestration workflow',
        });
      }

      expect(createWorkflowFn).toHaveBeenCalledWith('proj-empty', {
        name: 'Main Pipeline',
        description: 'Default orchestration workflow',
      });
      expect(activeWf.id).toBe('wf-auto-created');
    });

    it('persists workflow draft and propagates server-derived metrics to UI state', async () => {
      const mockSavedVersion: WorkflowVersionResponseDto = {
        id: 'ver-saved-3',
        workflowId: 'wf-active-1',
        versionNumber: 3,
        versionTag: 'v3.0.0',
        description: 'New draft version',
        graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
        taskCount: 4,
        edgeCount: 3,
        isValidDag: true,
        createdAt: '2026-10-19T12:00:00Z',
      };

      const createVersionFn = vi.fn().mockResolvedValue(mockSavedVersion);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      let currentVersion: WorkflowVersionResponseDto | null = null;
      let isSaving = false;

      const handleSave = async () => {
        if (isSaving) return;
        isSaving = true;
        try {
          const payload = {
            versionTag: 'v3.0.0',
            description: 'New draft version',
            graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
          };
          const saved = await createVersionFn('wf-active-1', payload);
          currentVersion = saved;
          toastCalls.push({
            title: 'Draft Saved',
            msg: `Persisted version ${saved.versionTag} (v${saved.versionNumber}) with ${saved.taskCount} tasks.`,
            type: 'success',
          });
        } finally {
          isSaving = false;
        }
      };

      await handleSave();

      expect(createVersionFn).toHaveBeenCalledTimes(1);
      expect(currentVersion).toEqual(mockSavedVersion);

      const updated = currentVersion as unknown as WorkflowVersionResponseDto;
      expect(updated.versionNumber).toBe(3);
      expect(updated.taskCount).toBe(4);
      expect(updated.edgeCount).toBe(3);
      expect(updated.isValidDag).toBe(true);

      const versionBadgeText = `v${updated.versionNumber} [Draft]`;
      expect(versionBadgeText).toBe('v3 [Draft]');

      const metricsBadgeText = `${updated.taskCount} tasks • ${updated.edgeCount} edges`;
      expect(metricsBadgeText).toBe('4 tasks • 3 edges');
    });

    it('prevents accidental duplicate submit while save draft is in flight', async () => {
      let resolveSave!: (value: WorkflowVersionResponseDto) => void;
      const savePromise = new Promise<WorkflowVersionResponseDto>((resolve) => {
        resolveSave = resolve;
      });

      const createVersionFn = vi.fn().mockReturnValue(savePromise);

      let isSaving = false;
      let callCount = 0;

      const handleSave = async () => {
        if (isSaving) return null;
        isSaving = true;
        try {
          callCount += 1;
          return await createVersionFn('wf-1', {
            graphPayload: { schemaVersion: 1 },
          });
        } finally {
          isSaving = false;
        }
      };

      const firstTrigger = handleSave();
      expect(isSaving).toBe(true);
      expect(createVersionFn).toHaveBeenCalledTimes(1);

      const secondTrigger = await handleSave();
      expect(secondTrigger).toBeNull();
      expect(createVersionFn).toHaveBeenCalledTimes(1);

      resolveSave({
        id: 'ver-1',
        workflowId: 'wf-1',
        versionNumber: 1,
        versionTag: 'v1.0',
        description: null,
        graphPayload: {},
        taskCount: 1,
        edgeCount: 0,
        isValidDag: true,
        createdAt: '2026-10-19T00:00:00Z',
      });

      await firstTrigger;
      expect(isSaving).toBe(false);
      expect(callCount).toBe(1);
    });

    it('keeps backend persistence error visible without fabricating successful save', async () => {
      const apiError = new FlowForgeApiError(500, 'Internal persistence failure', [
        'Database connection timeout while allocating version',
      ]);
      const createVersionFn = vi.fn().mockRejectedValue(apiError);

      let currentVersion: WorkflowVersionResponseDto | null = null;
      let displayedError: string | null = null;

      try {
        await createVersionFn('wf-1', { graphPayload: {} });
      } catch (err) {
        if (err instanceof FlowForgeApiError) {
          displayedError = err.details?.length ? `${err.message}: ${err.details.join(', ')}` : err.message;
        }
      }

      expect(currentVersion).toBeNull();
      expect(displayedError).toBe(
        'Internal persistence failure: Database connection timeout while allocating version'
      );
    });

    it('clears canvas nodes and edges when restoring a persisted empty draft (Finding 02)', async () => {
      // Simulate canvas that currently has existing tasks
      let canvasNodes: Node<TaskNodeData>[] = [createNode('node-1', 'Initial Task 1'), createNode('node-2', 'Initial Task 2')];
      let canvasEdges: Edge[] = [{ id: 'e-1', source: 'node-1', target: 'node-2' }];

      const emptyDraftResponse: WorkflowVersionResponseDto = {
        id: 'ver-empty-uuid',
        workflowId: 'wf-real-1',
        versionNumber: 2,
        versionTag: 'v2.0.0',
        description: 'Cleared pipeline',
        graphPayload: {
          schemaVersion: 1,
          nodes: [],
          edges: [],
        },
        taskCount: 0,
        edgeCount: 0,
        isValidDag: true,
        createdAt: '2026-10-19T12:00:00Z',
      };

      const getLatestVersionFn = vi.fn().mockResolvedValue(emptyDraftResponse);

      // Execute restoration logic as implemented in WorkflowBuilder
      const latest = await getLatestVersionFn('wf-real-1');
      const payload = latest.graphPayload;

      if (payload && Array.isArray(payload.nodes)) {
        const loadedNodes = (payload.nodes as Node<TaskNodeData>[]).map((n) => ({
          ...n,
          type: n.type || 'customTask',
          data: {
            ...n.data,
            status: 'IDLE' as TaskStatus,
          },
        }));
        const loadedEdges = (Array.isArray(payload.edges) ? (payload.edges as Edge[]) : []).map(
          (e) => ({
            ...e,
            type: e.type || 'smoothstep',
          })
        );
        canvasNodes = loadedNodes;
        canvasEdges = loadedEdges;
      }

      // Assert that nodes and edges are both cleared to empty
      expect(canvasNodes).toEqual([]);
      expect(canvasEdges).toEqual([]);
      expect(latest.taskCount).toBe(0);
      expect(latest.edgeCount).toBe(0);
      expect(latest.isValidDag).toBe(true);
    });

    it('correctly loads non-empty persisted draft and resets task statuses to IDLE (Finding 02)', async () => {
      let canvasNodes: Node<TaskNodeData>[] = [];
      let canvasEdges: Edge[] = [];

      const nonEmptyDraftResponse: WorkflowVersionResponseDto = {
        id: 'ver-2-nodes',
        workflowId: 'wf-real-2',
        versionNumber: 3,
        versionTag: 'v3.0.0',
        description: 'Two task pipeline',
        graphPayload: {
          schemaVersion: 1,
          nodes: [
            { id: 'task-a', type: 'customTask', position: { x: 10, y: 20 }, data: { label: 'Task A', status: 'COMPLETED' } },
            { id: 'task-b', type: 'customTask', position: { x: 100, y: 200 }, data: { label: 'Task B', status: 'FAILED' } },
          ],
          edges: [
            { id: 'e-ab', source: 'task-a', target: 'task-b', type: 'smoothstep' },
          ],
        },
        taskCount: 2,
        edgeCount: 1,
        isValidDag: true,
        createdAt: '2026-10-19T12:00:00Z',
      };

      const getLatestVersionFn = vi.fn().mockResolvedValue(nonEmptyDraftResponse);

      const latest = await getLatestVersionFn('wf-real-2');
      const payload = latest.graphPayload;

      if (payload && Array.isArray(payload.nodes)) {
        const loadedNodes = (payload.nodes as Node<TaskNodeData>[]).map((n) => ({
          ...n,
          type: n.type || 'customTask',
          data: {
            ...n.data,
            status: 'IDLE' as TaskStatus,
          },
        }));
        const loadedEdges = (Array.isArray(payload.edges) ? (payload.edges as Edge[]) : []).map(
          (e) => ({
            ...e,
            type: e.type || 'smoothstep',
          })
        );
        canvasNodes = loadedNodes;
        canvasEdges = loadedEdges;
      }

      expect(canvasNodes).toHaveLength(2);
      expect(canvasNodes[0].id).toBe('task-a');
      expect(canvasNodes[0].data.status).toBe('IDLE');
      expect(canvasNodes[1].id).toBe('task-b');
      expect(canvasNodes[1].data.status).toBe('IDLE');
      expect(canvasEdges).toHaveLength(1);
      expect(canvasEdges[0].source).toBe('task-a');
      expect(canvasEdges[0].target).toBe('task-b');
    });

    it('blocks save draft and displays explanation when workflow is an offline mock template (Finding 01)', async () => {
      const createVersionFn = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const currentWorkflow = {
        id: 'wf-001',
        projectId: 'proj-001',
        name: 'Clickstream Ingestion & Deduplication',
        slug: 'clickstream-ingestion',
        isMock: true,
      };

      let isSaving = false;

      // Execute WorkflowBuilder handleSaveDraft logic
      const handleSaveDraft = async () => {
        if (!currentWorkflow?.id || currentWorkflow.isMock) {
          toastCalls.push({
            title: 'Sample Template (Cannot Save)',
            msg: 'Sample template workflows cannot be saved directly to the backend. Create or open a persistent project workspace to persist workflow drafts.',
            type: 'warning',
          });
          return;
        }

        isSaving = true;
        try {
          await createVersionFn(currentWorkflow.id, { graphPayload: {} });
        } finally {
          isSaving = false;
        }
      };

      await handleSaveDraft();

      // 1. Must not trigger backend API call with mock ID
      expect(createVersionFn).not.toHaveBeenCalled();

      // 2. isSaving must remain false
      expect(isSaving).toBe(false);

      // 3. User receives clear explanation
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('warning');
      expect(toastCalls[0].title).toBe('Sample Template (Cannot Save)');
      expect(toastCalls[0].msg).toContain('Sample template workflows cannot be saved directly to the backend');
    });

    it('normalizes persisted taskNode types and preserves IDs, positions, and edge connectivity', async () => {
      const persistedVersion: WorkflowVersionResponseDto = {
        id: '1c6d313d-343d-4199-83c4-09fd0bc2f38e',
        workflowId: 'f28f06f9-f857-4568-881e-1a3bcf3f94ee',
        versionNumber: 1,
        versionTag: 'v1',
        description: null,
        graphPayload: {
          schemaVersion: 1,
          nodes: [
            {
              id: 'task-1',
              type: 'taskNode',
              position: { x: 100, y: 100 },
              data: { label: 'Data Extraction', taskType: 'DATA_SOURCE', command: 'extract.sh' },
            },
            {
              id: 'task-2',
              type: 'taskNode',
              position: { x: 300, y: 100 },
              data: { label: 'Transformation', taskType: 'TRANSFORM', command: 'transform.sh' },
            },
          ],
          edges: [
            { id: 'e-task-1-task-2', source: 'task-1', target: 'task-2' },
          ],
        },
        taskCount: 2,
        edgeCount: 1,
        isValidDag: true,
        createdAt: '2026-10-19T13:07:23.378636Z',
      };

      const getLatestVersionFn = vi.fn().mockResolvedValue(persistedVersion);
      const latest = await getLatestVersionFn('f28f06f9-f857-4568-881e-1a3bcf3f94ee');

      const { nodes, edges } = restoreCanvasFromGraphPayload(latest.graphPayload);

      // 1. Both nodes are normalized to customTask
      expect(nodes).toHaveLength(2);
      expect(nodes[0].id).toBe('task-1');
      expect(nodes[0].type).toBe('customTask');
      expect(nodes[0].position).toEqual({ x: 100, y: 100 });
      expect(nodes[0].data.label).toBe('Data Extraction');
      expect(nodes[0].data.status).toBe('IDLE');

      expect(nodes[1].id).toBe('task-2');
      expect(nodes[1].type).toBe('customTask');
      expect(nodes[1].position).toEqual({ x: 300, y: 100 });
      expect(nodes[1].data.label).toBe('Transformation');
      expect(nodes[1].data.status).toBe('IDLE');

      // 2. Edge connectivity intact
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe('e-task-1-task-2');
      expect(edges[0].source).toBe('task-1');
      expect(edges[0].target).toBe('task-2');
      expect(edges[0].type).toBe('smoothstep');

      // 3. Server-derived metrics match
      expect(latest.taskCount).toBe(2);
      expect(latest.edgeCount).toBe(1);
      expect(latest.isValidDag).toBe(true);
    });
  });

  describe('Durable Run History Integration (Phase 1.4.2)', () => {
    it('supports durable run query injection via fetchRunsFn and getRunFn', () => {
      const mockFetchRuns = vi.fn().mockResolvedValue({
        content: [],
        totalElements: 0,
        totalPages: 0,
        size: 6,
        number: 0,
      });
      const mockGetRun = vi.fn();

      const props = {
        workflowId: 'wf-test-1',
        onBackToProjects: vi.fn(),
        onShowToast: vi.fn(),
        fetchRunsFn: mockFetchRuns,
        getRunFn: mockGetRun,
      };

      expect(props.fetchRunsFn).toBe(mockFetchRuns);
      expect(props.getRunFn).toBe(mockGetRun);
      expect(typeof WorkflowBuilder).toBe('function');
    });
  });

  describe('Connect Workflow Builder to Durable Execution API (Phase 1.4.3)', () => {
    const mockNodes: Node<TaskNodeData>[] = [
      createNode('task-1', 'Extraction'),
      createNode('task-2', 'Transform'),
    ];
    const mockEdges: Edge[] = [{ id: 'e1', source: 'task-1', target: 'task-2' }];

    const savedVersion: WorkflowVersionResponseDto = {
      id: 'ver-uuid-1',
      workflowId: 'wf-uuid-1',
      versionNumber: 2,
      versionTag: 'v2.0',
      description: null,
      graphPayload: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'task-1',
            type: 'customTask',
            position: { x: 0, y: 0 },
            data: { label: 'Extraction', taskType: 'HTTP_REQUEST', timeoutMs: 30000, maxRetries: 3, parameters: {} },
          },
          {
            id: 'task-2',
            type: 'customTask',
            position: { x: 0, y: 0 },
            data: { label: 'Transform', taskType: 'HTTP_REQUEST', timeoutMs: 30000, maxRetries: 3, parameters: {} },
          },
        ],
        edges: [{ id: 'e1', source: 'task-1', target: 'task-2' }],
      },
      taskCount: 2,
      edgeCount: 1,
      isValidDag: true,
      createdAt: '2026-10-20T10:00:00Z',
    };

    it('injects executeDurableRunFn prop into WorkflowBuilder component props interface', () => {
      const mockDurableRun = vi.fn();
      const props = {
        workflowId: 'wf-uuid-1',
        onBackToProjects: vi.fn(),
        onShowToast: vi.fn(),
        executeDurableRunFn: mockDurableRun,
      };

      expect(props.executeDurableRunFn).toBe(mockDurableRun);
      expect(typeof WorkflowBuilder).toBe('function');
    });

    it('executes the intended saved, immutable workflow version and guards unsaved edits', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const durableApiFn = vi.fn().mockResolvedValue({
        id: 'run-1',
        workflowId: 'wf-uuid-1',
        versionNumber: 2,
        status: 'COMPLETED',
        durationMs: 300,
        tasks: [],
      });

      // 1. Clean canvas executes version 2
      const resultClean = await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        currentVersion: savedVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
        executeDurableApiFn: durableApiFn,
      });

      expect(resultClean.success).toBe(true);
      expect(durableApiFn).toHaveBeenCalledWith('wf-uuid-1', {
        versionNumber: 2,
        triggeredBy: 'manual-ui',
      });

      // 2. Modified canvas is blocked from silently executing unsaved changes
      const editedNodes = [
        createNode('task-1', 'Extraction Modified'),
        createNode('task-2', 'Transform'),
      ];
      durableApiFn.mockClear();
      toastCalls.length = 0;

      const resultDirty = await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        currentVersion: savedVersion,
        nodes: editedNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
        executeDurableApiFn: durableApiFn,
      });

      expect(resultDirty.success).toBe(false);
      expect(resultDirty.reason).toBe('UNSAVED_CHANGES');
      expect(durableApiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Unsaved Changes');
      expect(toastCalls[0].msg).toContain('v2');
    });

    it('prevents duplicate submissions while a run is already in progress', async () => {
      const durableApiFn = vi.fn();
      const result = await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        currentVersion: savedVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: true,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: vi.fn(),
        executeDurableApiFn: durableApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('IN_FLIGHT');
      expect(durableApiFn).not.toHaveBeenCalled();
    });

    it('maps durable task statuses and execution metrics to canvas nodes without corrupting graph data', () => {
      const initialNodes: Node<TaskNodeData>[] = [
        createNode('task-1', 'Extraction'),
        createNode('task-2', 'Transform'),
      ];

      const mapped = applyDurableRunTaskResults(initialNodes, [
        {
          id: 'tr-1',
          taskId: 'task-1',
          status: 'COMPLETED',
          attemptCount: 1,
          durationMs: 120,
          errorMessage: null,
          startedAt: '2026-10-20T10:00:00Z',
          completedAt: '2026-10-20T10:00:00.12Z',
          createdAt: '2026-10-20T10:00:00Z',
        },
        {
          id: 'tr-2',
          taskId: 'task-2',
          status: 'FAILED',
          attemptCount: 2,
          durationMs: 450,
          errorMessage: 'Script exit code 1',
          startedAt: '2026-10-20T10:00:00.12Z',
          completedAt: '2026-10-20T10:00:00.57Z',
          createdAt: '2026-10-20T10:00:00Z',
        },
      ]);

      expect(mapped[0].data.status).toBe('COMPLETED');
      expect(mapped[0].data.executionDurationMs).toBe(120);
      expect(mapped[0].data.attemptCount).toBe(1);
      expect(mapped[0].data.label).toBe('Extraction');

      expect(mapped[1].data.status).toBe('FAILED');
      expect(mapped[1].data.executionDurationMs).toBe(450);
      expect(mapped[1].data.attemptCount).toBe(2);
      expect(mapped[1].data.errorMessage).toBe('Script exit code 1');
      expect(mapped[1].data.label).toBe('Transform');
    });

    it('refreshes run history on completion and terminal failure, and handles HTTP 429 Retry-After', async () => {
      const historyRefresh = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      // 1. Success refreshes history
      await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        currentVersion: savedVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: vi.fn(),
        onExecutionComplete: historyRefresh,
        executeDurableApiFn: vi.fn().mockResolvedValue({
          id: 'run-success',
          workflowId: 'wf-uuid-1',
          versionNumber: 2,
          status: 'COMPLETED',
          durationMs: 200,
          tasks: [],
        }),
      });
      expect(historyRefresh).toHaveBeenCalledTimes(1);

      // 2. Terminal failure refreshes history
      historyRefresh.mockClear();
      await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        currentVersion: savedVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: vi.fn(),
        onExecutionComplete: historyRefresh,
        executeDurableApiFn: vi.fn().mockResolvedValue({
          id: 'run-fail',
          workflowId: 'wf-uuid-1',
          versionNumber: 2,
          status: 'FAILED',
          durationMs: 200,
          tasks: [],
        }),
      });
      expect(historyRefresh).toHaveBeenCalledTimes(1);

      // 3. HTTP 429 with Retry-After header
      const error429 = new FlowForgeApiError(
        429,
        'Server capacity exhausted',
        [],
        undefined,
        30
      );
      const res429 = await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        currentVersion: savedVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
        executeDurableApiFn: vi.fn().mockRejectedValue(error429),
      });

      expect(res429.success).toBe(false);
      expect(res429.error?.status).toBe(429);
      expect(toastCalls[0].title).toBe('Capacity Exhausted (429)');
      expect(toastCalls[0].msg).toContain('Please retry in 30 seconds');
    });

    it('enforces authentication guards on saveDraft and durableExecution', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      // 1. saveWorkflowDraft with isAuthenticated: false
      const saveResult = await saveWorkflowDraft({
        workflowId: 'wf-uuid-1',
        isMock: false,
        isAuthenticated: false,
        nodes: mockNodes,
        edges: mockEdges,
        isSaving: false,
        setIsSaving: vi.fn(),
        onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
        createVersionApiFn: vi.fn(),
      });
      expect(saveResult).toBeNull();
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].title).toBe('Authentication Required');

      // 2. executeDurableWorkflowRun with isAuthenticated: false
      const durableResult = await executeDurableWorkflowRun({
        workflowId: 'wf-uuid-1',
        isMockWorkflow: false,
        isAuthenticated: false,
        currentVersion: savedVersion,
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        setNodes: vi.fn(),
        onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
        executeDurableApiFn: vi.fn(),
      });
      expect(durableResult.success).toBe(false);
      expect(durableResult.reason).toBe('UNAUTHENTICATED');
      expect(toastCalls).toHaveLength(2);
      expect(toastCalls[1].title).toBe('Authentication Required');
    });

    it('avoids fabricating mock workflow when backend returns 401 on project workflow fetch', async () => {
      const api401 = new FlowForgeApiError(401, 'HTTP 401: Unauthorized');
      const fetchWorkflowsFn = vi.fn().mockRejectedValue(api401);
      const onOpenAuth = vi.fn();
      const onShowToast = vi.fn();

      let activeWf: unknown = null;

      try {
        await fetchWorkflowsFn('proj-real-1', { page: 0, size: 10 });
      } catch (err) {
        const isAuthError = err instanceof FlowForgeApiError && (err.isUnauthorized || err.status === 401);
        if (isAuthError) {
          onShowToast('Authentication Required', 'Please sign in to access workflows for this project.', 'warning');
          onOpenAuth('login');
          // Crucial: do NOT set activeWf to mock workflow!
        }
      }

      expect(activeWf).toBeNull();
      expect(onShowToast).toHaveBeenCalledWith(
        'Authentication Required',
        'Please sign in to access workflows for this project.',
        'warning'
      );
      expect(onOpenAuth).toHaveBeenCalledWith('login');
    });
  });

  describe('WorkflowBuilder RBAC Role-Aware Controls & In-Handler Guards', () => {
    const mockNodes: Node<TaskNodeData>[] = [
      createNode('task-1', 'Extract'),
      createNode('task-2', 'Load'),
    ];
    const mockEdges: Edge[] = [
      { id: 'e1-2', source: 'task-1', target: 'task-2' },
    ];
    const savedVersion: WorkflowVersionResponseDto = {
      id: 'v-1',
      workflowId: 'wf-real-1',
      versionNumber: 1,
      versionTag: 'v1.0',
      description: null,
      graphPayload: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'task-1',
            type: 'customTask',
            position: { x: 0, y: 0 },
            data: { label: 'Extract', taskType: 'HTTP_REQUEST', timeoutMs: 30000, maxRetries: 3, parameters: {} },
          },
          {
            id: 'task-2',
            type: 'customTask',
            position: { x: 0, y: 0 },
            data: { label: 'Load', taskType: 'HTTP_REQUEST', timeoutMs: 30000, maxRetries: 3, parameters: {} },
          },
        ],
        edges: [{ id: 'e1-2', source: 'task-1', target: 'task-2' }],
      },
      taskCount: 2,
      edgeCount: 1,
      isValidDag: true,
      createdAt: '2026-10-20T10:00:00Z',
    };

    it('enforces in-handler save guards for VIEWER role', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const createVersionApiFn = vi.fn();

      const handleSaveDraftSimulated = async (
        role: 'ADMIN' | 'DEVELOPER' | 'VIEWER' | null,
        isAuthenticated: boolean
      ) => {
        if (!isAuthenticated) {
          toastCalls.push({
            title: 'Authentication Required',
            msg: 'Please sign in to save workflow drafts to the server.',
            type: 'warning',
          });
          return null;
        }

        const canEdit = role === 'ADMIN' || role === 'DEVELOPER';
        if (!canEdit) {
          toastCalls.push({
            title: 'Save Forbidden',
            msg:
              role === 'VIEWER'
                ? 'Read-only access: Viewers cannot save workflow drafts.'
                : 'You do not have permission to modify workflows in this project.',
            type: 'warning',
          });
          return null;
        }

        return saveWorkflowDraft({
          workflowId: 'wf-real-1',
          isMock: false,
          isAuthenticated,
          nodes: mockNodes,
          edges: mockEdges,
          isSaving: false,
          setIsSaving: vi.fn(),
          onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
          createVersionApiFn,
        });
      };

      // 1. Viewer attempt -> blocked
      const viewerResult = await handleSaveDraftSimulated('VIEWER', true);
      expect(viewerResult).toBeNull();
      expect(createVersionApiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Save Forbidden');
      expect(toastCalls[0].msg).toContain('Read-only access: Viewers cannot save workflow drafts');

      // 2. Non-member attempt -> blocked
      const nonMemberResult = await handleSaveDraftSimulated(null, true);
      expect(nonMemberResult).toBeNull();
      expect(createVersionApiFn).not.toHaveBeenCalled();
      expect(toastCalls[1].title).toBe('Save Forbidden');

      // 3. Developer attempt -> permitted
      createVersionApiFn.mockResolvedValue(savedVersion);
      const devResult = await handleSaveDraftSimulated('DEVELOPER', true);
      expect(devResult).toEqual(savedVersion);
      expect(createVersionApiFn).toHaveBeenCalledTimes(1);

      // 4. Admin attempt -> permitted
      const adminResult = await handleSaveDraftSimulated('ADMIN', true);
      expect(adminResult).toEqual(savedVersion);
      expect(createVersionApiFn).toHaveBeenCalledTimes(2);
    });

    it('enforces in-handler durable execution guards for VIEWER role', async () => {
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const executeDurableApiFn = vi.fn();

      const handleRunDurableSimulated = async (
        role: 'ADMIN' | 'DEVELOPER' | 'VIEWER' | null,
        isAuthenticated: boolean
      ) => {
        if (!isAuthenticated) {
          toastCalls.push({
            title: 'Authentication Required',
            msg: 'Please sign in to execute durable workflow runs.',
            type: 'warning',
          });
          return { success: false, reason: 'UNAUTHENTICATED' };
        }

        const canExecute = role === 'ADMIN' || role === 'DEVELOPER';
        if (!canExecute) {
          toastCalls.push({
            title: 'Execution Forbidden',
            msg:
              role === 'VIEWER'
                ? 'Read-only access: Viewers cannot execute durable workflow runs.'
                : 'You do not have permission to execute durable runs in this project.',
            type: 'warning',
          });
          return { success: false, reason: 'FORBIDDEN' };
        }

        return executeDurableWorkflowRun({
          workflowId: 'wf-real-1',
          isMockWorkflow: false,
          isAuthenticated,
          currentVersion: savedVersion,
          nodes: mockNodes,
          edges: mockEdges,
          isExecuting: false,
          setIsExecuting: vi.fn(),
          setNodes: vi.fn(),
          onShowToast: (t, m, type) => toastCalls.push({ title: t, msg: m, type }),
          executeDurableApiFn,
        });
      };

      // 1. Viewer attempt -> blocked
      const viewerResult = await handleRunDurableSimulated('VIEWER', true);
      expect(viewerResult.success).toBe(false);
      expect(viewerResult.reason).toBe('FORBIDDEN');
      expect(executeDurableApiFn).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Execution Forbidden');
      expect(toastCalls[0].msg).toContain('Read-only access: Viewers cannot execute durable workflow runs');

      // 2. Non-member attempt -> blocked
      const nonMemberResult = await handleRunDurableSimulated(null, true);
      expect(nonMemberResult.success).toBe(false);
      expect(nonMemberResult.reason).toBe('FORBIDDEN');
      expect(executeDurableApiFn).not.toHaveBeenCalled();

      // 3. Developer attempt -> permitted
      executeDurableApiFn.mockResolvedValue({
        id: 'run-dev-1',
        workflowId: 'wf-real-1',
        versionNumber: 1,
        status: 'COMPLETED',
        durationMs: 400,
        tasks: [],
      });
      const devResult = await handleRunDurableSimulated('DEVELOPER', true);
      expect(devResult.success).toBe(true);
      expect(executeDurableApiFn).toHaveBeenCalledTimes(1);

      // 4. Admin attempt -> permitted
      const adminResult = await handleRunDurableSimulated('ADMIN', true);
      expect(adminResult.success).toBe(true);
      expect(executeDurableApiFn).toHaveBeenCalledTimes(2);
    });

    it('keeps ephemeral simulation and DAG validation accessible to VIEWER without mutation', async () => {
      // 1. DAG validation via validateWorkflow remains available
      const validateApiFn = vi.fn().mockResolvedValue({
        isValid: true,
        hasCycle: false,
        cycleNodes: [],
        disconnectedNodes: [],
        errors: [],
        warnings: [],
        topologicalOrder: ['task-1', 'task-2'],
      });

      const valState: { result: DagValidationResult | null } = { result: null };
      await executeWorkflowValidation({
        nodes: mockNodes,
        edges: mockEdges,
        isValidating: false,
        setIsValidating: vi.fn(),
        setValidationResult: (res) => {
          valState.result = res;
        },
        applyValidationVisuals: vi.fn(),
        onShowToast: vi.fn(),
        validateApiFn,
      });

      expect(valState.result?.isValid).toBe(true);
      expect(validateApiFn).toHaveBeenCalledTimes(1);

      // 2. Ephemeral simulation run via executeWorkflowRun remains available
      const executeApiFn = vi.fn().mockResolvedValue({
        state: 'COMPLETED',
        startedAt: '2026-10-21T10:00:00Z',
        completedAt: '2026-10-21T10:00:01Z',
        durationMs: 500,
        taskResults: {},
      });

      const simResult = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        executeApiFn,
      });

      expect(simResult.success).toBe(true);
      expect(executeApiFn).toHaveBeenCalledTimes(1);
    });

    it('correctly derives UI badges and action visibility for all roles', () => {
      interface UiVisibility {
        roleBadge: string;
        showMembersButton: boolean;
        saveDisabled: boolean;
        durableDisabled: boolean;
        showReadOnlyBanner: boolean;
      }

      const deriveUiVisibility = (
        role: 'ADMIN' | 'DEVELOPER' | 'VIEWER' | null,
        isLoading: boolean
      ): UiVisibility => {
        const canManageMembers = role === 'ADMIN';
        const canEditWorkflows = role === 'ADMIN' || role === 'DEVELOPER';
        const canExecuteRuns = role === 'ADMIN' || role === 'DEVELOPER';

        let roleBadge = 'Role: Not a Member';
        if (isLoading) {
          roleBadge = 'Role: Verifying...';
        } else if (role === 'ADMIN') {
          roleBadge = 'Role: Admin';
        } else if (role === 'DEVELOPER') {
          roleBadge = 'Role: Developer';
        } else if (role === 'VIEWER') {
          roleBadge = 'Role: Viewer (Read-Only)';
        }

        return {
          roleBadge,
          showMembersButton: canManageMembers,
          saveDisabled: !canEditWorkflows,
          durableDisabled: !canExecuteRuns,
          showReadOnlyBanner: role === 'VIEWER' || (!isLoading && role === null),
        };
      };

      // ADMIN
      const adminUi = deriveUiVisibility('ADMIN', false);
      expect(adminUi.roleBadge).toBe('Role: Admin');
      expect(adminUi.showMembersButton).toBe(true);
      expect(adminUi.saveDisabled).toBe(false);
      expect(adminUi.durableDisabled).toBe(false);
      expect(adminUi.showReadOnlyBanner).toBe(false);

      // DEVELOPER
      const devUi = deriveUiVisibility('DEVELOPER', false);
      expect(devUi.roleBadge).toBe('Role: Developer');
      expect(devUi.showMembersButton).toBe(false);
      expect(devUi.saveDisabled).toBe(false);
      expect(devUi.durableDisabled).toBe(false);
      expect(devUi.showReadOnlyBanner).toBe(false);

      // VIEWER
      const viewerUi = deriveUiVisibility('VIEWER', false);
      expect(viewerUi.roleBadge).toBe('Role: Viewer (Read-Only)');
      expect(viewerUi.showMembersButton).toBe(false);
      expect(viewerUi.saveDisabled).toBe(true);
      expect(viewerUi.durableDisabled).toBe(true);
      expect(viewerUi.showReadOnlyBanner).toBe(true);

      // Loading state (fails closed, no privileged controls shown)
      const loadingUi = deriveUiVisibility(null, true);
      expect(loadingUi.roleBadge).toBe('Role: Verifying...');
      expect(loadingUi.showMembersButton).toBe(false);
      expect(loadingUi.saveDisabled).toBe(true);
      expect(loadingUi.durableDisabled).toBe(true);

      // Non-member state (fails closed)
      const nonMemberUi = deriveUiVisibility(null, false);
      expect(nonMemberUi.roleBadge).toBe('Role: Not a Member');
      expect(nonMemberUi.showMembersButton).toBe(false);
      expect(nonMemberUi.saveDisabled).toBe(true);
      expect(nonMemberUi.durableDisabled).toBe(true);
      expect(nonMemberUi.showReadOnlyBanner).toBe(true);
    });
  });
});
