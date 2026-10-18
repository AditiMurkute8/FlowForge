import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  TaskStatus,
  TaskActionDto,
  TaskActionType,
  RetryPolicyDto,
  TaskDefinitionDto,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
} from '../types';
import { executeWorkflow as defaultExecuteWorkflow, FlowForgeApiError } from '../api/flowForgeApi';

export const MAX_TASKS_LIMIT = 50;
export const MAX_EDGES_LIMIT = 100;
export const MAX_RETRIES_LIMIT = 4; // Corresponds to backend maxAttempts = 5
export const MAX_SIMULATION_DELAY_MS = 5000;
export const DEFAULT_SIMULATION_DELAY_MS = 500;
export const MAX_RETRY_INITIAL_DELAY_MS = 2000;
export const DEFAULT_RETRY_INITIAL_DELAY_MS = 50;
export const MAX_ERROR_MESSAGE_LENGTH = 255;

export const SUPPORTED_SIMULATION_ACTIONS: readonly TaskActionType[] = [
  'NO_OP',
  'DELAY',
  'FAIL',
  'FAIL_UNTIL_ATTEMPT',
];

export interface ExecutionPreflightError {
  field: string;
  message: string;
}

export interface StrictIntegerResult {
  isProvided: boolean;
  isValid: boolean;
  value?: number;
  errorReason?: string;
}

/**
 * Validates whether an execution parameter is a valid integer.
 * Accepts numbers that satisfy Number.isInteger() and strict numeric integer strings (e.g. "500").
 * Rejects NaN, Infinity, -Infinity, fractional numbers (e.g. 2.5), non-numeric strings, empty strings, objects, arrays.
 */
export function validateStrictInteger(val: unknown, fieldName: string): StrictIntegerResult {
  if (val === undefined || val === null) {
    return { isProvided: false, isValid: true };
  }

  if (typeof val === 'number') {
    if (Number.isNaN(val)) {
      return { isProvided: true, isValid: false, errorReason: `${fieldName} cannot be NaN.` };
    }
    if (!Number.isFinite(val)) {
      return { isProvided: true, isValid: false, errorReason: `${fieldName} cannot be infinite.` };
    }
    if (!Number.isInteger(val)) {
      return {
        isProvided: true,
        isValid: false,
        errorReason: `${fieldName} must be an integer, received fractional number ${val}.`,
      };
    }
    return { isProvided: true, isValid: true, value: val };
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || !/^-?\d+$/.test(trimmed)) {
      return {
        isProvided: true,
        isValid: false,
        errorReason: `${fieldName} must be an integer, received "${val}".`,
      };
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      return { isProvided: true, isValid: false, errorReason: `${fieldName} is outside safe integer range.` };
    }
    return { isProvided: true, isValid: true, value: parsed };
  }

  return { isProvided: true, isValid: false, errorReason: `${fieldName} must be a number or integer string.` };
}

export interface ExtractedSimulationConfig {
  hasExplicitOverride: boolean;
  isMalformed?: boolean;
  malformedReason?: string;
  action?: TaskActionType;
  rawActionName?: string;
  rawDelay?: unknown;
  delayMs?: unknown;
  rawFailUntil?: unknown;
  failUntilAttempt?: unknown;
  errorMessage?: string;
}

export interface ExtractedRetryConfig {
  isMalformed?: boolean;
  malformedReason?: string;
  rawInitialDelayMs?: unknown;
}

/**
 * Safely extracts explicit simulation configurations from task parameters.
 * Supports both nested parameters (`parameters.simulation = { action: '...' }`)
 * and top-level parameters (`parameters.action = '...'`).
 *
 * Rules:
 * - If the `simulation` property is explicitly present, it must be a valid plain object specifying an action/type.
 * - Explicit malformed objects (null, string, array, empty object, null action) are flagged as isMalformed: true.
 * - If no explicit simulation configuration exists, hasExplicitOverride is false.
 */
