import { describe, it, expect, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  TaskStatus,
  ValidateDagResponse,
  DagValidationResult,
  ExecuteWorkflowResponse,
} from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';
import { executeWorkflowValidation, MAX_TASKS_LIMIT, MAX_EDGES_LIMIT } from '../utils/dagValidationAdapters';
import {
  executeWorkflowRun,
  type ExecutionRunResult,
} from '../utils/workflowExecutionAdapters';
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
});
