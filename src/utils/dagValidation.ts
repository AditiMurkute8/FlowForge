import type { Node, Edge } from '@xyflow/react';
import type { DagValidationResult, TaskNodeData } from '../types';

/**
 * Validates a DAG for cycles, self-loops, and disconnected nodes.
 * Uses 3-color Depth First Search (WHITE=0, GRAY=1, BLACK=2) to identify cycles.
 */
export function validateDag(
  nodes: Node<TaskNodeData>[],
  edges: Edge[]
): DagValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cycleNodesSet = new Set<string>();
  const cycleEdgesSet = new Set<string>();

  if (nodes.length === 0) {
    return {
      isValid: true,
      hasCycle: false,
      cycleNodes: [],
      cycleEdges: [],
      disconnectedNodes: [],
      errors: [],
      warnings: ['Workflow contains no tasks.'],
    };
  }

  // 1. Build adjacency list and in/out degrees
  const nodeMap = new Map<string, Node<TaskNodeData>>();
  const adj = new Map<string, { target: string; edgeId: string }[]>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      errors.push(`Edge connects unknown task: ${edge.source} -> ${edge.target}`);
      continue;
    }

    // Check for self-loop
    if (edge.source === edge.target) {
      errors.push(`Self-loop detected on task "${nodeMap.get(edge.source)?.data.label || edge.source}"`);
      cycleNodesSet.add(edge.source);
      cycleEdgesSet.add(edge.id);
      continue;
    }

    adj.get(edge.source)?.push({ target: edge.target, edgeId: edge.id });
    outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // 2. 3-Color DFS Cycle Detection
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colors = new Map<string, number>();
  for (const node of nodes) {
    colors.set(node.id, WHITE);
  }

  const parentEdge = new Map<string, { parent: string; edgeId: string }>();

  function dfs(u: string, path: string[]) {
    colors.set(u, GRAY);
    path.push(u);

    const neighbors = adj.get(u) || [];
    for (const { target: v, edgeId } of neighbors) {
      if (colors.get(v) === GRAY) {
        // Cycle detected!
        cycleEdgesSet.add(edgeId);
        cycleNodesSet.add(v);
        cycleNodesSet.add(u);

        // Trace back the cycle path
        const cycleStartIndex = path.indexOf(v);
        if (cycleStartIndex !== -1) {
          const cyclePath = path.slice(cycleStartIndex);
          for (let i = 0; i < cyclePath.length; i++) {
            cycleNodesSet.add(cyclePath[i]);
          }
          const nodeLabels = cyclePath
            .map((id) => nodeMap.get(id)?.data.label || id)
            .concat(nodeMap.get(v)?.data.label || v);
          errors.push(`Cyclic dependency: ${nodeLabels.join(' -> ')}`);
        } else {
          errors.push(`Cyclic dependency involving task "${nodeMap.get(v)?.data.label || v}"`);
        }
      } else if (colors.get(v) === WHITE) {
        parentEdge.set(v, { parent: u, edgeId });
        dfs(v, path);
      }
    }

    path.pop();
    colors.set(u, BLACK);
  }

  for (const node of nodes) {
    if (colors.get(node.id) === WHITE) {
      dfs(node.id, []);
    }
  }

  // 3. Check for disconnected nodes (isolated when total nodes > 1)
  const disconnectedNodes: string[] = [];
  if (nodes.length > 1) {
    for (const node of nodes) {
      const inD = inDegree.get(node.id) || 0;
      const outD = outDegree.get(node.id) || 0;
      if (inD === 0 && outD === 0) {
        disconnectedNodes.push(node.id);
        warnings.push(`Task "${node.data.label}" is isolated and not connected to any pipeline flow.`);
      }
    }
  }

  const hasCycle = cycleNodesSet.size > 0;
  const isValid = errors.length === 0 && !hasCycle;

  return {
    isValid,
    hasCycle,
    cycleNodes: Array.from(cycleNodesSet),
    cycleEdges: Array.from(cycleEdgesSet),
    disconnectedNodes,
    errors,
    warnings,
  };
}