export function extractSimulationConfig(
  parameters?: Record<string, unknown>
): ExtractedSimulationConfig {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { hasExplicitOverride: false };
  }

  const hasSimProp = Object.prototype.hasOwnProperty.call(parameters, 'simulation');

  if (hasSimProp) {
    const rawSim = parameters.simulation;
    if (rawSim === null) {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit "simulation" parameter must be a non-null object.',
      };
    }
    if (typeof rawSim !== 'object' || Array.isArray(rawSim)) {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit "simulation" parameter must be a plain object.',
      };
    }

    const simObj = rawSim as Record<string, unknown>;
    const hasActionProp = Object.prototype.hasOwnProperty.call(simObj, 'action');
    const hasTypeProp = Object.prototype.hasOwnProperty.call(simObj, 'type');

    if (!hasActionProp && !hasTypeProp) {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit "simulation" object must specify an action or type.',
      };
    }

    const rawAction = simObj.action ?? simObj.type;
    if (rawAction === null || rawAction === undefined) {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit simulation action cannot be null or undefined.',
      };
    }

    const rawActionStr = String(rawAction).trim();
    if (rawActionStr === '') {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit simulation action cannot be blank.',
      };
    }

    const matchedType = SUPPORTED_SIMULATION_ACTIONS.find(
      (action) => action.toUpperCase() === rawActionStr.toUpperCase()
    );

    const rawDelay = simObj.delayMs ?? simObj.delay;
    const rawFailUntil = simObj.failUntilAttempt ?? simObj.threshold;
    const rawError = simObj.errorMessage ?? simObj.error;
    const parsedError =
      rawError !== undefined && rawError !== null ? String(rawError).trim() : undefined;

    return {
      hasExplicitOverride: true,
      action: matchedType,
      rawActionName: rawActionStr,
      rawDelay,
      delayMs: rawDelay,
      rawFailUntil,
      failUntilAttempt: rawFailUntil,
      errorMessage: parsedError,
    };
  }

  // Top-level action/type override
  const hasActionProp = Object.prototype.hasOwnProperty.call(parameters, 'action');
  const hasTypeProp = Object.prototype.hasOwnProperty.call(parameters, 'type');

  if (hasActionProp || hasTypeProp) {
    const rawAction = parameters.action ?? parameters.type;
    if (rawAction === null || rawAction === undefined) {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit action parameter cannot be null or undefined.',
      };
    }

    const rawActionStr = String(rawAction).trim();
    if (rawActionStr === '') {
      return {
        hasExplicitOverride: true,
        isMalformed: true,
        malformedReason: 'Explicit action parameter cannot be blank.',
      };
    }

    const matchedType = SUPPORTED_SIMULATION_ACTIONS.find(
      (action) => action.toUpperCase() === rawActionStr.toUpperCase()
    );

    const rawDelay = parameters.delayMs ?? parameters.delay;
    const rawFailUntil = parameters.failUntilAttempt ?? parameters.threshold;
    const rawError = parameters.errorMessage ?? parameters.error;
    const parsedError =
      rawError !== undefined && rawError !== null ? String(rawError).trim() : undefined;

    return {
      hasExplicitOverride: true,
      action: matchedType,
      rawActionName: rawActionStr,
      rawDelay,
      delayMs: rawDelay,
      rawFailUntil,
      failUntilAttempt: rawFailUntil,
      errorMessage: parsedError,
    };
  }

  return { hasExplicitOverride: false };
}

/**
 * Extracts optional retry configuration overrides from task parameters.
 */
export function extractRetryConfig(
  parameters?: Record<string, unknown>
): ExtractedRetryConfig {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return {};
  }

  if (Object.prototype.hasOwnProperty.call(parameters, 'retry')) {
    const rawRetry = parameters.retry;
    if (rawRetry === null || typeof rawRetry !== 'object' || Array.isArray(rawRetry)) {
      return {
        isMalformed: true,
        malformedReason: 'Explicit "retry" parameter must be a plain object.',
      };
    }

    const retryObj = rawRetry as Record<string, unknown>;
    const rawDelay = retryObj.retryInitialDelayMs ?? retryObj.initialDelayMs;
    return {
      rawInitialDelayMs: rawDelay,
    };
  }

  const hasDirectDelay =
    Object.prototype.hasOwnProperty.call(parameters, 'retryInitialDelayMs') ||
    Object.prototype.hasOwnProperty.call(parameters, 'initialDelayMs');

  if (hasDirectDelay) {
    const rawDelay = parameters.retryInitialDelayMs ?? parameters.initialDelayMs;
    return {
      rawInitialDelayMs: rawDelay,
    };
  }

  return {};
}

