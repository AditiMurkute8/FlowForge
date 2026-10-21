import type { Node, Edge } from '@xyflow/react';
import type {
  TaskNodeData,
  TaskStatus,
  WorkflowVersionResponseDto,
  WorkflowRunResponseDto,
  TaskRunResponseDto,
  WorkflowRunState,
} from '../types';
import {
  executeWorkflowVersionRun as defaultExecuteWorkflowVersionRun,
  FlowForgeApiError,
} from '../api/flowForgeApi';
import { formatDuration } from '../components/workflow/RunHistoryModal';

/**
 * Determines whether the current React Flow canvas has unsaved structural or task configuration changes
 * compared to the latest saved immutable workflow version snapshot.
 *
 * Compares:
 * - Version existence (if currentVersion is null or has no graphPayload, returns true)
 * - Node count and Edge count
 * - Task node presence by ID
 * - Task configuration properties (label, taskType, timeoutMs, maxRetries, parameters)
 * - Directed edge connections (source -> target dependency ordering)
 */
export function isCanvasDirty(
  nodes: Node<TaskNodeData>[],
  edges: Edge[],
  currentVersion: WorkflowVersionResponseDto | null
): boolean {
  if (!currentVersion || !currentVersion.graphPayload) {
    return true;
  }

  const savedPayload = currentVersion.graphPayload;
  const savedNodes = Array.isArray(savedPayload.nodes)
    ? (savedPayload.nodes as Array<{ id: string; data?: Record<string, unknown> }>)
    : [];
  const savedEdges = Array.isArray(savedPayload.edges)
    ? (savedPayload.edges as Array<{ source: string; target: string }>)
    : [];

  if (nodes.length !== savedNodes.length || edges.length !== savedEdges.length) {
    return true;
  }

  const savedNodeMap = new Map<string, Record<string, unknown>>();
  for (const sn of savedNodes) {
    if (sn && typeof sn.id === 'string') {
      savedNodeMap.set(sn.id.trim(), (sn.data || {}) as Record<string, unknown>);
    }
  }

  if (savedNodeMap.size !== nodes.length) {
    return true;
  }

  for (const node of nodes) {
    const savedData = savedNodeMap.get(node.id.trim());
    if (!savedData) {
      return true;
    }

    const currData = node.data || {};
    if (currData.label !== savedData.label) return true;
    if (currData.taskType !== savedData.taskType) return true;
    if (currData.timeoutMs !== savedData.timeoutMs) return true;
    if (currData.maxRetries !== savedData.maxRetries) return true;

    // Compare parameters payload safely
    const currParams = JSON.stringify(currData.parameters || {});
    const savedParams = JSON.stringify(savedData.parameters || {});
    if (currParams !== savedParams) return true;
  }

  // Compare directed edge connections (prerequisite -> dependent)
  const savedEdgeSet = new Set<string>();
  for (const se of savedEdges) {
    if (se && typeof se.source === 'string' && typeof se.target === 'string') {
      savedEdgeSet.add(`${se.source.trim()}->${se.target.trim()}`);
    }
  }

  for (const edge of edges) {
    const key = `${edge.source.trim()}->${edge.target.trim()}`;
    if (!savedEdgeSet.has(key)) {
      return true;
    }
  }

  return false;
}

/**
 * Maps task run results from a durable workflow execution to React Flow canvas nodes.
 *
 * Rules:
 * - Updates status, duration, attempt count, and error message for matching task nodes.
 * - Does not fabricate task results or treat missing tasks as success.
 * - Leaves untouched nodes or sets missing tasks to IDLE.
 * - Preserves all canvas positions, labels, parameters, and editing configuration.
 */
export function applyDurableRunTaskResults(
  nodes: Node<TaskNodeData>[],
  taskRuns?: TaskRunResponseDto[]
): Node<TaskNodeData>[] {
  const taskRunMap = new Map<string, TaskRunResponseDto>();
  if (Array.isArray(taskRuns)) {
    for (const tr of taskRuns) {
      if (tr && tr.taskId) {
        taskRunMap.set(tr.taskId.trim(), tr);
      }
    }
  }

  return nodes.map((node) => {
    const tr = taskRunMap.get(node.id.trim());
    if (!tr) {
      return {
        ...node,
        data: {
          ...node.data,
          status: 'IDLE' as TaskStatus,
          executionDurationMs: undefined,
          errorMessage: undefined,
        },
      };
    }

    return {
      ...node,
      data: {
        ...node.data,
        status: tr.status as TaskStatus,
        executionDurationMs: tr.durationMs !== null ? tr.durationMs : undefined,
        attemptCount: tr.attemptCount,
        errorMessage: tr.errorMessage || undefined,
      },
    };
  });
}

