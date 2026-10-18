import React, { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import type {
  TaskNodeData,
  TaskType,
  BackendTaskState,
  ExecuteWorkflowResponse,
  TaskExecutionResponseDto,
} from '../../types';
import type { ExecutionRunResult } from '../../utils/workflowExecutionAdapters';
import { Modal } from '../ui/Modal';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  RotateCcw,
} from 'lucide-react';

export interface ExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  isExecuting: boolean;
  executionResult: ExecutionRunResult | null;
  onRunExecution: () => void;
  nodes: Node<TaskNodeData>[];
}

export interface DisplayTaskResult {
  id: string;
  label: string;
  taskType?: TaskType;
  state: BackendTaskState;
  durationMs: number | null;
  attemptCount: number;
  errorMessage: string | null;
  attemptErrors: string[];
}

export function computeDisplayTaskList(
  nodes: Node<TaskNodeData>[],
  response?: ExecuteWorkflowResponse
): DisplayTaskResult[] {
  if (!response?.taskResults || Object.keys(response.taskResults).length === 0) {
    return [];
  }

  const knownTaskIds = new Set(nodes.map((n) => n.id));
  const items: DisplayTaskResult[] = nodes.map((node) => {
    const res = response.taskResults[node.id];
    return {
      id: node.id,
      label: node.data.label || node.id,
      taskType: node.data.taskType,
      state: res?.state ?? ('PENDING' as BackendTaskState),
      durationMs: res?.durationMs ?? null,
      attemptCount: res?.attemptCount ?? 0,
      errorMessage: res?.errorMessage ?? null,
      attemptErrors: res?.attemptErrors ?? [],
    };
  });

  for (const [id, res] of Object.entries(response.taskResults) as [string, TaskExecutionResponseDto][]) {
    if (!knownTaskIds.has(id)) {
      items.push({
        id,
        label: id,
        state: res.state,
        durationMs: res.durationMs,
        attemptCount: res.attemptCount,
        errorMessage: res.errorMessage,
        attemptErrors: res.attemptErrors ?? [],
      });
    }
  }

  return items;
}

export function resolveModalTitleAndDescription(
  isExecuting: boolean,
  executionResult: ExecutionRunResult | null
): { title: string; description: string } {
  const title = isExecuting
    ? 'Simulating Workflow Execution'
    : executionResult?.preflightErrors && executionResult.preflightErrors.length > 0
    ? 'Preflight Validation Blocked'
    : executionResult?.error?.isTimeout
    ? 'Execution Outcome Unknown'
    : executionResult?.error
    ? 'Execution Failed'
    : executionResult?.success
    ? 'Simulated Execution Results'
    : 'Simulated Workflow Execution';

  const description = isExecuting
    ? 'Awaiting response from backend engine (POST /api/v1/workflows/execute)...'
    : executionResult?.preflightErrors && executionResult.preflightErrors.length > 0
    ? 'Execution was halted before sending to server'
    : executionResult?.error?.isTimeout
    ? 'Gateway timeout (HTTP 504) — Background tasks may still be active'
    : executionResult?.response
    ? `Completed run in ${executionResult.response.durationMs}ms`
    : 'In-process simulated workflow run';

  return { title, description };
}

const statusBadgeVariantMap: Record<BackendTaskState, BadgeVariant> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'warning',
  RUNNING: 'cyan',
  PENDING: 'default',
};