/**
 * Validates graph limits, duplicate IDs, retries, and explicit simulation action bounds
 * before submitting a workflow execution request to the server.
 */
export function validateExecutionPreflight(
  nodes: Node<TaskNodeData>[],
  edges: Edge[]
): ExecutionPreflightError[] {
  const errors: ExecutionPreflightError[] = [];

  if (!nodes || nodes.length === 0) {
    errors.push({
      field: 'tasks',
      message: 'Workflow must contain at least one task node.',
    });
    return errors;
  }

  if (nodes.length > MAX_TASKS_LIMIT) {
    errors.push({
      field: 'tasks',
      message: `Task count (${nodes.length}) exceeds maximum limit of ${MAX_TASKS_LIMIT} tasks.`,
    });
  }

  if (edges.length > MAX_EDGES_LIMIT) {
    errors.push({
      field: 'edges',
      message: `Edge count (${edges.length}) exceeds maximum limit of ${MAX_EDGES_LIMIT} edges.`,
    });
  }

  const seenNodeIds = new Set<string>();

  for (const node of nodes) {
    const id = node.id?.trim();
    const label = node.data?.label || node.id;

    if (!id) {
      errors.push({
        field: `node-${node.id}`,
        message: 'Task ID must not be blank.',
      });
      continue;
    }

    if (seenNodeIds.has(id)) {
      errors.push({
        field: `node-${id}`,
        message: `Duplicate task ID detected: "${id}".`,
      });
    } else {
      seenNodeIds.add(id);
    }

    // Retries validation: Never silently clamp invalid, legacy, or imported values
    const retriesRaw = node.data?.maxRetries;
    const retriesRes = validateStrictInteger(retriesRaw, 'maxRetries');

    if (!retriesRes.isValid) {
      errors.push({
        field: `node-${id}-retries`,
        message: `Task "${label}": ${retriesRes.errorReason}`,
      });
    } else if (retriesRes.isProvided && retriesRes.value !== undefined) {
      if (retriesRes.value < 0) {
        errors.push({
          field: `node-${id}-retries`,
          message: `Task "${label}" maxRetries cannot be negative (${retriesRes.value}).`,
        });
      } else if (retriesRes.value > MAX_RETRIES_LIMIT) {
        errors.push({
          field: `node-${id}-retries`,
          message: `Task "${label}" specifies ${retriesRes.value} retries. The server allows a maximum of 4 retries (5 total attempts). Please adjust the retry count in the Task Inspector before running.`,
        });
      }
    }

    // Explicit simulation action validation
    const params = node.data?.parameters as Record<string, unknown> | undefined;
    const simConfig = extractSimulationConfig(params);

    if (simConfig.hasExplicitOverride) {
      if (simConfig.isMalformed) {
        errors.push({
          field: `node-${id}-simulation-override`,
          message: `Task "${label}" has an invalid simulation configuration: ${simConfig.malformedReason}`,
        });
      } else if (!simConfig.action) {
        errors.push({
          field: `node-${id}-simulation-action`,
          message: `Task "${label}" specifies an unsupported simulation action "${simConfig.rawActionName}". Allowed simulation actions are: NO_OP, DELAY, FAIL, FAIL_UNTIL_ATTEMPT.`,
        });
      } else {
        switch (simConfig.action) {
          case 'DELAY': {
            const delayRes = validateStrictInteger(simConfig.rawDelay, 'simulation delayMs');
            if (!delayRes.isValid) {
              errors.push({
                field: `node-${id}-delayMs`,
                message: `Task "${label}": ${delayRes.errorReason}`,
              });
            } else {
              const delayVal =
                delayRes.isProvided && delayRes.value !== undefined ? delayRes.value : 0;
              if (delayVal < 0 || delayVal > MAX_SIMULATION_DELAY_MS) {
                errors.push({
                  field: `node-${id}-delayMs`,
                  message: `Task "${label}" simulation delay (${delayVal}ms) must be between 0 and ${MAX_SIMULATION_DELAY_MS} ms.`,
                });
              }
            }
            break;
          }
          case 'FAIL': {
            if (
              simConfig.errorMessage &&
              simConfig.errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
            ) {
              errors.push({
                field: `node-${id}-errorMessage`,
                message: `Task "${label}" errorMessage exceeds the ${MAX_ERROR_MESSAGE_LENGTH}-character server limit (${simConfig.errorMessage.length} chars).`,
              });
            }
            break;
          }
          case 'FAIL_UNTIL_ATTEMPT': {
            const threshRes = validateStrictInteger(
              simConfig.rawFailUntil,
              'failUntilAttempt'
            );
            if (!threshRes.isValid) {
              errors.push({
                field: `node-${id}-failUntilAttempt`,
                message: `Task "${label}": ${threshRes.errorReason}`,
              });
            } else {
              const threshVal =
                threshRes.isProvided && threshRes.value !== undefined ? threshRes.value : 1;
              if (threshVal < 1 || threshVal > 5) {
                errors.push({
                  field: `node-${id}-failUntilAttempt`,
                  message: `Task "${label}" failUntilAttempt (${threshVal}) must be between 1 and 5.`,
                });
              }
            }
            if (
              simConfig.errorMessage &&
              simConfig.errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
            ) {
              errors.push({
                field: `node-${id}-errorMessage`,
                message: `Task "${label}" errorMessage exceeds the ${MAX_ERROR_MESSAGE_LENGTH}-character server limit (${simConfig.errorMessage.length} chars).`,
              });
            }
            break;
          }
          case 'NO_OP':
            break;
        }
      }
    }

    // DELAY_WAIT task without explicit override but with direct delayMs parameter
    if (node.data?.taskType === 'DELAY_WAIT' && !simConfig.hasExplicitOverride && params) {
      const hasDirectDelay =
        Object.prototype.hasOwnProperty.call(params, 'delayMs') ||
        Object.prototype.hasOwnProperty.call(params, 'delay');
      if (hasDirectDelay) {
        const delayRes = validateStrictInteger(params.delayMs ?? params.delay, 'delayMs');
        if (!delayRes.isValid) {
          errors.push({
            field: `node-${id}-delayMs`,
            message: `Task "${label}": ${delayRes.errorReason}`,
          });
        } else if (
          delayRes.value !== undefined &&
          (delayRes.value < 0 || delayRes.value > MAX_SIMULATION_DELAY_MS)
        ) {
          errors.push({
            field: `node-${id}-delayMs`,
            message: `Task "${label}" simulation delay (${delayRes.value}ms) must be between 0 and ${MAX_SIMULATION_DELAY_MS} ms.`,
          });
        }
      }
    }

    // Retry initial delay validation
    const retryConfig = extractRetryConfig(params);
    if (retryConfig.isMalformed) {
      errors.push({
        field: `node-${id}-retry`,
        message: `Task "${label}": ${retryConfig.malformedReason}`,
      });
    } else if (retryConfig.rawInitialDelayMs !== undefined) {
      const retryRes = validateStrictInteger(
        retryConfig.rawInitialDelayMs,
        'retry initial delay'
      );
      if (!retryRes.isValid) {
        errors.push({
          field: `node-${id}-retryInitialDelayMs`,
          message: `Task "${label}": ${retryRes.errorReason}`,
        });
      } else if (
        retryRes.value !== undefined &&
        (retryRes.value < 0 || retryRes.value > MAX_RETRY_INITIAL_DELAY_MS)
      ) {
        errors.push({
          field: `node-${id}-retryInitialDelayMs`,
          message: `Task "${label}" retry initial delay (${retryRes.value}ms) must be between 0 and ${MAX_RETRY_INITIAL_DELAY_MS} ms.`,
        });
      }
    }
  }

  // Edge validation
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const src = edge.source?.trim();
    const tgt = edge.target?.trim();

    if (!src || !tgt) {
      errors.push({
        field: `edge-${edge.id}`,
        message: 'Edge source and target task IDs must not be blank.',
      });
      continue;
    }

    if (!seenNodeIds.has(src) || !seenNodeIds.has(tgt)) {
      errors.push({
        field: `edge-${edge.id}`,
        message: `Edge references unknown task: "${src}" -> "${tgt}".`,
      });
    }

    const edgeKey = `${src}->${tgt}`;
    if (seenEdges.has(edgeKey)) {
      errors.push({
        field: `edge-${edge.id}`,
        message: `Duplicate dependency edge detected: "${src}" -> "${tgt}".`,
      });
    } else {
      seenEdges.add(edgeKey);
    }
  }

  return errors;
}

