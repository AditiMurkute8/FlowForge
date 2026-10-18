import type { Node, Edge } from '@xyflow/react';
import type {
  DagValidationResult,
  TaskNodeData,
  ValidateDagRequest,
  ValidateDagResponse,
} from '../types';
import { validateDag as defaultValidateApi, FlowForgeApiError } from '../api/flowForgeApi';
import { validateDag as defaultValidateLocal } from './dagValidation';

export const MAX_TASKS_LIMIT = 50;
export const MAX_EDGES_LIMIT = 100;

/**
 * Checks whether the graph exceeds backend validation capacity limits.
 *
 * @param nodeCount number of nodes in the graph
 * @param edgeCount number of edges in the graph
 * @returns Error string if limits are exceeded, or null if within limits
 */
export function validateGraphLimits(nodeCount: number, edgeCount: number): string | null {
  if (nodeCount > MAX_TASKS_LIMIT) {
    return `Task count (${nodeCount}) exceeds maximum limit of ${MAX_TASKS_LIMIT} tasks.`;
  }
  if (edgeCount > MAX_EDGES_LIMIT) {
    return `Edge count (${edgeCount}) exceeds maximum limit of ${MAX_EDGES_LIMIT} edges.`;
  }
  return null;
}

/**
 * Maps React Flow nodes and edges into the backend ValidateDagRequest DTO.
 */
export function toValidateDagRequest(
  nodes: Node<TaskNodeData>[],
  edges: Edge[]
): ValidateDagRequest {
  return {
    taskIds: nodes.map((node) => node.id.trim()),
    edges: edges.map((edge) => ({
      source: edge.source.trim(),
      target: edge.target.trim(),
    })),
  };
}

/**
 * Accurately determines which edges are part of a directed cycle.
 * An edge (u -> v) where u, v in cycleNodes is on a cycle if and only if
 * there exists a directed path from v back to u restricted to cycleNodes.
 * Self-loops (u -> u) are trivially cycle edges.
 */
export function findCycleEdges(
  edges: Edge[],
  cycleNodes: string[]
): string[] {
  if (!cycleNodes || cycleNodes.length === 0) {
    return [];
  }

  const cycleNodeSet = new Set(cycleNodes);
  const cycleEdges: string[] = [];

  // Build adjacency list restricted to cycleNodes
  const adj = new Map<string, string[]>();
  for (const nodeId of cycleNodes) {
    adj.set(nodeId, []);
  }

  for (const edge of edges) {
    const src = edge.source?.trim();
    const tgt = edge.target?.trim();
    if (src && tgt && cycleNodeSet.has(src) && cycleNodeSet.has(tgt)) {
      adj.get(src)?.push(tgt);
    }
  }

  // BFS to determine if target is reachable from start within cycleNodes
  function canReach(start: string, target: string): boolean {
    const visited = new Set<string>([start]);
    const queue = [start];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === target) {
        return true;
      }
      for (const neighbor of adj.get(curr) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return false;
  }

  for (const edge of edges) {
    const src = edge.source?.trim();
    const tgt = edge.target?.trim();
    if (!src || !tgt || !cycleNodeSet.has(src) || !cycleNodeSet.has(tgt)) {
      continue;
    }
    if (src === tgt) {
      cycleEdges.push(edge.id);
      continue;
    }
    if (canReach(tgt, src)) {
      cycleEdges.push(edge.id);
    }
  }

  return cycleEdges;
}

/**
 * Adapts a backend ValidateDagResponse into the frontend DagValidationResult.
 */
export function adaptBackendValidation(
  response: ValidateDagResponse,
  edges: Edge[]
): DagValidationResult {
  const cycleEdges = response.hasCycle
    ? findCycleEdges(edges, response.cycleNodes)
    : [];

  return {
    isValid: response.isValid,
    hasCycle: response.hasCycle,
    cycleNodes: response.cycleNodes || [],
    cycleEdges,
    disconnectedNodes: response.disconnectedNodes || [],
    errors: response.errors || [],
    warnings: response.warnings || [],
    topologicalOrder: response.topologicalOrder || [],
    isLocalFallback: false,
  };
}

