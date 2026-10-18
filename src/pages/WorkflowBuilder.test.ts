import { describe, it, expect, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type { TaskNodeData, ValidateDagResponse, DagValidationResult } from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';
import { executeWorkflowValidation, MAX_TASKS_LIMIT, MAX_EDGES_LIMIT } from '../utils/dagValidationAdapters';
import { WorkflowBuilder } from './WorkflowBuilder';

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
});