/**
 * Maps React Flow nodes and edges into the backend ExecuteWorkflowRequest DTO.
 *
 * Rules:
 * - node.data.timeoutMs is strictly excluded from simulation and retry delays.
 * - DELAY_WAIT maps to DELAY with default 500 ms (or validated delayMs parameter).
 * - Semantic task types default to NO_OP unless an explicit valid simulation override exists.
 * - maxRetries converts exactly to maxAttempts = maxRetries + 1 (bounds 1..5).
 */
export function toExecuteWorkflowRequest(
  nodes: Node<TaskNodeData>[],
  edges: Edge[]
): ExecuteWorkflowRequest {
  const tasks: TaskDefinitionDto[] = nodes.map((node) => {
    const params = node.data?.parameters as Record<string, unknown> | undefined;
    const simConfig = extractSimulationConfig(params);
    const retryConfig = extractRetryConfig(params);

    // Resolve simulated action
    let action: TaskActionDto;

    if (simConfig.hasExplicitOverride && simConfig.action) {
      const delayVal =
        simConfig.rawDelay !== undefined
          ? validateStrictInteger(simConfig.rawDelay, 'delayMs').value
          : undefined;
      const threshVal =
        simConfig.rawFailUntil !== undefined
          ? validateStrictInteger(simConfig.rawFailUntil, 'failUntilAttempt').value
          : undefined;

      action = {
        type: simConfig.action,
        ...(delayVal !== undefined ? { delayMs: delayVal } : {}),
        ...(threshVal !== undefined ? { failUntilAttempt: threshVal } : {}),
        ...(simConfig.errorMessage !== undefined ? { errorMessage: simConfig.errorMessage } : {}),
      };
    } else if (node.data?.taskType === 'DELAY_WAIT') {
      const rawDelay = params?.delayMs ?? params?.delay;
      const delayRes = validateStrictInteger(rawDelay, 'delayMs');
      const explicitDelay =
        delayRes.isValid && delayRes.isProvided && delayRes.value !== undefined
          ? delayRes.value
          : DEFAULT_SIMULATION_DELAY_MS;
      action = {
        type: 'DELAY',
        delayMs: Math.min(MAX_SIMULATION_DELAY_MS, Math.max(0, explicitDelay)),
      };
    } else {
      action = {
        type: 'NO_OP',
      };
    }

    // Resolve retry policy: retries (0..4) -> attempts (1..5)
    let retryPolicy: RetryPolicyDto | undefined;
    const retriesRes = validateStrictInteger(node.data?.maxRetries, 'maxRetries');
    const retries =
      retriesRes.isValid && retriesRes.isProvided && retriesRes.value !== undefined
        ? Math.max(0, retriesRes.value)
        : 0;

    if (retries > 0) {
      const maxAttempts = Math.min(5, retries + 1);
      const retryDelayRes = validateStrictInteger(
        retryConfig.rawInitialDelayMs,
        'initialDelayMs'
      );
      const initialDelayMs =
        retryDelayRes.isValid && retryDelayRes.isProvided && retryDelayRes.value !== undefined
          ? Math.min(MAX_RETRY_INITIAL_DELAY_MS, Math.max(0, retryDelayRes.value))
          : DEFAULT_RETRY_INITIAL_DELAY_MS;

      retryPolicy = {
        maxAttempts,
        backoffStrategy: 'FIXED',
        initialDelayMs,
      };
    } else {
      retryPolicy = {
        maxAttempts: 1,
        backoffStrategy: 'NONE',
      };
    }

    return {
      id: node.id.trim(),
      action,
      retryPolicy,
    };
  });

  const edgeDtos = edges.map((e) => ({
    source: e.source.trim(),
    target: e.target.trim(),
  }));

  return {
    tasks,
    edges: edgeDtos,
  };
}