export const ExecutionModal: React.FC<ExecutionModalProps> = ({
  isOpen,
  onClose,
  isExecuting,
  executionResult,
  onRunExecution,
  nodes,
}) => {
  const response = executionResult?.response;

  const taskList = useMemo(
    () => computeDisplayTaskList(nodes, response),
    [nodes, response]
  );

  const { title: modalTitle, description: modalDescription } = resolveModalTitleAndDescription(
    isExecuting,
    executionResult
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      description={modalDescription}
      maxWidth="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {isExecuting ? (
              <span
                data-testid="execution-in-progress-indicator"
                className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--accent-blue)]"
              >
                <Loader2 size={12} className="animate-spin" />
                Execution in progress...
              </span>
            ) : executionResult ? (
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {executionResult.success ? 'Run completed' : 'Execution halted'}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                Ready to execute
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              data-testid="close-button"
            >
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<RotateCcw size={11} />}
              onClick={onRunExecution}
              disabled={isExecuting}
              isLoading={isExecuting}
              data-testid="rerun-button"
            >
              {isExecuting ? 'Running...' : executionResult ? 'Re-run' : 'Execute Run'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3.5 text-xs" data-testid="execution-modal">
        {/* Simulation Disclaimer Banner */}
        <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2.5 flex items-start gap-2">
          <Info size={14} className="text-[var(--accent-blue)] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-[var(--text-primary)] text-[11px] block">
              Simulated Execution Environment
            </span>
            <span className="text-[10px] text-[var(--text-secondary)] block">
              Tasks are executed in-process on the FlowForge backend engine with safe simulation actions (NO_OP, DELAY, FAIL, FAIL_UNTIL_ATTEMPT). No external HTTP services, shell commands, or databases are contacted.
            </span>
          </div>
        </div>

        {/* Loading State */}
        {isExecuting && (
          <div
            data-testid="execution-loading"
            className="py-8 flex flex-col items-center justify-center text-center space-y-2.5 border border-dashed border-[var(--border-default)] rounded-[5px] bg-[var(--bg-subsurface)]"
          >
            <Loader2 size={24} className="animate-spin text-[var(--accent-blue)]" />
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Executing Simulated Workflow...
              </span>
              <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                Submitting graph to POST /api/v1/workflows/execute
              </span>
            </div>
          </div>
        )}

        {/* Preflight Validation Errors (blocked locally before API call) */}
        {!isExecuting &&
          executionResult?.preflightErrors &&
          executionResult.preflightErrors.length > 0 && (
            <div
              data-testid="preflight-errors"
              className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-3 space-y-2 text-[var(--status-red-text)]"
            >
              <div className="flex items-center gap-2 font-semibold text-xs">
                <AlertCircle size={14} className="shrink-0" />
                <span>
                  Preflight Validation Blocked ({executionResult.preflightErrors.length}{' '}
                  {executionResult.preflightErrors.length === 1 ? 'issue' : 'issues'})
                </span>
              </div>
              <p className="text-[11px] opacity-90">
                Execution was blocked locally prior to sending an API request. No request was sent to the backend. Please correct the following errors:
              </p>
              <ul className="space-y-1 pl-4 list-disc text-[10px] font-mono">
                {executionResult.preflightErrors.map((err, idx) => (
                  <li key={idx}>
                    <strong className="font-semibold">{err.field}:</strong> {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

        {/* HTTP 504: Gateway Timeout (Outcome Unknown) */}
        {!isExecuting && executionResult?.error?.isTimeout && (
          <div
            data-testid="timeout-warning"
            className="rounded-[5px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-3 space-y-2 text-[var(--status-yellow-text)]"
          >
            <div className="flex items-center gap-2 font-semibold text-xs">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Execution Outcome Unknown (Gateway Timeout 504)</span>
            </div>
            <p className="text-[11px]">
              The client request timed out while waiting for the FlowForge backend to finish executing tasks. Server-side simulated tasks may still be active in the background. The final execution status cannot be determined.
            </p>
            <div className="text-[10px] font-mono bg-black/10 dark:bg-black/20 p-2 rounded border border-[var(--status-yellow-border)]">
              <strong>Strict Safety Guard:</strong> Do NOT automatically retry this workflow. Automatic retries could trigger unintended duplicate task execution. Check server logs or inspect running tasks before resubmitting.
            </div>
          </div>
        )}

        {/* HTTP 429: Capacity Exhausted */}
        {!isExecuting && executionResult?.error?.isCapacityExhausted && (
          <div
            data-testid="capacity-warning"
            className="rounded-[5px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-3 space-y-1.5 text-[var(--status-yellow-text)]"
          >
            <div className="flex items-center gap-2 font-semibold text-xs">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Server Capacity Exhausted (HTTP 429)</span>
            </div>
            <p className="text-[11px]">
              {executionResult.error.message} The server thread pool or concurrent execution slots are currently full. Please wait for active workflows to complete before re-running.
            </p>
          </div>
        )}

        {/* HTTP 0: Network Failure / Server Offline */}
        {!isExecuting && executionResult?.error?.isNetworkFailure && (
          <div
            data-testid="network-error"
            className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-3 space-y-1.5 text-[var(--status-red-text)]"
          >
            <div className="flex items-center gap-2 font-semibold text-xs">
              <AlertCircle size={14} className="shrink-0" />
              <span>Server Offline / Network Failure</span>
            </div>
            <p className="text-[11px]">
              Unable to establish a connection to the FlowForge backend at http://localhost:8080. The server may be stopped or unreachable. No definitive backend execution status is known.
            </p>
          </div>
        )}

        {/* Other Backend Errors (HTTP 400, 500, etc.) */}
        {!isExecuting &&
          executionResult?.error &&
          !executionResult.error.isTimeout &&
          !executionResult.error.isCapacityExhausted &&
          !executionResult.error.isNetworkFailure &&
          (!executionResult.preflightErrors || executionResult.preflightErrors.length === 0) && (
            <div
              data-testid="execution-error"
              className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-3 space-y-1.5 text-[var(--status-red-text)]"
            >
              <div className="flex items-center gap-2 font-semibold text-xs">
                <AlertCircle size={14} className="shrink-0" />
                <span>
                  {executionResult.error.status === 400
                    ? 'Workflow Rejected by Backend (HTTP 400)'
                    : `Execution Error (HTTP ${executionResult.error.status})`}
                </span>
              </div>
              <p className="text-[11px]">{executionResult.error.message}</p>
              {executionResult.error.details.length > 0 && (
                <ul className="pl-4 list-disc text-[10px] font-mono space-y-0.5">
                  {executionResult.error.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

        {/* Successful or Definitive Execution Response Results */}
        {!isExecuting && response && (
          <div data-testid="execution-results" className="space-y-3">
            {/* Run Overview Header */}
            <div className="flex items-center justify-between p-2.5 rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)]">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    response.state === 'COMPLETED'
                      ? 'success'
                      : response.state === 'FAILED'
                      ? 'danger'
                      : 'default'
                  }
                  size="md"
                  dot
                >
                  Workflow {response.state}
                </Badge>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  Duration: <strong className="text-[var(--text-primary)]">{response.durationMs}ms</strong>
                </span>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {taskList.length} {taskList.length === 1 ? 'task' : 'tasks'} reported
              </span>
            </div>

            {/* Per-Task Breakdown */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                Task Execution Details
              </span>
              <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] divide-y divide-[var(--border-default)] overflow-hidden">
                {taskList.map((task) => (
                  <div
                    key={task.id}
                    data-testid={`task-result-${task.id}`}
                    className="p-2.5 space-y-1 hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          {task.label}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                          ({task.id})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                          {task.durationMs !== null ? `${task.durationMs}ms` : '—'}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {task.attemptCount} {task.attemptCount === 1 ? 'attempt' : 'attempts'}
                        </span>
                        <Badge
                          variant={statusBadgeVariantMap[task.state] ?? 'default'}
                          size="sm"
                        >
                          {task.state}
                        </Badge>
                      </div>
                    </div>

                    {/* Task Error Message */}
                    {task.errorMessage && (
                      <div className="text-[10px] font-mono text-[var(--status-red-text)] bg-[var(--status-red-bg)] px-2 py-1 rounded border border-[var(--status-red-border)]">
                        Error: {task.errorMessage}
                      </div>
                    )}

                    {/* Retry Attempt History */}
                    {task.attemptErrors && task.attemptErrors.length > 0 && (
                      <div className="text-[9px] font-mono text-[var(--text-muted)] pl-1">
                        Attempt history: {task.attemptErrors.join(' → ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
