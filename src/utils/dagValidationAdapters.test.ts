import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type { TaskNodeData, ValidateDagResponse } from '../types';
import {
  toValidateDagRequest,
  findCycleEdges,
  adaptBackendValidation,
  validateGraphLimits,
  MAX_TASKS_LIMIT,
  MAX_EDGES_LIMIT,
} from './dagValidationAdapters';

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

describe('dagValidationAdapters', () => {
  describe('validateGraphLimits', () => {
    it('returns null when node and edge counts are within allowable limits', () => {
      expect(validateGraphLimits(4, 4)).toBeNull();
      expect(validateGraphLimits(MAX_TASKS_LIMIT, MAX_EDGES_LIMIT)).toBeNull();
    });

    it('returns an error when task count exceeds MAX_TASKS_LIMIT (50)', () => {
      const result = validateGraphLimits(MAX_TASKS_LIMIT + 1, 10);
      expect(result).toContain('Task count (51) exceeds maximum limit of 50 tasks');
    });

    it('returns an error when edge count exceeds MAX_EDGES_LIMIT (100)', () => {
      const result = validateGraphLimits(10, MAX_EDGES_LIMIT + 1);
      expect(result).toContain('Edge count (101) exceeds maximum limit of 100 edges');
    });
  });

  describe('toValidateDagRequest', () => {
    it('maps React Flow nodes and edges to backend ValidateDagRequest DTO', () => {
      const nodes: Node<TaskNodeData>[] = [
        createNode('  task-1  ', 'Node 1'),
        createNode('task-2', 'Node 2'),
      ];
      const edges: Edge[] = [
        { id: 'e1', source: '  task-1 ', target: ' task-2 ' },
      ];

      const request = toValidateDagRequest(nodes, edges);
      expect(request).toEqual({
        taskIds: ['task-1', 'task-2'],
        edges: [{ source: 'task-1', target: 'task-2' }],
      });
    });

    it('handles empty nodes and edges cleanly', () => {
      const request = toValidateDagRequest([], []);
      expect(request).toEqual({
        taskIds: [],
        edges: [],
      });
    });
  });

  describe('findCycleEdges', () => {
    it('returns empty array when cycleNodes is empty or null', () => {
      const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }];
      expect(findCycleEdges(edges, [])).toEqual([]);
      expect(findCycleEdges(edges, null as unknown as string[])).toEqual([]);
    });

    it('identifies all edges in a simple directed cycle', () => {
      const edges: Edge[] = [
        { id: 'e-ab', source: 'A', target: 'B' },
        { id: 'e-bc', source: 'B', target: 'C' },
        { id: 'e-ca', source: 'C', target: 'A' },
      ];
      const cycleNodes = ['A', 'B', 'C'];

      const result = findCycleEdges(edges, cycleNodes);
      expect(result).toHaveLength(3);
      expect(result).toContain('e-ab');
      expect(result).toContain('e-bc');
      expect(result).toContain('e-ca');
    });

    it('identifies self-loops as cycle edges immediately', () => {
      const edges: Edge[] = [{ id: 'e-self', source: 'A', target: 'A' }];
      const result = findCycleEdges(edges, ['A']);
      expect(result).toEqual(['e-self']);
    });

    it('does NOT mark a bridging edge between two disjoint cycles as a cycle edge', () => {
      // Cycle 1: A <-> B
      // Cycle 2: C <-> D
      // Bridge: B -> C (connects two cycle nodes, but is NOT part of any cycle)
      const edges: Edge[] = [
        { id: 'e-ab', source: 'A', target: 'B' },
        { id: 'e-ba', source: 'B', target: 'A' },
        { id: 'e-bridge', source: 'B', target: 'C' },
        { id: 'e-cd', source: 'C', target: 'D' },
        { id: 'e-dc', source: 'D', target: 'C' },
      ];
      const cycleNodes = ['A', 'B', 'C', 'D'];

      const result = findCycleEdges(edges, cycleNodes);
      expect(result).toContain('e-ab');
      expect(result).toContain('e-ba');
      expect(result).toContain('e-cd');
      expect(result).toContain('e-dc');
      expect(result).not.toContain('e-bridge');
      expect(result).toHaveLength(4);
    });

    it('ignores edges connected to non-cycle nodes', () => {
      const edges: Edge[] = [
        { id: 'e-ab', source: 'A', target: 'B' },
        { id: 'e-ba', source: 'B', target: 'A' },
        { id: 'e-out', source: 'B', target: 'External' },
      ];
      const cycleNodes = ['A', 'B'];

      const result = findCycleEdges(edges, cycleNodes);
      expect(result).toEqual(['e-ab', 'e-ba']);
    });
  });

  describe('adaptBackendValidation', () => {
    it('adapts a successful acyclic response correctly', () => {
      const response: ValidateDagResponse = {
        isValid: true,
        hasCycle: false,
        cycleNodes: [],
        disconnectedNodes: [],
        errors: [],
        warnings: [],
        topologicalOrder: ['1', '2', '3'],
      };
      const edges: Edge[] = [
        { id: 'e1', source: '1', target: '2' },
        { id: 'e2', source: '2', target: '3' },
      ];

      const adapted = adaptBackendValidation(response, edges);
      expect(adapted.isValid).toBe(true);
      expect(adapted.hasCycle).toBe(false);
      expect(adapted.cycleNodes).toEqual([]);
      expect(adapted.cycleEdges).toEqual([]);
      expect(adapted.topologicalOrder).toEqual(['1', '2', '3']);
      expect(adapted.isLocalFallback).toBe(false);
    });

    it('adapts a cyclic response and identifies cycle edges', () => {
      const response: ValidateDagResponse = {
        isValid: false,
        hasCycle: true,
        cycleNodes: ['A', 'B'],
        disconnectedNodes: [],
        errors: ['Cyclic dependency detected'],
        warnings: [],
        topologicalOrder: [],
      };
      const edges: Edge[] = [
        { id: 'e-ab', source: 'A', target: 'B' },
        { id: 'e-ba', source: 'B', target: 'A' },
        { id: 'e-ac', source: 'A', target: 'C' },
      ];

      const adapted = adaptBackendValidation(response, edges);
      expect(adapted.isValid).toBe(false);
      expect(adapted.hasCycle).toBe(true);
      expect(adapted.cycleNodes).toEqual(['A', 'B']);
      expect(adapted.cycleEdges).toEqual(['e-ab', 'e-ba']);
      expect(adapted.cycleEdges).not.toContain('e-ac');
      expect(adapted.errors).toEqual(['Cyclic dependency detected']);
      expect(adapted.isLocalFallback).toBe(false);
    });
  });
});
