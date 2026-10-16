import { describe, it, expect } from 'vitest';
import { validateDag } from './dagValidation';
import type { Node, Edge } from '@xyflow/react';
import type { TaskNodeData } from '../types';

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

describe('validateDag', () => {
  it('validates a linear DAG successfully', () => {
    const nodes: Node<TaskNodeData>[] = [
      createNode('1', 'Fetch Payload'),
      createNode('2', 'Process JSON'),
      createNode('3', 'Store Database'),
    ];
    const edges: Edge[] = [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
    ];

    const result = validateDag(nodes, edges);
    expect(result.isValid).toBe(true);
    expect(result.hasCycle).toBe(false);
    expect(result.cycleNodes).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detects a cyclic dependency in a directed graph', () => {
    const nodes: Node<TaskNodeData>[] = [
      createNode('1', 'Task A'),
      createNode('2', 'Task B'),
      createNode('3', 'Task C'),
    ];
    const edges: Edge[] = [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
      { id: 'e3-1', source: '3', target: '1' }, // Cycle!
    ];

    const result = validateDag(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleEdges).toContain('e3-1');
    expect(result.cycleNodes).toContain('1');
    expect(result.cycleNodes).toContain('2');
    expect(result.cycleNodes).toContain('3');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects self-loops as invalid cycles', () => {
    const nodes: Node<TaskNodeData>[] = [createNode('1', 'Recursive Task')];
    const edges: Edge[] = [{ id: 'e1-1', source: '1', target: '1' }];

    const result = validateDag(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toContain('1');
    expect(result.errors[0]).toContain('Self-loop');
  });

  it('warns about disconnected nodes in a multi-node workflow', () => {
    const nodes: Node<TaskNodeData>[] = [
      createNode('1', 'Connected A'),
      createNode('2', 'Connected B'),
      createNode('3', 'Isolated C'),
    ];
    const edges: Edge[] = [{ id: 'e1-2', source: '1', target: '2' }];

    const result = validateDag(nodes, edges);
    expect(result.isValid).toBe(true);
    expect(result.disconnectedNodes).toContain('3');
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('Isolated C');
  });

  it('handles an empty workflow gracefully', () => {
    const result = validateDag([], []);
    expect(result.isValid).toBe(true);
    expect(result.hasCycle).toBe(false);
    expect(result.warnings.length).toBe(1);
  });

  it('flags edges referencing unknown nodes', () => {
    const nodes: Node<TaskNodeData>[] = [createNode('1', 'Only Node')];
    const edges: Edge[] = [{ id: 'e1-ghost', source: '1', target: 'ghost' }];

    const result = validateDag(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('unknown task');
  });
});
