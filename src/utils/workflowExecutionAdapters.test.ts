import { describe, it, expect, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  ExecuteWorkflowResponse,
} from '../types';
import { FlowForgeApiError } from '../api/flowForgeApi';
import {
  MAX_TASKS_LIMIT,
  MAX_EDGES_LIMIT,
  DEFAULT_SIMULATION_DELAY_MS,
  extractSimulationConfig,
  extractRetryConfig,
  validateExecutionPreflight,
  toExecuteWorkflowRequest,
  executeWorkflowRun,
} from './workflowExecutionAdapters';

function createNode(
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
      ...overrides,
    },
  };
}

describe('workflowExecutionAdapters', () => {
  describe('extractSimulationConfig', () => {
    it('returns hasExplicitOverride: false when parameters are undefined or empty', () => {
      expect(extractSimulationConfig(undefined)).toEqual({ hasExplicitOverride: false });
      expect(extractSimulationConfig({})).toEqual({ hasExplicitOverride: false });
    });

    it('extracts top-level simulation action and parameters', () => {
      const config = extractSimulationConfig({
        action: 'DELAY',
        delayMs: 1200,
      });
      expect(config.hasExplicitOverride).toBe(true);
      expect(config.action).toBe('DELAY');
      expect(config.delayMs).toBe(1200);
    });

    it('extracts nested simulation config under parameters.simulation', () => {
      const config = extractSimulationConfig({
        simulation: {
          action: 'FAIL_UNTIL_ATTEMPT',
          failUntilAttempt: 2,
          errorMessage: 'Transient db error',
        },
      });
      expect(config.hasExplicitOverride).toBe(true);
      expect(config.action).toBe('FAIL_UNTIL_ATTEMPT');
      expect(config.failUntilAttempt).toBe(2);
      expect(config.errorMessage).toBe('Transient db error');
    });

    it('captures rawActionName and leaves action undefined for unsupported actions', () => {
      const config = extractSimulationConfig({
        action: 'RUN_PYTHON_NATIVE',
      });
      expect(config.hasExplicitOverride).toBe(true);
      expect(config.action).toBeUndefined();
      expect(config.rawActionName).toBe('RUN_PYTHON_NATIVE');
    });

    it('flags malformed explicit simulation values (null, string, array, empty object, null action)', () => {
      const nullSim = extractSimulationConfig({ simulation: null });
      expect(nullSim.hasExplicitOverride).toBe(true);
      expect(nullSim.isMalformed).toBe(true);
      expect(nullSim.malformedReason).toContain('must be a non-null object');

      const stringSim = extractSimulationConfig({ simulation: 'not-an-object' });
      expect(stringSim.hasExplicitOverride).toBe(true);
      expect(stringSim.isMalformed).toBe(true);
      expect(stringSim.malformedReason).toContain('must be a plain object');

      const arraySim = extractSimulationConfig({ simulation: [] });
      expect(arraySim.hasExplicitOverride).toBe(true);
      expect(arraySim.isMalformed).toBe(true);
      expect(arraySim.malformedReason).toContain('must be a plain object');

      const emptySim = extractSimulationConfig({ simulation: {} });
      expect(emptySim.hasExplicitOverride).toBe(true);
      expect(emptySim.isMalformed).toBe(true);
      expect(emptySim.malformedReason).toContain('must specify an action or type');

      const nullActionSim = extractSimulationConfig({ simulation: { action: null } });
      expect(nullActionSim.hasExplicitOverride).toBe(true);
      expect(nullActionSim.isMalformed).toBe(true);
      expect(nullActionSim.malformedReason).toContain('action cannot be null or undefined');

      const nullDirectAction = extractSimulationConfig({ action: null });
      expect(nullDirectAction.hasExplicitOverride).toBe(true);
      expect(nullDirectAction.isMalformed).toBe(true);
      expect(nullDirectAction.malformedReason).toContain('action parameter cannot be null or undefined');
    });
  });

  describe('extractRetryConfig', () => {
    it('returns empty config when no retry parameters exist', () => {
      expect(extractRetryConfig(undefined)).toEqual({});
      expect(extractRetryConfig({})).toEqual({});
    });

    it('extracts retryInitialDelayMs from top-level or nested retry object', () => {
      expect(extractRetryConfig({ retryInitialDelayMs: 100 })).toEqual({
        rawInitialDelayMs: 100,
      });
      expect(extractRetryConfig({ retry: { initialDelayMs: 250 } })).toEqual({
        rawInitialDelayMs: 250,
      });
    });

    it('flags malformed retry configurations (null, string, array)', () => {
      const nullRetry = extractRetryConfig({ retry: null });
      expect(nullRetry.isMalformed).toBe(true);
      expect(nullRetry.malformedReason).toContain('must be a plain object');

      const arrayRetry = extractRetryConfig({ retry: [] });
      expect(arrayRetry.isMalformed).toBe(true);

      const strRetry = extractRetryConfig({ retry: 'invalid' });
      expect(strRetry.isMalformed).toBe(true);
    });
  });

  describe('validateExecutionPreflight', () => {
    it('rejects empty node list', () => {
      const errors = validateExecutionPreflight([], []);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('at least one task node');
    });

    it('rejects when task count exceeds MAX_TASKS_LIMIT (50)', () => {
      const nodes: Node<TaskNodeData>[] = [];
      for (let i = 0; i < MAX_TASKS_LIMIT + 1; i++) {
        nodes.push(createNode(`t-${i}`, `Task ${i}`));
      }
      const errors = validateExecutionPreflight(nodes, []);
      expect(errors.some((e) => e.message.includes(`exceeds maximum limit of ${MAX_TASKS_LIMIT}`))).toBe(true);
    });

    it('rejects when edge count exceeds MAX_EDGES_LIMIT (100)', () => {
      const nodes = [createNode('t1', 'T1'), createNode('t2', 'T2')];
      const edges: Edge[] = [];
      for (let i = 0; i < MAX_EDGES_LIMIT + 1; i++) {
        edges.push({ id: `e-${i}`, source: 't1', target: 't2' });
      }
      const errors = validateExecutionPreflight(nodes, edges);
      expect(errors.some((e) => e.message.includes(`exceeds maximum limit of ${MAX_EDGES_LIMIT}`))).toBe(true);
    });

    it('rejects duplicate or blank task IDs', () => {
      const nodes = [
        createNode('dup', 'Task 1'),
        createNode('dup', 'Task 2'),
        createNode('  ', 'Blank Task'),
      ];
      const errors = validateExecutionPreflight(nodes, []);
      expect(errors.some((e) => e.message.includes('Duplicate task ID detected'))).toBe(true);
      expect(errors.some((e) => e.message.includes('Task ID must not be blank'))).toBe(true);
    });

    it('blocks execution when maxRetries exceeds 4 without silent clamping', () => {
      const nodes = [createNode('t1', 'Ingest API', 'HTTP_REQUEST', { maxRetries: 5 })];
      const errors = validateExecutionPreflight(nodes, []);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Task "Ingest API" specifies 5 retries');
      expect(errors[0].message).toContain('server allows a maximum of 4 retries (5 total attempts)');
    });

    it('rejects maxRetries when NaN, Infinity, -Infinity, fractional, malformed string, or negative', () => {
      const nodeNaN = createNode('t1', 'T1', 'HTTP_REQUEST', { maxRetries: NaN });
      const nodeInf = createNode('t2', 'T2', 'HTTP_REQUEST', { maxRetries: Infinity });
      const nodeNegInf = createNode('t3', 'T3', 'HTTP_REQUEST', { maxRetries: -Infinity });
      const nodeFrac = createNode('t4', 'T4', 'HTTP_REQUEST', { maxRetries: 2.5 });
      const nodeNeg = createNode('t5', 'T5', 'HTTP_REQUEST', { maxRetries: -1 });
      const nodeStr = createNode('t6', 'T6', 'HTTP_REQUEST', { maxRetries: 'not-a-number' as unknown as number });
      const nodeFracStr = createNode('t7', 'T7', 'HTTP_REQUEST', { maxRetries: '2.5' as unknown as number });

      expect(validateExecutionPreflight([nodeNaN], [])[0].message).toContain('cannot be NaN');
      expect(validateExecutionPreflight([nodeInf], [])[0].message).toContain('cannot be infinite');
      expect(validateExecutionPreflight([nodeNegInf], [])[0].message).toContain('cannot be infinite');
      expect(validateExecutionPreflight([nodeFrac], [])[0].message).toContain('must be an integer, received fractional number 2.5');
      expect(validateExecutionPreflight([nodeNeg], [])[0].message).toContain('cannot be negative (-1)');
      expect(validateExecutionPreflight([nodeStr], [])[0].message).toContain('must be an integer, received "not-a-number"');
      expect(validateExecutionPreflight([nodeFracStr], [])[0].message).toContain('must be an integer, received "2.5"');
    });

    it('accepts valid maxRetries within 0..4 (including boundary values 0 and 4)', () => {
      const nodes = [
        createNode('t1', 'T1', 'HTTP_REQUEST', { maxRetries: 0 }),
        createNode('t2', 'T2', 'HTTP_REQUEST', { maxRetries: 4 }),
      ];
      const errors = validateExecutionPreflight(nodes, []);
      expect(errors).toHaveLength(0);
    });

    it('rejects malformed explicit simulation values during preflight', () => {
      const nodeNullSim = createNode('t1', 'T1', 'HTTP_REQUEST', { parameters: { simulation: null } });
      const nodeStrSim = createNode('t2', 'T2', 'HTTP_REQUEST', { parameters: { simulation: 'not-an-object' } });
      const nodeArrSim = createNode('t3', 'T3', 'HTTP_REQUEST', { parameters: { simulation: [] } });
      const nodeEmptySim = createNode('t4', 'T4', 'HTTP_REQUEST', { parameters: { simulation: {} } });
      const nodeNullAct = createNode('t5', 'T5', 'HTTP_REQUEST', { parameters: { simulation: { action: null } } });

      expect(validateExecutionPreflight([nodeNullSim], [])[0].message).toContain('must be a non-null object');
      expect(validateExecutionPreflight([nodeStrSim], [])[0].message).toContain('must be a plain object');
      expect(validateExecutionPreflight([nodeArrSim], [])[0].message).toContain('must be a plain object');
      expect(validateExecutionPreflight([nodeEmptySim], [])[0].message).toContain('must specify an action or type');
      expect(validateExecutionPreflight([nodeNullAct], [])[0].message).toContain('action cannot be null or undefined');
    });

    it('rejects unsupported explicit simulation actions and never falls back silently to NO_OP', () => {
      const nodes = [
        createNode('t1', 'Script Task', 'PYTHON_SCRIPT', {
          parameters: { action: 'EXEC_SANDBOX_PYTHON' as unknown as string },
        }),
      ];
      const errors = validateExecutionPreflight(nodes, []);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('unsupported simulation action "EXEC_SANDBOX_PYTHON"');
      expect(errors[0].message).toContain('Allowed simulation actions are: NO_OP, DELAY, FAIL, FAIL_UNTIL_ATTEMPT');
    });

    it('validates DELAY action bounds (0..5000 ms) and rejects NaN, Infinity, fractional, and non-numeric strings', () => {
      const nodeNeg = createNode('t1', 'Delay Neg', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: -10 },
      });
      const nodeOver = createNode('t2', 'Delay Over', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: 5001 },
      });
      const nodeNaN = createNode('t3', 'Delay NaN', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: NaN },
      });
      const nodeInf = createNode('t4', 'Delay Inf', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: Infinity },
      });
      const nodeFrac = createNode('t5', 'Delay Frac', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: 150.5 },
      });
      const nodeStr = createNode('t6', 'Delay Str', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: 'bad' as unknown as number },
      });
      const nodeValid0 = createNode('t7', 'Delay 0', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: 0 },
      });
      const nodeValid5000 = createNode('t8', 'Delay 5000', 'DELAY_WAIT', {
        parameters: { action: 'DELAY', delayMs: 5000 },
      });

      expect(validateExecutionPreflight([nodeNeg], [])[0].message).toContain('must be between 0 and 5000 ms');
      expect(validateExecutionPreflight([nodeOver], [])[0].message).toContain('must be between 0 and 5000 ms');
      expect(validateExecutionPreflight([nodeNaN], [])[0].message).toContain('cannot be NaN');
      expect(validateExecutionPreflight([nodeInf], [])[0].message).toContain('cannot be infinite');
      expect(validateExecutionPreflight([nodeFrac], [])[0].message).toContain('must be an integer, received fractional number 150.5');
      expect(validateExecutionPreflight([nodeStr], [])[0].message).toContain('must be an integer, received "bad"');
      expect(validateExecutionPreflight([nodeValid0], [])).toHaveLength(0);
      expect(validateExecutionPreflight([nodeValid5000], [])).toHaveLength(0);
    });

    it('validates FAIL action bounds (errorMessage <= 255 chars)', () => {
      const longMsg = 'X'.repeat(256);
      const nodeFail = createNode('t1', 'Fail Task', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL', errorMessage: longMsg },
      });
      const errors = validateExecutionPreflight([nodeFail], []);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('exceeds the 255-character server limit');
    });

    it('validates FAIL_UNTIL_ATTEMPT bounds (1..5 attempts) and rejects NaN, Infinity, fractional, malformed strings', () => {
      const nodeLow = createNode('t1', 'T1', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: 0 },
      });
      const nodeHigh = createNode('t2', 'T2', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: 6 },
      });
      const nodeNaN = createNode('t3', 'T3', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: NaN },
      });
      const nodeInf = createNode('t4', 'T4', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: Infinity },
      });
      const nodeFrac = createNode('t5', 'T5', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: 2.5 },
      });
      const nodeStr = createNode('t6', 'T6', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: 'bad-thresh' as unknown as number },
      });
      const nodeFracStr = createNode('t7', 'T7', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: '3.14' as unknown as number },
      });
      const nodeBound1 = createNode('t8', 'T8', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: 1 },
      });
      const nodeBound5 = createNode('t9', 'T9', 'HTTP_REQUEST', {
        parameters: { action: 'FAIL_UNTIL_ATTEMPT', failUntilAttempt: 5 },
      });

      expect(validateExecutionPreflight([nodeLow], [])[0].message).toContain('must be between 1 and 5');
      expect(validateExecutionPreflight([nodeHigh], [])[0].message).toContain('must be between 1 and 5');
      expect(validateExecutionPreflight([nodeNaN], [])[0].message).toContain('cannot be NaN');
      expect(validateExecutionPreflight([nodeInf], [])[0].message).toContain('cannot be infinite');
      expect(validateExecutionPreflight([nodeFrac], [])[0].message).toContain('must be an integer, received fractional number 2.5');
      expect(validateExecutionPreflight([nodeStr], [])[0].message).toContain('must be an integer, received "bad-thresh"');
      expect(validateExecutionPreflight([nodeFracStr], [])[0].message).toContain('must be an integer, received "3.14"');
      expect(validateExecutionPreflight([nodeBound1], [])).toHaveLength(0);
      expect(validateExecutionPreflight([nodeBound5], [])).toHaveLength(0);
    });

    it('validates retryInitialDelayMs bounds (0..2000 ms) and rejects NaN, Infinity, fractional, malformed strings', () => {
      const nodeOver = createNode('t1', 'T1', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: 2500 },
      });
      const nodeNaN = createNode('t2', 'T2', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: NaN },
      });
      const nodeInf = createNode('t3', 'T3', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: Infinity },
      });
      const nodeFrac = createNode('t4', 'T4', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: 50.5 },
      });
      const nodeStr = createNode('t5', 'T5', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: 'invalid' as unknown as number },
      });
      const nodeBound0 = createNode('t6', 'T6', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: 0 },
      });
      const nodeBound2000 = createNode('t7', 'T7', 'HTTP_REQUEST', {
        parameters: { retryInitialDelayMs: 2000 },
      });

      expect(validateExecutionPreflight([nodeOver], [])[0].message).toContain('must be between 0 and 2000 ms');
      expect(validateExecutionPreflight([nodeNaN], [])[0].message).toContain('cannot be NaN');
      expect(validateExecutionPreflight([nodeInf], [])[0].message).toContain('cannot be infinite');
      expect(validateExecutionPreflight([nodeFrac], [])[0].message).toContain('must be an integer, received fractional number 50.5');
      expect(validateExecutionPreflight([nodeStr], [])[0].message).toContain('must be an integer, received "invalid"');
      expect(validateExecutionPreflight([nodeBound0], [])).toHaveLength(0);
      expect(validateExecutionPreflight([nodeBound2000], [])).toHaveLength(0);
    });

    it('validates edge targets and sources match existing nodes', () => {
      const nodes = [createNode('t1', 'Task 1'), createNode('t2', 'Task 2')];
      const edges: Edge[] = [
        { id: 'e1', source: 't1', target: 'ghost' },
        { id: 'e2', source: 't1', target: 't2' },
        { id: 'e3', source: 't1', target: 't2' }, // duplicate
      ];
      const errors = validateExecutionPreflight(nodes, edges);
      expect(errors.some((e) => e.message.includes('references unknown task'))).toBe(true);
      expect(errors.some((e) => e.message.includes('Duplicate dependency edge detected'))).toBe(true);
    });
  });

  describe('toExecuteWorkflowRequest', () => {
    it('strictly isolates node.data.timeoutMs and never maps it to delay or retry delay', () => {
      const node = createNode('t1', 'API Task', 'HTTP_REQUEST', {
        timeoutMs: 60000,
        maxRetries: 2,
      });
      const request = toExecuteWorkflowRequest([node], []);

      const taskDto = request.tasks[0];
      // Timeout metadata must NOT be set on simulated action or retry delay
      expect(taskDto.action?.delayMs).toBeUndefined();
      expect(taskDto.retryPolicy?.initialDelayMs).toBe(50); // Default retry delay, not 60000
    });

    it('defaults DELAY_WAIT task to 500ms delay when no parameter is specified', () => {
      const node = createNode('d1', 'Delay Node', 'DELAY_WAIT', {
        parameters: {},
      });
      const request = toExecuteWorkflowRequest([node], []);
      expect(request.tasks[0].action).toEqual({
        type: 'DELAY',
        delayMs: DEFAULT_SIMULATION_DELAY_MS,
      });
    });

    it('maps semantic task types to NO_OP by default', () => {
      const nodeHttp = createNode('h1', 'HTTP', 'HTTP_REQUEST');
      const nodeSql = createNode('s1', 'SQL', 'SQL_QUERY');
      const nodeBash = createNode('b1', 'Bash', 'BASH_COMMAND');

      const request = toExecuteWorkflowRequest([nodeHttp, nodeSql, nodeBash], []);
      expect(request.tasks[0].action).toEqual({ type: 'NO_OP' });
      expect(request.tasks[1].action).toEqual({ type: 'NO_OP' });
      expect(request.tasks[2].action).toEqual({ type: 'NO_OP' });
    });

    it('correctly maps exact retry conversion (maxRetries + 1)', () => {
      const node0 = createNode('n0', '0 retries', 'HTTP_REQUEST', { maxRetries: 0 });
      const node3 = createNode('n3', '3 retries', 'HTTP_REQUEST', { maxRetries: 3 });
      const node4 = createNode('n4', '4 retries', 'HTTP_REQUEST', { maxRetries: 4 });

      const req = toExecuteWorkflowRequest([node0, node3, node4], []);

      // 0 retries -> 1 total attempt
      expect(req.tasks[0].retryPolicy?.maxAttempts).toBe(1);
      expect(req.tasks[0].retryPolicy?.backoffStrategy).toBe('NONE');

      // 3 retries -> 4 total attempts
      expect(req.tasks[1].retryPolicy?.maxAttempts).toBe(4);
      expect(req.tasks[1].retryPolicy?.backoffStrategy).toBe('FIXED');

      // 4 retries -> 5 total attempts
      expect(req.tasks[2].retryPolicy?.maxAttempts).toBe(5);
      expect(req.tasks[2].retryPolicy?.backoffStrategy).toBe('FIXED');
    });

    it('serializes explicit simulation overrides faithfully into TaskActionDto', () => {
      const nodeFail = createNode('f1', 'Fail Task', 'HTTP_REQUEST', {
        parameters: {
          simulation: {
            action: 'FAIL_UNTIL_ATTEMPT',
            failUntilAttempt: 2,
            errorMessage: 'Flaky network',
          },
        },
      });

      const req = toExecuteWorkflowRequest([nodeFail], []);
      expect(req.tasks[0].action).toEqual({
        type: 'FAIL_UNTIL_ATTEMPT',
        failUntilAttempt: 2,
        errorMessage: 'Flaky network',
      });
    });
  });

  describe('executeWorkflowRun', () => {
    const mockNodes = [
      createNode('t1', 'Task 1', 'HTTP_REQUEST'),
      createNode('t2', 'Task 2', 'DELAY_WAIT'),
    ];
    const mockEdges: Edge[] = [{ id: 'e1', source: 't1', target: 't2' }];

    it('prevents execution when already in progress', async () => {
      const setIsExecuting = vi.fn();
      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: true,
        setIsExecuting,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('already in progress');
      expect(setIsExecuting).not.toHaveBeenCalled();
    });

    it('blocks execution on preflight validation error and does not call API', async () => {
      const badNodes = [createNode('t1', 'Bad Retries', 'HTTP_REQUEST', { maxRetries: 6 })];
      const executeApiFn = vi.fn();
      const setIsExecuting = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: badNodes,
        edges: [],
        isExecuting: false,
        setIsExecuting,
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.preflightErrors).toHaveLength(1);
      expect(result.error?.status).toBe(400);
      expect(executeApiFn).not.toHaveBeenCalled();
      expect(setIsExecuting).not.toHaveBeenCalled();
      expect(toastCalls[0].title).toBe('Execution Blocked');
    });

    it('blocks execution when explicit simulation override is malformed or unsupported before API is called', async () => {
      const testCases: Array<{ name: string; params: Record<string, unknown>; expectedError: string }> = [
        { name: 'simulation: null', params: { simulation: null }, expectedError: 'must be a non-null object' },
        { name: 'simulation: string', params: { simulation: 'not-an-object' }, expectedError: 'must be a plain object' },
        { name: 'simulation: array', params: { simulation: [] }, expectedError: 'must be a plain object' },
        { name: 'simulation: empty object', params: { simulation: {} }, expectedError: 'must specify an action or type' },
        { name: 'action: null in simulation', params: { simulation: { action: null } }, expectedError: 'action cannot be null or undefined' },
        { name: 'unsupported action in simulation', params: { simulation: { action: 'UNSUPPORTED_ACTION' } }, expectedError: 'unsupported simulation action "UNSUPPORTED_ACTION"' },
        { name: 'top-level action: null', params: { action: null }, expectedError: 'action parameter cannot be null or undefined' },
        { name: 'top-level unsupported action', params: { action: 'UNKNOWN_ACTION' }, expectedError: 'unsupported simulation action "UNKNOWN_ACTION"' },
      ];

      for (const tc of testCases) {
        const badNodes = [
          createNode('t1', 'Task 1', 'HTTP_REQUEST', { parameters: tc.params }),
        ];
        const executeApiFn = vi.fn();
        const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

        const result = await executeWorkflowRun({
          nodes: badNodes,
          edges: [],
          isExecuting: false,
          setIsExecuting: vi.fn(),
          onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
          executeApiFn,
        });

        expect(result.success, `Expected failure for ${tc.name}`).toBe(false);
        expect(executeApiFn, `API should not be called for ${tc.name}`).not.toHaveBeenCalled();
        expect(result.error?.status).toBe(400);
        expect(result.error?.message).toContain(tc.expectedError);
        expect(toastCalls[0].title).toBe('Execution Blocked');
      }
    });

    it('uses documented defaults when configuration is truly absent', async () => {
      const plainNodes = [
        createNode('t1', 'Plain HTTP', 'HTTP_REQUEST', { parameters: {} }),
        createNode('t2', 'Plain Delay', 'DELAY_WAIT', { parameters: {} }),
      ];
      let capturedRequest: unknown;
      const executeApiFn = vi.fn().mockImplementation((req) => {
        capturedRequest = req;
        return Promise.resolve({
          state: 'COMPLETED',
          startedAt: '2026-10-18T00:00:00Z',
          completedAt: '2026-10-18T00:00:00.500Z',
          durationMs: 500,
          taskResults: {},
        });
      });

      const result = await executeWorkflowRun({
        nodes: plainNodes,
        edges: [],
        isExecuting: false,
        setIsExecuting: vi.fn(),
        executeApiFn,
      });

      expect(result.success).toBe(true);
      const req = capturedRequest as { tasks: Array<{ action?: { type: string; delayMs?: number } }> };
      expect(req.tasks[0].action).toEqual({ type: 'NO_OP' });
      expect(req.tasks[1].action).toEqual({ type: 'DELAY', delayMs: 500 });
    });

    it('handles successful COMPLETED response and updates canvas node statuses', async () => {
      const mockResponse: ExecuteWorkflowResponse = {
        state: 'COMPLETED',
        startedAt: '2026-10-18T00:00:00Z',
        completedAt: '2026-10-18T00:00:01Z',
        durationMs: 1000,
        taskResults: {
          t1: {
            taskId: 't1',
            state: 'COMPLETED',
            startedAt: '2026-10-18T00:00:00Z',
            completedAt: '2026-10-18T00:00:00.500Z',
            durationMs: 500,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
          t2: {
            taskId: 't2',
            state: 'COMPLETED',
            startedAt: '2026-10-18T00:00:00.500Z',
            completedAt: '2026-10-18T00:00:01Z',
            durationMs: 500,
            attemptCount: 1,
            errorMessage: null,
            attemptErrors: [],
          },
        },
      };

      const executeApiFn = vi.fn().mockResolvedValue(mockResponse);
      const isExecutingStates: boolean[] = [];
      const updatedNodes: Record<string, { status: string; duration?: number }> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: (val) => isExecutingStates.push(val),
        onUpdateNodeStatus: (id, status, duration) => {
          updatedNodes[id] = { status, duration };
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(true);
      expect(result.response).toEqual(mockResponse);
      expect(isExecutingStates).toEqual([true, false]);
      expect(updatedNodes['t1']).toEqual({ status: 'COMPLETED', duration: 500 });
      expect(updatedNodes['t2']).toEqual({ status: 'COMPLETED', duration: 500 });
      expect(toastCalls[0].title).toBe('Simulated Run Completed');
      expect(toastCalls[0].type).toBe('success');
    });

    it('handles 200 OK FAILED workflow response correctly updating CANCELLED downstream nodes', async () => {
      const mockResponse: ExecuteWorkflowResponse = {
        state: 'FAILED',
        startedAt: '2026-10-18T00:00:00Z',
        completedAt: '2026-10-18T00:00:00.200Z',
        durationMs: 200,
        taskResults: {
          t1: {
            taskId: 't1',
            state: 'FAILED',
            startedAt: '2026-10-18T00:00:00Z',
            completedAt: '2026-10-18T00:00:00.200Z',
            durationMs: 200,
            attemptCount: 1,
            errorMessage: 'Simulated task failure',
            attemptErrors: ['Simulated task failure'],
          },
          t2: {
            taskId: 't2',
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

      const executeApiFn = vi.fn().mockResolvedValue(mockResponse);
      const updatedNodes: Record<string, { status: string; duration?: number }> = {};
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus: (id, status, duration) => {
          updatedNodes[id] = { status, duration };
        },
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(true);
      expect(updatedNodes['t1'].status).toBe('FAILED');
      expect(updatedNodes['t2'].status).toBe('CANCELLED');
      expect(updatedNodes['t2'].duration).toBeUndefined();
      expect(toastCalls[0].title).toBe('Simulated Run Failed');
      expect(toastCalls[0].type).toBe('error');
    });

    it('handles HTTP 504 Gateway Timeout without marking nodes FAILED or CANCELLED', async () => {
      const apiError = new FlowForgeApiError(
        504,
        'Workflow execution exceeded maximum synchronous limit of 15 seconds'
      );
      const executeApiFn = vi.fn().mockRejectedValue(apiError);
      const onUpdateNodeStatus = vi.fn();
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onUpdateNodeStatus,
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(504);
      expect(result.error?.isTimeout).toBe(true);
      expect(result.error?.message).toContain('15 seconds');

      // Crucial: Node statuses must NOT be updated or fabricated on timeout
      expect(onUpdateNodeStatus).not.toHaveBeenCalled();

      // Ensure no automatic retry was triggered
      expect(executeApiFn).toHaveBeenCalledTimes(1);

      expect(toastCalls[0].title).toBe('Gateway Timeout');
      expect(toastCalls[0].type).toBe('warning');
      expect(toastCalls[0].msg).toContain('Background server tasks may still be concluding');
    });

    it('handles HTTP 429 capacity exhaustion gracefully with no automatic retry', async () => {
      const apiError = new FlowForgeApiError(
        429,
        'Server workflow execution capacity is exhausted (max 4 concurrent workflows).'
      );
      const executeApiFn = vi.fn().mockRejectedValue(apiError);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(429);
      expect(result.error?.isCapacityExhausted).toBe(true);
      expect(executeApiFn).toHaveBeenCalledTimes(1);
      expect(toastCalls[0].title).toBe('Server Capacity Exhausted');
      expect(toastCalls[0].type).toBe('warning');
    });

    it('handles HTTP 500 internal server error and HTTP 503 service unavailable cleanly with no automatic retry', async () => {
      const err500 = new FlowForgeApiError(500, 'An unexpected internal error occurred');
      const mockFn500 = vi.fn().mockRejectedValue(err500);
      const toastCalls500: Array<{ title: string; msg?: string; type?: string }> = [];

      const res500 = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls500.push({ title, msg, type }),
        executeApiFn: mockFn500,
      });

      expect(res500.success).toBe(false);
      expect(res500.error?.status).toBe(500);
      expect(res500.error?.message).toBe('An unexpected internal error occurred');
      expect(mockFn500).toHaveBeenCalledTimes(1);
      expect(toastCalls500[0].title).toBe('Execution Error');

      const err503 = new FlowForgeApiError(503, 'Workflow execution dispatcher is currently unavailable');
      const mockFn503 = vi.fn().mockRejectedValue(err503);
      const toastCalls503: Array<{ title: string; msg?: string; type?: string }> = [];

      const res503 = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls503.push({ title, msg, type }),
        executeApiFn: mockFn503,
      });

      expect(res503.success).toBe(false);
      expect(res503.error?.status).toBe(503);
      expect(res503.error?.message).toBe('Workflow execution dispatcher is currently unavailable');
      expect(mockFn503).toHaveBeenCalledTimes(1);
      expect(toastCalls503[0].title).toBe('Execution Error');
    });

    it('handles status 0 network outage cleanly with no automatic retry', async () => {
      const apiError = new FlowForgeApiError(
        0,
        'Network failure: Unable to connect to FlowForge server'
      );
      const executeApiFn = vi.fn().mockRejectedValue(apiError);
      const toastCalls: Array<{ title: string; msg?: string; type?: string }> = [];

      const result = await executeWorkflowRun({
        nodes: mockNodes,
        edges: mockEdges,
        isExecuting: false,
        setIsExecuting: vi.fn(),
        onShowToast: (title, msg, type) => toastCalls.push({ title, msg, type }),
        executeApiFn,
      });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(0);
      expect(result.error?.isNetworkFailure).toBe(true);
      expect(executeApiFn).toHaveBeenCalledTimes(1);
      expect(toastCalls[0].title).toBe('Server Offline');
      expect(toastCalls[0].type).toBe('error');
    });
  });
});
