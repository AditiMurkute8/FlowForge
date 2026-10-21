import { describe, it, expect, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  WorkflowVersionResponseDto,
} from '../types';
import {
  buildGraphPayloadFromCanvas,
  saveWorkflowDraft,
  normalizePersistedNode,
  restoreCanvasFromGraphPayload,
} from './workflowPersistenceAdapters';
import { FlowForgeApiError } from '../api/flowForgeApi';

function createTestNode(
  id: string,
  label: string,
  overrides?: Partial<TaskNodeData> & { isCycle?: boolean; executionDurationMs?: number }
): Node<TaskNodeData> {
  return {
    id,
    type: 'customTask',
    position: { x: 120.456, y: 240.789 },
    data: {
      label,
      taskType: 'HTTP_REQUEST',
      timeoutMs: 30000,
      maxRetries: 3,
      parameters: { endpoint: '/api/v1/data', method: 'POST' },
      status: 'COMPLETED',
      ...overrides,
    },
  };
}

describe('workflowPersistenceAdapters', () => {
  describe('buildGraphPayloadFromCanvas', () => {
    it('creates canonical graph snapshot and strips transient runtime execution telemetry', () => {
      const nodes: Node<TaskNodeData>[] = [
        createTestNode('task-1', 'Fetch Payload', {
          status: 'COMPLETED',
          executionDurationMs: 420,
          isCycle: false,
        }),
        createTestNode('task-2', 'Transform Records', {
          status: 'FAILED',
          executionDurationMs: 125,
          isCycle: true,
        }),
      ];

      const edges: Edge[] = [
        { id: 'e1-2', source: 'task-1', target: 'task-2', type: 'smoothstep' },
      ];

      const viewport = { x: 10, y: 20, zoom: 1.25 };

      const payload = buildGraphPayloadFromCanvas(nodes, edges, viewport);

      expect(payload.schemaVersion).toBe(1);
      expect(payload.viewport).toEqual(viewport);

      const payloadNodes = payload.nodes as Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        data: Record<string, unknown>;
      }>;

      expect(payloadNodes).toHaveLength(2);

      // Verify node 1
      expect(payloadNodes[0].id).toBe('task-1');
      expect(payloadNodes[0].type).toBe('customTask');
      expect(payloadNodes[0].position).toEqual({ x: 120.46, y: 240.79 });
      expect(payloadNodes[0].data.label).toBe('Fetch Payload');
      expect(payloadNodes[0].data.taskType).toBe('HTTP_REQUEST');
      expect(payloadNodes[0].data.parameters).toEqual({ endpoint: '/api/v1/data', method: 'POST' });

      // Transient fields MUST be stripped
      expect(payloadNodes[0].data.status).toBeUndefined();
      expect(payloadNodes[0].data.executionDurationMs).toBeUndefined();
      expect(payloadNodes[0].data.isCycle).toBeUndefined();

      // Verify node 2
      expect(payloadNodes[1].id).toBe('task-2');
      expect(payloadNodes[1].data.label).toBe('Transform Records');
      expect(payloadNodes[1].data.status).toBeUndefined();
      expect(payloadNodes[1].data.executionDurationMs).toBeUndefined();
      expect(payloadNodes[1].data.isCycle).toBeUndefined();

      // Verify edges
      const payloadEdges = payload.edges as Array<{
        id: string;
        source: string;
        target: string;
        type: string;
      }>;
      expect(payloadEdges).toEqual([
        { id: 'e1-2', source: 'task-1', target: 'task-2', type: 'smoothstep' },
      ]);
    });

    it('handles empty canvas nodes and edges without error', () => {
      const payload = buildGraphPayloadFromCanvas([], []);
      expect(payload.schemaVersion).toBe(1);
      expect(payload.nodes).toEqual([]);
      expect(payload.edges).toEqual([]);
      expect(payload.viewport).toBeUndefined();
    });
  });

  describe('saveWorkflowDraft', () => {
    const mockNodes: Node<TaskNodeData>[] = [
      createTestNode('node-1', 'Extract'),
      createTestNode('node-2', 'Load'),
    ];
    const mockEdges: Edge[] = [
      { id: 'e1-2', source: 'node-1', target: 'node-2' },
    ];

    it('successfully saves valid DAG workflow-version and returns server-persisted response', async () => {
      const mockServerResponse: WorkflowVersionResponseDto = {
        id: 'ver-uuid-1',
        workflowId: 'wf-uuid-100',
        versionNumber: 3,
        versionTag: 'v3.0.0',
        description: 'Updated draft',
        graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
        taskCount: 2,
        edgeCount: 1,
        isValidDag: true,
        createdAt: '2026-10-19T12:00:00Z',
      };

      const createVersionApiFn = vi.fn().mockResolvedValue(mockServerResponse);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const savingStates: boolean[] = [];
      let savedVersionResult: WorkflowVersionResponseDto | null = null;

      const result = await saveWorkflowDraft({
        workflowId: 'wf-uuid-100',
        nodes: mockNodes,
        edges: mockEdges,
        versionTag: 'v3.0.0',
        description: 'Updated draft',
        isSaving: false,
        setIsSaving: (s) => savingStates.push(s),
        onSaveSuccess: (saved) => {
          savedVersionResult = saved;
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        createVersionApiFn,
      });

      expect(createVersionApiFn).toHaveBeenCalledTimes(1);
      const callArgs = createVersionApiFn.mock.calls[0];
      expect(callArgs[0]).toBe('wf-uuid-100');
      expect(callArgs[1].versionTag).toBe('v3.0.0');
      expect(callArgs[1].description).toBe('Updated draft');
      expect(callArgs[1].graphPayload.schemaVersion).toBe(1);

      expect(savingStates).toEqual([true, false]);
      expect(result).toEqual(mockServerResponse);
      expect(savedVersionResult).toEqual(mockServerResponse);

      // Server-derived metrics and version number should be in the toast
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('success');
      expect(toastCalls[0].title).toBe('Draft Saved');
      expect(toastCalls[0].msg).toContain('v3');
      expect(toastCalls[0].msg).toContain('2 tasks');
    });

    it('preserves draft with warning toast when server identifies cycles (isValidDag = false)', async () => {
      const mockCyclicResponse: WorkflowVersionResponseDto = {
        id: 'ver-uuid-cyclic',
        workflowId: 'wf-uuid-100',
        versionNumber: 4,
        versionTag: 'v4.0.0',
        description: 'Draft with cycle',
        graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
        taskCount: 2,
        edgeCount: 2,
        isValidDag: false,
        createdAt: '2026-10-19T12:05:00Z',
      };

      const createVersionApiFn = vi.fn().mockResolvedValue(mockCyclicResponse);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await saveWorkflowDraft({
        workflowId: 'wf-uuid-100',
        nodes: mockNodes,
        edges: mockEdges,
        isSaving: false,
        setIsSaving: () => {},
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        createVersionApiFn,
      });

      expect(result?.isValidDag).toBe(false);
      expect(result?.versionNumber).toBe(4);
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('warning');
      expect(toastCalls[0].title).toContain('Cyclic');
      expect(toastCalls[0].msg).toContain('cycles or invalid dependencies');
    });

    it('enforces duplicate-submit prevention when isSaving is true', async () => {
      const createVersionApiFn = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await saveWorkflowDraft({
        workflowId: 'wf-uuid-100',
        nodes: mockNodes,
        edges: mockEdges,
        isSaving: true, // Already in flight!
        setIsSaving: () => {},
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        createVersionApiFn,
      });

      expect(result).toBeNull();
      expect(createVersionApiFn).not.toHaveBeenCalled();
      expect(toastCalls).toHaveLength(0);
    });

    it('rejects empty or whitespace workflowId without calling API', async () => {
      const createVersionApiFn = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await saveWorkflowDraft({
        workflowId: '   ',
        nodes: mockNodes,
        edges: mockEdges,
        isSaving: false,
        setIsSaving: () => {},
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        createVersionApiFn,
      });

      expect(result).toBeNull();
      expect(createVersionApiFn).not.toHaveBeenCalled();
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('error');
      expect(toastCalls[0].title).toBe('Save Failed');
    });

    it('keeps backend errors visible without fabricating successful save on API failure', async () => {
      const backendError = new FlowForgeApiError(
        400,
        'Invalid graph structure',
        ['Task bounds exceeded: maximum 200 nodes allowed']
      );
      const createVersionApiFn = vi.fn().mockRejectedValue(backendError);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const savingStates: boolean[] = [];
      let onSaveSuccessCalled = false;

      await expect(
        saveWorkflowDraft({
          workflowId: 'wf-uuid-100',
          nodes: mockNodes,
          edges: mockEdges,
          isSaving: false,
          setIsSaving: (s) => savingStates.push(s),
          onSaveSuccess: () => {
            onSaveSuccessCalled = true;
          },
          onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
          createVersionApiFn,
        })
      ).rejects.toThrow(FlowForgeApiError);

      expect(savingStates).toEqual([true, false]);
      expect(onSaveSuccessCalled).toBe(false);

      // Verify that error is visibly presented to the user
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('error');
      expect(toastCalls[0].title).toBe('Save Failed');
      expect(toastCalls[0].msg).toContain('Invalid graph structure');
      expect(toastCalls[0].msg).toContain('Task bounds exceeded');
    });

    it('handles unexpected network failure and ensures isSaving is restored to false', async () => {
      const networkError = new Error('Network connection timeout');
      const createVersionApiFn = vi.fn().mockRejectedValue(networkError);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];
      const savingStates: boolean[] = [];

      await expect(
        saveWorkflowDraft({
          workflowId: 'wf-uuid-100',
          nodes: mockNodes,
          edges: mockEdges,
          isSaving: false,
          setIsSaving: (s) => savingStates.push(s),
          onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
          createVersionApiFn,
        })
      ).rejects.toThrow('Network connection timeout');

      expect(savingStates).toEqual([true, false]);
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('error');
      expect(toastCalls[0].msg).toBe('Network connection timeout');
    });

    it('prevents saving mock workflow, does not trigger API request, and provides clear explanation', async () => {
      const createVersionApiFn = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await saveWorkflowDraft({
        workflowId: 'wf-001',
        isMock: true,
        nodes: mockNodes,
        edges: mockEdges,
        isSaving: false,
        setIsSaving: () => {},
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        createVersionApiFn,
      });

      // 1. Must return null without fabricated success
      expect(result).toBeNull();

      // 2. Must not invoke backend version-creation API
      expect(createVersionApiFn).not.toHaveBeenCalled();

      // 3. Must display clear, actionable explanation toast
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('warning');
      expect(toastCalls[0].title).toBe('Sample Template (Cannot Save)');
      expect(toastCalls[0].msg).toContain('Sample template workflows cannot be saved directly to the backend');
      expect(toastCalls[0].msg).toContain('Create or open a persistent project workspace');
    });

    it('allows real UUID-backed workflow to save normally', async () => {
      const mockSavedVersion: WorkflowVersionResponseDto = {
        id: 'ver-uuid-real',
        workflowId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        versionNumber: 1,
        versionTag: 'v1.0.0',
        description: 'First real draft',
        graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
        taskCount: 2,
        edgeCount: 1,
        isValidDag: true,
        createdAt: '2026-10-19T12:00:00Z',
      };

      const createVersionApiFn = vi.fn().mockResolvedValue(mockSavedVersion);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await saveWorkflowDraft({
        workflowId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        isMock: false,
        nodes: mockNodes,
        edges: mockEdges,
        versionTag: 'v1.0.0',
        isSaving: false,
        setIsSaving: () => {},
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        createVersionApiFn,
      });

      expect(createVersionApiFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockSavedVersion);
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].type).toBe('success');
      expect(toastCalls[0].title).toBe('Draft Saved');
    });
  });

  describe('normalizePersistedNode & restoreCanvasFromGraphPayload', () => {
    it('normalizes persisted taskNode to customTask while preserving IDs and coordinates', () => {
      const persistedNode: Node<TaskNodeData> = {
        id: 'task-1',
        type: 'taskNode',
        position: { x: 100, y: 150 },
        data: {
          label: 'Data Extraction',
          taskType: 'HTTP_REQUEST',
          timeoutMs: 30000,
          maxRetries: 3,
          parameters: { command: 'extract.sh' },
          status: 'COMPLETED',
        },
      };

      const normalized = normalizePersistedNode(persistedNode);

      expect(normalized.id).toBe('task-1');
      expect(normalized.type).toBe('customTask');
      expect(normalized.position).toEqual({ x: 100, y: 150 });
      expect(normalized.data.label).toBe('Data Extraction');
      expect(normalized.data.parameters).toEqual({ command: 'extract.sh' });
      expect(normalized.data.status).toBe('IDLE');
    });

    it('normalizes missing or empty node type to customTask', () => {
      const unassignedNode = {
        id: 'task-legacy',
        position: { x: 200, y: 250 },
        data: { label: 'Legacy Task' },
      } as Node<TaskNodeData>;

      const normalized = normalizePersistedNode(unassignedNode);
      expect(normalized.type).toBe('customTask');
      expect(normalized.id).toBe('task-legacy');
      expect(normalized.data.status).toBe('IDLE');
    });

    it('preserves existing custom registered node types unchanged', () => {
      const customNode: Node<TaskNodeData> = {
        id: 'task-custom',
        type: 'specialPluginNode',
        position: { x: 50, y: 80 },
        data: {
          label: 'Special Node',
          taskType: 'BASH_COMMAND',
          timeoutMs: 15000,
          maxRetries: 2,
          parameters: {},
        },
      };

      const normalized = normalizePersistedNode(customNode);
      expect(normalized.type).toBe('specialPluginNode');
      expect(normalized.data.status).toBe('IDLE');
    });

    it('restores multiple persisted nodes and edges with IDs and endpoints intact', () => {
      const graphPayload = {
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
      };

      const { nodes, edges } = restoreCanvasFromGraphPayload(graphPayload);

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

      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe('e-task-1-task-2');
      expect(edges[0].source).toBe('task-1');
      expect(edges[0].target).toBe('task-2');
      expect(edges[0].type).toBe('smoothstep');
    });

    it('safely handles empty or missing payload without crashing', () => {
      expect(restoreCanvasFromGraphPayload(null)).toEqual({ nodes: [], edges: [] });
      expect(restoreCanvasFromGraphPayload(undefined)).toEqual({ nodes: [], edges: [] });
      expect(restoreCanvasFromGraphPayload({})).toEqual({ nodes: [], edges: [] });
      expect(restoreCanvasFromGraphPayload({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
    });
  });
});