export interface ValidationHandlerContext {
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  isValidating: boolean;
  setIsValidating: (val: boolean) => void;
  setValidationResult: (res: DagValidationResult | null) => void;
  applyValidationVisuals: (res: DagValidationResult) => void;
  onShowToast: (title: string, message?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  validateApiFn?: (req: ValidateDagRequest) => Promise<ValidateDagResponse>;
  validateLocalFn?: (nodes: Node<TaskNodeData>[], edges: Edge[]) => DagValidationResult;
}

/**
 * Coordinates workflow validation lifecycle: graph limit verification, loading guards,
 * backend API invocation, offline fallback to local engine, and user notifications.
 */
export async function executeWorkflowValidation({
  nodes,
  edges,
  isValidating,
  setIsValidating,
  setValidationResult,
  applyValidationVisuals,
  onShowToast,
  validateApiFn = defaultValidateApi,
  validateLocalFn = defaultValidateLocal,
}: ValidationHandlerContext): Promise<void> {
  if (isValidating) {
    return;
  }

  // 1. Enforce client-side graph size limits matching backend constraints (50 tasks, 100 edges)
  const limitError = validateGraphLimits(nodes.length, edges.length);
  if (limitError) {
    const limitResult: DagValidationResult = {
      isValid: false,
      hasCycle: false,
      cycleNodes: [],
      cycleEdges: [],
      disconnectedNodes: [],
      errors: [limitError],
      warnings: [],
      isLocalFallback: false,
    };
    setValidationResult(limitResult);
    onShowToast('Validation Limit Exceeded', limitError, 'error');
    return;
  }

  setIsValidating(true);

  try {
    // 2. Submit to backend REST API
    const request = toValidateDagRequest(nodes, edges);
    const response = await validateApiFn(request);
    const result = adaptBackendValidation(response, edges);

    setValidationResult(result);
    applyValidationVisuals(result);

    if (result.isValid) {
      const orderSummary =
        response.topologicalOrder && response.topologicalOrder.length > 0
          ? ` (${response.topologicalOrder.length} tasks ordered)`
          : '';
      onShowToast(
        'DAG Validated (Server)',
        `Workflow verified as acyclic by FlowForge server${orderSummary}.`,
        'success'
      );
    } else {
      const primaryError = result.errors[0] || 'Cycles or dependency errors detected.';
      onShowToast('Validation Failed (Server)', primaryError, 'error');
    }
  } catch (err) {
    if (err instanceof FlowForgeApiError && err.status === 0) {
      // 3. Fallback to local validator if and only if backend is unreachable (status 0)
      const localResult = validateLocalFn(nodes, edges);
      const fallbackResult: DagValidationResult = {
        ...localResult,
        isLocalFallback: true,
      };

      setValidationResult(fallbackResult);
      applyValidationVisuals(fallbackResult);

      if (fallbackResult.isValid) {
        onShowToast(
          'Server Offline — Local Validation Only',
          'Backend unreachable. Workflow verified using local fallback engine.',
          'warning'
        );
      } else {
        onShowToast(
          'Server Offline — Local Validation Failed',
          fallbackResult.errors[0] || 'Cycles detected by local engine.',
          'error'
        );
      }
    } else {
      // 4. Non-zero API error (e.g., 400 Bad Request, 500 Internal Error)
      const errorMessage =
        err instanceof FlowForgeApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Server validation request failed';

      const errorDetails =
        err instanceof FlowForgeApiError && err.details.length > 0
          ? err.details
          : [errorMessage];

      setValidationResult({
        isValid: false,
        hasCycle: false,
        cycleNodes: [],
        cycleEdges: [],
        disconnectedNodes: [],
        errors: errorDetails,
        warnings: [],
        isLocalFallback: false,
      });

      onShowToast('Validation Error', errorMessage, 'error');
    }
  } finally {
    setIsValidating(false);
  }
}
