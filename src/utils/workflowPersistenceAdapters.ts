import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  TaskStatus,
  WorkflowVersionResponseDto,
} from '../types';
import {
  createWorkflowVersion as defaultCreateWorkflowVersion,
  FlowForgeApiError,
} from '../api/flowForgeApi';

/**
 * Normalizes a persisted node snapshot from backend/storage into a valid React Flow canvas node.
 * Maps legacy/backend types ('taskNode') and unassigned types to 'customTask', resets transient
 * execution status to 'IDLE', and preserves coordinates, identifiers, and configuration payload.
 */
export function normalizePersistedNode(node: Node<TaskNodeData>): Node<TaskNodeData> {
  const rawType = (node.type || '').trim();
  const normalizedType = (!rawType || rawType === 'taskNode') ? 'customTask' : rawType;

  return {
    ...node,
    type: normalizedType,
    data: {
      ...node.data,
      status: 'IDLE' as TaskStatus,
    },
  };
}

/**
 * Restores canvas nodes and edges from a saved workflow version's graphPayload.
 * Returns normalized nodes and edges ready for useNodesState and useEdgesState.
 */
export function restoreCanvasFromGraphPayload(payload?: Record<string, unknown> | null): {
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
} {
  if (!payload || !Array.isArray(payload.nodes)) {
    return { nodes: [], edges: [] };
  }

  const nodes = (payload.nodes as Node<TaskNodeData>[]).map(normalizePersistedNode);
  const edges = (Array.isArray(payload.edges) ? (payload.edges as Edge[]) : []).map((e) => ({
    ...e,
    type: e.type || 'smoothstep',
  }));

  return { nodes, edges };
}

/**
 * Builds a clean canonical graph snapshot payload from React Flow canvas nodes and edges.
 * Strips transient execution fields (status, executionDurationMs, isCycle) and runtime classes,
 * while preserving canvas coordinates, task definitions, parameters, and design layout.
 */
export function buildGraphPayloadFromCanvas(
  nodes: Node<TaskNodeData>[],
  edges: Edge[],
  viewport?: { x: number; y: number; zoom: number }
): Record<string, unknown> {
  const cleanedNodes = nodes.map((node) => {
    const rawData = (node.data || {}) as Record<string, unknown>;
    const {
      status: _status,
      executionDurationMs: _execDur,
      isCycle: _isCycle,
      ...cleanedData
    } = rawData;

    return {
      id: node.id,
      type: node.type || 'customTask',
      position: {
        x: Math.round(node.position.x * 100) / 100,
        y: Math.round(node.position.y * 100) / 100,
      },
      data: cleanedData,
    };
  });

  const cleanedEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type || 'smoothstep',
  }));

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    nodes: cleanedNodes,
    edges: cleanedEdges,
  };

  if (viewport) {
    payload.viewport = viewport;
  }

  return payload;
}

export interface SaveWorkflowDraftParams {
  workflowId: string;
  isMock?: boolean;
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  versionTag?: string;
  description?: string;
  viewport?: { x: number; y: number; zoom: number };
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  onSaveSuccess?: (savedVersion: WorkflowVersionResponseDto) => void;
  onShowToast: (
    title: string,
    message?: string,
    type?: 'success' | 'info' | 'warning' | 'error'
  ) => void;
  createVersionApiFn?: typeof defaultCreateWorkflowVersion;
}

/**
 * Orchestrates saving the current canvas state as an immutable WorkflowVersion draft on the backend.
 * Enforces synchronous duplicate-submit guards, extracts the graph snapshot, and updates UI state.
 */
export async function saveWorkflowDraft({
  workflowId,
  isMock,
  nodes,
  edges,
  versionTag,
  description,
  viewport,
  isSaving,
  setIsSaving,
  onSaveSuccess,
  onShowToast,
  createVersionApiFn = defaultCreateWorkflowVersion,
}: SaveWorkflowDraftParams): Promise<WorkflowVersionResponseDto | null> {
  // 1. Duplicate submission guard
  if (isSaving) {
    return null;
  }

  // 2. Sample template / mock workflow guard
  if (isMock) {
    onShowToast(
      'Sample Template (Cannot Save)',
      'Sample template workflows cannot be saved directly to the backend. Create or open a persistent project workspace to persist workflow drafts.',
      'warning'
    );
    return null;
  }

  if (!workflowId || !workflowId.trim()) {
    onShowToast('Save Failed', 'No active workflow selected to persist version.', 'error');
    return null;
  }

  setIsSaving(true);

  try {
    const graphPayload = buildGraphPayloadFromCanvas(nodes, edges, viewport);

    const savedVersion = await createVersionApiFn(workflowId, {
      versionTag: versionTag?.trim() || undefined,
      description: description?.trim() || undefined,
      graphPayload,
    });

    if (onSaveSuccess) {
      onSaveSuccess(savedVersion);
    }

    if (savedVersion.isValidDag) {
      onShowToast(
        'Draft Saved',
        `Persisted version ${savedVersion.versionTag} (v${savedVersion.versionNumber}) with ${savedVersion.taskCount} tasks.`,
        'success'
      );
    } else {
      onShowToast(
        'Draft Saved (Cyclic / Warnings)',
        `Saved draft ${savedVersion.versionTag} (v${savedVersion.versionNumber}). Graph contains cycles or invalid dependencies (draft preserved).`,
        'warning'
      );
    }

    return savedVersion;
  } catch (err) {
    let errorMsg = 'Failed to persist workflow version';
    if (err instanceof FlowForgeApiError) {
      errorMsg = err.details && err.details.length > 0
        ? `${err.message}: ${err.details.join(', ')}`
        : err.message;
    } else if (err instanceof Error) {
      errorMsg = err.message;
    }

    onShowToast('Save Failed', errorMsg, 'error');
    throw err;
  } finally {
    setIsSaving(false);
  }
}