export interface ExecutionRunResult {
  success: boolean;
  preflightErrors?: ExecutionPreflightError[];
  response?: ExecuteWorkflowResponse;
  error?: {
    status: number;
    message: string;
    details: string[];
    isTimeout?: boolean;
    isCapacityExhausted?: boolean;
    isNetworkFailure?: boolean;
  };
}

export interface WorkflowExecutionContext {
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  isExecuting: boolean;
  setIsExecuting: (executing: boolean) => void;
  onExecutionComplete?: (result: ExecutionRunResult) => void;
  onUpdateNodeStatus?: (nodeId: string, status: TaskStatus, durationMs?: number) => void;
  onShowToast?: (
    title: string,
    message?: string,
    type?: 'success' | 'info' | 'warning' | 'error'
  ) => void;
  executeApiFn?: (request: ExecuteWorkflowRequest) => Promise<ExecuteWorkflowResponse>;
}

/**
 * Orchestrates preflight validation, API submission, canvas state updates,
 * and structured error handling for simulated workflow execution.
 */
export async function executeWorkflowRun(
  context: WorkflowExecutionContext
): Promise<ExecutionRunResult> {
  const {
    nodes,
    edges,
    isExecuting,
    setIsExecuting,
    onExecutionComplete,
    onUpdateNodeStatus,
    onShowToast,
    executeApiFn = defaultExecuteWorkflow,
  } = context;

  // Prevent duplicate execution requests while an execution is in-flight
  if (isExecuting) {
    return {
      success: false,
      error: {
        status: 0,
        message: 'Workflow execution is already in progress.',
        details: [],
      },
    };
  }

  // Pre-flight validation
  const preflightErrors = validateExecutionPreflight(nodes, edges);
  if (preflightErrors.length > 0) {
    const primaryMsg = preflightErrors[0].message;
    if (onShowToast) {
      onShowToast('Execution Blocked', primaryMsg, 'warning');
    }
    const result: ExecutionRunResult = {
      success: false,
      preflightErrors,
      error: {
        status: 400,
        message: primaryMsg,
        details: preflightErrors.map((e) => e.message),
      },
    };
    if (onExecutionComplete) {
      onExecutionComplete(result);
    }
    return result;
  }

  setIsExecuting(true);

  try {
    const request = toExecuteWorkflowRequest(nodes, edges);
    const response = await executeApiFn(request);

    // Update individual node statuses on canvas based on returned task results
    if (onUpdateNodeStatus && response.taskResults) {
      for (const [taskId, taskResult] of Object.entries(response.taskResults)) {
        onUpdateNodeStatus(
          taskId,
          taskResult.state as TaskStatus,
          taskResult.durationMs ?? undefined
        );
      }
    }

    if (onShowToast) {
      if (response.state === 'COMPLETED') {
        onShowToast(
          'Simulated Run Completed',
          `All tasks finished successfully in ${response.durationMs}ms.`,
          'success'
        );
      } else {
        onShowToast(
          'Simulated Run Failed',
          'One or more tasks failed during simulation. Inspect details.',
          'error'
        );
      }
    }

    const result: ExecutionRunResult = {
      success: true,
      response,
    };

    if (onExecutionComplete) {
      onExecutionComplete(result);
    }
    return result;
  } catch (err: unknown) {
    let status = 500;
    let message = 'An unexpected error occurred during simulated execution.';
    let details: string[] = [];
    let isTimeout = false;
    let isCapacityExhausted = false;
    let isNetworkFailure = false;

    if (err instanceof FlowForgeApiError) {
      status = err.status;
      message = err.message;
      details = err.details;

      if (status === 504) {
        isTimeout = true;
        if (onShowToast) {
          onShowToast(
            'Gateway Timeout',
            `${message} — Background server tasks may still be concluding.`,
            'warning'
          );
        }
      } else if (status === 429) {
        isCapacityExhausted = true;
        if (onShowToast) {
          onShowToast(
            'Server Capacity Exhausted',
            `${message} Please retry shortly.`,
            'warning'
          );
        }
      } else if (status === 0) {
        isNetworkFailure = true;
        if (onShowToast) {
          onShowToast(
            'Server Offline',
            'Unable to connect to FlowForge backend at http://localhost:8080.',
            'error'
          );
        }
      } else if (status === 400) {
        if (onShowToast) {
          onShowToast('Workflow Rejected', message, 'error');
        }
      } else {
        if (onShowToast) {
          onShowToast('Execution Error', message, 'error');
        }
      }
    } else {
      if (onShowToast) {
        onShowToast('Execution Error', message, 'error');
      }
    }

    const result: ExecutionRunResult = {
      success: false,
      error: {
        status,
        message,
        details,
        isTimeout,
        isCapacityExhausted,
        isNetworkFailure,
      },
    };

    if (onExecutionComplete) {
      onExecutionComplete(result);
    }
    return result;
  } finally {
    setIsExecuting(false);
  }
}
