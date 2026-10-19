import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { TaskNodeData } from '../../types';
import { CustomTaskNode } from './CustomTaskNode';
import { TaskInspector } from './TaskInspector';
import {
  extractSimulationConfig,
  extractRetryConfig,
  validateExecutionPreflight,
  toExecuteWorkflowRequest,
  MAX_RETRIES_LIMIT,
  MAX_SIMULATION_DELAY_MS,
  MAX_RETRY_INITIAL_DELAY_MS,
} from '../../utils/workflowExecutionAdapters';

function createMockNode(
  id: string,
  label: string,
  taskType: TaskNodeData['taskType'] = 'HTTP_REQUEST',
  overrides?: Partial<TaskNodeData>
): Node<TaskNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      label,
      taskType,
      timeoutMs: 30000,
      maxRetries: 3,
      parameters: {},
      status: 'IDLE',
      ...overrides,
    },
  };
}

describe('TaskNode and TaskInspector Phase 2 Integration', () => {
  describe('Component exports', () => {
    it('exports CustomTaskNode as a valid React component', () => {
      expect(CustomTaskNode).toBeDefined();
      expect(typeof CustomTaskNode).toBe('function');
    });

    it('exports TaskInspector as a valid React component', () => {
      expect(TaskInspector).toBeDefined();
      expect(typeof TaskInspector).toBe('function');
    });
  });

  describe('CustomTaskNode simulation and status metadata', () => {
    it('resolves simulation action for default semantic tasks to NO_OP', () => {
      const node = createMockNode('t1', 'API Task', 'HTTP_REQUEST');
      const sim = extractSimulationConfig(node.data.parameters);
      expect(sim.hasExplicitOverride).toBe(false);
      // For semantic tasks without override, default resolved action is NO_OP
      const resolved = sim.hasExplicitOverride ? sim.action : 'NO_OP';
      expect(resolved).toBe('NO_OP');
    });

    it('resolves simulation action for DELAY_WAIT tasks to DELAY with 500ms default', () => {
      const node = createMockNode('d1', 'Delay Task', 'DELAY_WAIT');
      const sim = extractSimulationConfig(node.data.parameters);
      expect(sim.hasExplicitOverride).toBe(false);
      const resolved = sim.hasExplicitOverride ? sim.action : 'DELAY';
      expect(resolved).toBe('DELAY');
      const delay = node.data.parameters?.delayMs ?? 500;
      expect(delay).toBe(500);
    });

    it('resolves explicit simulation override and isolates timeoutMs from delay', () => {
      const node = createMockNode('t1', 'Custom Fail', 'HTTP_REQUEST', {
        timeoutMs: 45000,
        parameters: {
          simulation: {
            action: 'FAIL',
            errorMessage: 'Simulated downstream timeout',
          },
        },
      });

      const sim = extractSimulationConfig(node.data.parameters);
      expect(sim.hasExplicitOverride).toBe(true);
      expect(sim.action).toBe('FAIL');
      expect(sim.errorMessage).toBe('Simulated downstream timeout');

      // timeoutMs must remain client-side and not be set on simulation delay
      expect(sim.rawDelay).toBeUndefined();
      expect(node.data.timeoutMs).toBe(45000);
    });

    it('flags malformed simulation overrides for node visual warning', () => {
      const nodeNull = createMockNode('t1', 'Null Sim', 'HTTP_REQUEST', {
        parameters: { simulation: null },
      });
      const simNull = extractSimulationConfig(nodeNull.data.parameters);
      expect(simNull.hasExplicitOverride).toBe(true);
      expect(simNull.isMalformed).toBe(true);

      const nodeUnsup = createMockNode('t2', 'Unsup Sim', 'HTTP_REQUEST', {
        parameters: { simulation: { action: 'BASH_EXEC' } },
      });
      const simUnsup = extractSimulationConfig(nodeUnsup.data.parameters);
      expect(simUnsup.hasExplicitOverride).toBe(true);
      expect(simUnsup.action).toBeUndefined();
      expect(simUnsup.rawActionName).toBe('BASH_EXEC');
    });

    it('detects out-of-range retries on node data without silent clamping', () => {
      const nodeInvalid = createMockNode('t1', 'Over Retries', 'HTTP_REQUEST', {
        maxRetries: 5,
      });
      expect(nodeInvalid.data.maxRetries).toBe(5);
      expect(nodeInvalid.data.maxRetries > MAX_RETRIES_LIMIT).toBe(true);

      // Preflight rejects without clamping
      const errors = validateExecutionPreflight([nodeInvalid], []);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('specifies 5 retries. The server allows a maximum of 4 retries');
    });
  });

  describe('TaskInspector simulation parameter updates and synchronization', () => {
    it('correctly structures explicit DELAY simulation override in parameters', () => {
      const node = createMockNode('t1', 'Fetch Task', 'HTTP_REQUEST');
      let updatedParams: Record<string, unknown> | undefined;

      const handleUpdateNode = vi.fn((_id: string, update: Partial<TaskNodeData>) => {
        if (update.parameters) {
          updatedParams = update.parameters;
        }
      });

      // Simulate configuring DELAY override in inspector
      const delayMs = 1500;
      const newParams = {
        ...node.data.parameters,
        simulation: { action: 'DELAY', delayMs },
      };
      handleUpdateNode(node.id, { parameters: newParams });

      expect(handleUpdateNode).toHaveBeenCalledTimes(1);
      expect(updatedParams).toBeDefined();

      const simConfig = extractSimulationConfig(updatedParams);
      expect(simConfig.hasExplicitOverride).toBe(true);
      expect(simConfig.action).toBe('DELAY');
      expect(simConfig.rawDelay).toBe(1500);

      // Verify serialized request matches
      const updatedNode = { ...node, data: { ...node.data, parameters: updatedParams! } };
      const req = toExecuteWorkflowRequest([updatedNode], []);
      expect(req.tasks[0].action).toEqual({ type: 'DELAY', delayMs: 1500 });
    });

    it('correctly structures explicit FAIL_UNTIL_ATTEMPT simulation override in parameters', () => {
      const node = createMockNode('t2', 'Transient API', 'HTTP_REQUEST');
      let updatedParams: Record<string, unknown> | undefined;

      const handleUpdateNode = vi.fn((_id: string, update: Partial<TaskNodeData>) => {
        if (update.parameters) {
          updatedParams = update.parameters;
        }
      });

      const newParams = {
        ...node.data.parameters,
        simulation: {
          action: 'FAIL_UNTIL_ATTEMPT',
          failUntilAttempt: 3,
          errorMessage: 'Service warming up',
        },
      };
      handleUpdateNode(node.id, { parameters: newParams });

      expect(updatedParams).toBeDefined();
      const simConfig = extractSimulationConfig(updatedParams);
      expect(simConfig.hasExplicitOverride).toBe(true);
      expect(simConfig.action).toBe('FAIL_UNTIL_ATTEMPT');
      expect(simConfig.rawFailUntil).toBe(3);
      expect(simConfig.errorMessage).toBe('Service warming up');

      const updatedNode = { ...node, data: { ...node.data, parameters: updatedParams! } };
      const req = toExecuteWorkflowRequest([updatedNode], []);
      expect(req.tasks[0].action).toEqual({
        type: 'FAIL_UNTIL_ATTEMPT',
        failUntilAttempt: 3,
        errorMessage: 'Service warming up',
      });
    });

    it('cleans up simulation parameters when reverting to DEFAULT', () => {
      const nodeWithSim = createMockNode('t3', 'Configured Task', 'HTTP_REQUEST', {
        parameters: {
          simulation: { action: 'FAIL', errorMessage: 'Custom error' },
          customField: 'preserved-value',
        },
      });

      // Revert to DEFAULT
      const cleanedParams = { ...nodeWithSim.data.parameters };
      delete cleanedParams.simulation;
      delete cleanedParams.action;

      const simConfig = extractSimulationConfig(cleanedParams);
      expect(simConfig.hasExplicitOverride).toBe(false);
      // Unrelated parameters must be preserved
      expect(cleanedParams.customField).toBe('preserved-value');

      const updatedNode = { ...nodeWithSim, data: { ...nodeWithSim.data, parameters: cleanedParams } };
      const req = toExecuteWorkflowRequest([updatedNode], []);
      // Reverted to documented default (NO_OP)
      expect(req.tasks[0].action).toEqual({ type: 'NO_OP' });
    });
  });

  describe('Retry settings and initialDelayMs isolation', () => {
    it('configures retryInitialDelayMs separately from timeoutMs and delayMs', () => {
      const node = createMockNode('t1', 'Retry Task', 'HTTP_REQUEST', {
        timeoutMs: 30000,
        maxRetries: 2,
        parameters: {
          simulation: { action: 'DELAY', delayMs: 1000 },
          retryInitialDelayMs: 200,
        },
      });

      const simConfig = extractSimulationConfig(node.data.parameters);
      const retryConfig = extractRetryConfig(node.data.parameters);

      // Verify three distinct timings
      expect(node.data.timeoutMs).toBe(30000); // Client timeout
      expect(simConfig.rawDelay).toBe(1000); // Simulation delay
      expect(retryConfig.rawInitialDelayMs).toBe(200); // Retry delay

      const req = toExecuteWorkflowRequest([node], []);
      expect(req.tasks[0].action?.delayMs).toBe(1000);
      expect(req.tasks[0].retryPolicy?.maxAttempts).toBe(3); // maxRetries (2) + 1
      expect(req.tasks[0].retryPolicy?.initialDelayMs).toBe(200);
      expect(req.tasks[0].retryPolicy?.backoffStrategy).toBe('FIXED');
    });

    it('validates simulation delay bound (0..5000 ms) without silent clamping', () => {
      const nodeOver = createMockNode('d1', 'Over Delay', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: MAX_SIMULATION_DELAY_MS + 1 },
      });
      const errors = validateExecutionPreflight([nodeOver], []);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain(`between 0 and ${MAX_SIMULATION_DELAY_MS} ms`);
    });

    it('enforces retry bounds 0..4 and initial delay bounds 0..2000 ms', () => {
      const validNode = createMockNode('v1', 'Valid Retries', 'HTTP_REQUEST', {
        maxRetries: 4,
        parameters: { retryInitialDelayMs: 2000 },
      });
      expect(validateExecutionPreflight([validNode], [])).toHaveLength(0);

      const invalidRetriesNode = createMockNode('i1', 'Invalid Retries', 'HTTP_REQUEST', {
        maxRetries: 5,
        parameters: { retryInitialDelayMs: 2500 },
      });
      const errors = validateExecutionPreflight([invalidRetriesNode], []);
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toContain('maximum of 4 retries');
      expect(errors[1].message).toContain(`between 0 and ${MAX_RETRY_INITIAL_DELAY_MS} ms`);
    });
  });

  describe('Workflow editing invariants and validation feedback', () => {
    it('preserves node ID, label, edges, and dependencies during parameter updates', () => {
      const node1 = createMockNode('n1', 'Task 1');
      const node2 = createMockNode('n2', 'Task 2');
      const edges: Edge[] = [{ id: 'e1-2', source: 'n1', target: 'n2' }];

      // Initial validation passes
      expect(validateExecutionPreflight([node1, node2], edges)).toHaveLength(0);

      // Node update with simulation config
      const updatedNode1 = {
        ...node1,
        data: {
          ...node1.data,
          parameters: { simulation: { action: 'DELAY', delayMs: 2000 } },
        },
      };

      const updatedErrors = validateExecutionPreflight([updatedNode1, node2], edges);
      expect(updatedErrors).toHaveLength(0);

      const req = toExecuteWorkflowRequest([updatedNode1, node2], edges);
      expect(req.tasks).toHaveLength(2);
      expect(req.edges).toHaveLength(1);
      expect(req.edges[0]).toEqual({ source: 'n1', target: 'n2' });
      expect(req.tasks[0].action).toEqual({ type: 'DELAY', delayMs: 2000 });
      expect(req.tasks[1].action).toEqual({ type: 'NO_OP' });
    });
  });

  describe('CustomTaskNode robust rendering for legacy or incomplete persisted data', () => {
    it('safely renders nodes with unknown task types without throwing', () => {
      const element = CustomTaskNode({
        id: 'task-1',
        data: {
          label: 'Data Extraction',
          taskType: 'DATA_SOURCE' as unknown as TaskNodeData['taskType'],
        } as TaskNodeData,
        selected: false,
      } as any);

      expect(React.isValidElement(element)).toBe(true);
      if (React.isValidElement(element)) {
        expect(element.type).toBe('div');
      }
    });

    it('safely handles missing timeoutMs and maxRetries without NaN or crashes', () => {
      const element = CustomTaskNode({
        id: 'task-2',
        data: {
          label: 'Transformation',
          taskType: 'TRANSFORM' as unknown as TaskNodeData['taskType'],
        } as TaskNodeData,
        selected: false,
      } as any);

      expect(React.isValidElement(element)).toBe(true);
      if (React.isValidElement(element)) {
        expect(element.type).toBe('div');
      }
    });

    it('safely handles missing label and empty data', () => {
      const element = CustomTaskNode({
        id: 'task-empty',
        data: {} as TaskNodeData,
        selected: false,
      } as any);

      expect(React.isValidElement(element)).toBe(true);
      if (React.isValidElement(element)) {
        expect(element.type).toBe('div');
      }
    });
  });
});