/**
 * Resets execution status of all nodes on canvas to IDLE, clearing previous run telemetry.
 */
export function resetCanvasExecutionStatus(
  nodes: Node<TaskNodeData>[]
): Node<TaskNodeData>[] {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      status: 'IDLE' as TaskStatus,
      executionDurationMs: undefined,
      errorMessage: undefined,
    },
  }));
}

export interface ExecuteDurableWorkflowParams {
  workflowId?: string;
  workflowName?: string;
  isMockWorkflow?: boolean;
  currentVersion: WorkflowVersionResponseDto | null;
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  isExecuting: boolean;
  setIsExecuting: (executing: boolean) => void;
  setNodes: (updateFn: (nds: Node<TaskNodeData>[]) => Node<TaskNodeData>[]) => void;
  onShowToast: (
    title: string,
    message?: string,
    type?: 'success' | 'info' | 'warning' | 'error'
  ) => void;
  onExecutionComplete?: (run?: WorkflowRunResponseDto) => void;
  executeDurableApiFn?: typeof defaultExecuteWorkflowVersionRun;
  isAuthenticated?: boolean;
}

export interface DurableExecutionResult {
  success: boolean;
  status?: WorkflowRunState;
  response?: WorkflowRunResponseDto;
  error?: {
    status: number;
    message: string;
    details?: string[];
    isTimeout?: boolean;
    isCapacityExhausted?: boolean;
    isNetworkFailure?: boolean;
  };
  reason?: 'MOCK_WORKFLOW' | 'NO_VERSION' | 'UNSAVED_CHANGES' | 'CYCLIC_VERSION' | 'IN_FLIGHT' | 'UNAUTHENTICATED';
}

/**
 * Orchestrates preflight checks, submission to durable execution REST API,
 * canvas task node status updates, and error handling for durable workflow runs.
 */
export async function executeDurableWorkflowRun({
  workflowId,
  isMockWorkflow,
  currentVersion,
  nodes,
  edges,
  isExecuting,
  setIsExecuting,
  setNodes,
  onShowToast,
  onExecutionComplete,
  executeDurableApiFn = defaultExecuteWorkflowVersionRun,
  isAuthenticated,
}: ExecuteDurableWorkflowParams): Promise<DurableExecutionResult> {
  // 1. In-flight guard
  if (isExecuting) {
    return {
      success: false,
      reason: 'IN_FLIGHT',
      error: {
        status: 0,
        message: 'A workflow execution is already in progress.',
      },
    };
  }

  // 2. Authentication guard
  if (isAuthenticated === false) {
    onShowToast(
      'Authentication Required',
      'Please sign in to execute durable workflow runs.',
      'warning'
    );
    return {
      success: false,
      reason: 'UNAUTHENTICATED',
      error: {
        status: 401,
        message: 'Authentication required to execute durable workflow runs.',
      },
    };
  }

  // 2. Mock workflow guard (never send mock IDs to backend durable API)
  if (isMockWorkflow || !workflowId) {
    onShowToast(
      'Sample Template (Cannot Run Durably)',
      'Sample templates run in offline preview mode without PostgreSQL persistence. Select a persistent project workspace to trigger durable executions.',
      'warning'
    );
    return { success: false, reason: 'MOCK_WORKFLOW' };
  }

  // 3. Saved version existence guard
  if (!currentVersion) {
    onShowToast(
      'Save Required',
      'This workflow has no saved immutable versions. Click "Save Draft" to persist version v1.0 before executing.',
      'warning'
    );
    return { success: false, reason: 'NO_VERSION' };
  }

  // 4. Unsaved canvas modifications guard
  if (isCanvasDirty(nodes, edges, currentVersion)) {
    onShowToast(
      'Unsaved Changes',
      `The canvas contains unsaved changes that differ from saved version v${currentVersion.versionNumber}. Click "Save Draft" to persist your changes before executing.`,
      'warning'
    );
    return { success: false, reason: 'UNSAVED_CHANGES' };
  }

  // 5. Saved version validity guard (prevent executing known cyclic drafts)
  if (currentVersion.isValidDag === false) {
    onShowToast(
      'Invalid DAG Version',
      `Saved version v${currentVersion.versionNumber} contains cycles or invalid dependencies and cannot be executed on the server.`,
      'error'
    );
    return { success: false, reason: 'CYCLIC_VERSION' };
  }

  // 6. Execution Phase
  setIsExecuting(true);

  // Clear stale status on canvas to indicate fresh execution
  setNodes((prevNodes) =>
    prevNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        status: 'RUNNING' as TaskStatus,
        executionDurationMs: undefined,
        errorMessage: undefined,
      },
    }))
  );

  try {
    const response = await executeDurableApiFn(workflowId, {
      versionNumber: currentVersion.versionNumber,
      triggeredBy: 'manual-ui',
    });

    // Update canvas nodes with durable execution results
    setNodes((prevNodes) => applyDurableRunTaskResults(prevNodes, response.tasks));

    // Notify completion callback (triggers run history refresh)
    if (onExecutionComplete) {
      onExecutionComplete(response);
    }

    // Display appropriate completion feedback
    if (response.status === 'COMPLETED') {
      onShowToast(
        'Execution Completed',
        `Workflow version v${response.versionNumber} completed successfully in ${formatDuration(response.durationMs)}.`,
        'success'
      );
    } else if (response.status === 'FAILED') {
      const failedTasks = (response.tasks || []).filter((t) => t.status === 'FAILED');
      const failSummary =
        failedTasks
          .map((t) => (t.errorMessage ? `${t.taskId}: ${t.errorMessage}` : t.taskId))
          .join('; ') || 'One or more tasks failed.';
      onShowToast(
        'Execution Failed',
        `Workflow version v${response.versionNumber} failed: ${failSummary}`,
        'error'
      );
    } else if (response.status === 'CANCELLED') {
      onShowToast(
        'Execution Cancelled',
        `Workflow version v${response.versionNumber} was cancelled before completion.`,
        'warning'
      );
    }

    return {
      success: response.status === 'COMPLETED',
      status: response.status,
      response,
    };
  } catch (err: unknown) {
    // Revert nodes to IDLE if execution failed before returning task runs
    setNodes((prevNodes) => resetCanvasExecutionStatus(prevNodes));

    let status = 500;
    let message = 'An unexpected error occurred during workflow execution.';
    let details: string[] = [];
    let isTimeout = false;
    let isCapacityExhausted = false;
    let isNetworkFailure = false;

    if (err instanceof FlowForgeApiError) {
      status = err.status;
      message = err.message;
      details = err.details || [];

      if (status === 429) {
        isCapacityExhausted = true;
        const retrySuffix =
          typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0
            ? ` Please retry in ${err.retryAfterSeconds} seconds.`
            : ' Please retry shortly when server capacity frees up.';
        onShowToast('Capacity Exhausted (429)', `${message}${retrySuffix}`, 'warning');
      } else if (status === 504) {
        isTimeout = true;
        onShowToast(
          'Gateway Timeout (504)',
          `${message} Execution exceeded timeout. Server-side workers may still be concluding.`,
          'warning'
        );
        // Persisted run record exists in DB on timeout; trigger history refresh
        if (onExecutionComplete) {
          onExecutionComplete();
        }
      } else if (status === 400) {
        const detailSuffix = details.length > 0 ? `: ${details.join(', ')}` : '';
        onShowToast('Execution Rejected (400)', `${message}${detailSuffix}`, 'error');
      } else if (status === 404) {
        onShowToast('Resource Not Found (404)', message, 'error');
      } else if (status === 0) {
        isNetworkFailure = true;
        onShowToast(
          'Server Offline',
          'Unable to connect to FlowForge server at http://localhost:8080.',
          'error'
        );
      } else {
        onShowToast('Execution Error', message, 'error');
      }
    } else if (err instanceof Error) {
      message = err.message;
      onShowToast('Execution Error', message, 'error');
    }

    return {
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
  } finally {
    setIsExecuting(false);
  }
}
