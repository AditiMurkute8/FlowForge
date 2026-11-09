import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  WorkflowRunResponseDto,
  TaskRunResponseDto,
  WorkflowRunState,
  TaskRunStatus,
} from '../../types';
import { getWorkflowRun as defaultGetWorkflowRun, FlowForgeApiError } from '../../api/flowForgeApi';
import { Modal } from '../ui/Modal';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatDuration } from './RunHistoryModal';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';

export function getRunStatusBadgeVariant(status: WorkflowRunState | TaskRunStatus): BadgeVariant {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'RUNNING':
      return 'cyan';
    case 'CANCELLED':
      return 'warning';
    case 'PENDING':
    default:
      return 'default';
  }
}

export function isTerminalStatus(status: WorkflowRunState | string): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

export interface RunDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  runId: string | null;
  workflowId?: string;
  workflowName?: string;
  initialRun?: WorkflowRunResponseDto | null;
  getRunFn?: typeof defaultGetWorkflowRun;
  pollIntervalMs?: number;
  onRunUpdated?: (run: WorkflowRunResponseDto) => void;
  onViewHistory?: () => void;
}

export const RunDashboardModal: React.FC<RunDashboardModalProps> = ({
  isOpen,
  onClose,
  runId,
  workflowName,
  initialRun = null,
  getRunFn = defaultGetWorkflowRun,
  pollIntervalMs = 1000,
  onRunUpdated,
  onViewHistory,
}) => {
  const [currentRun, setCurrentRun] = useState<WorkflowRunResponseDto | null>(initialRun);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRunIdRef = useRef<string | null>(runId);

  // Keep active run id reference updated
  useEffect(() => {
    activeRunIdRef.current = runId;
  }, [runId]);

  // Synchronize initialRun prop if provided
  useEffect(() => {
    if (initialRun) {
      setCurrentRun(initialRun);
    }
  }, [initialRun]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (isMountedRef.current) {
      setIsPolling(false);
    }
  }, []);

  const fetchRunDetails = useCallback(
    async (id: string, isBackgroundPoll = false) => {
      if (!isBackgroundPoll && isMountedRef.current) {
        setIsLoading(true);
      }
      try {
        const runData = await getRunFn(id);
        if (!isMountedRef.current || activeRunIdRef.current !== id) {
          return null;
        }

        setCurrentRun(runData);
        setPollError(null);

        if (onRunUpdated) {
          onRunUpdated(runData);
        }

        // Check if run reached terminal state
        if (isTerminalStatus(runData.status)) {
          stopPolling();
        }

        return runData;
      } catch (err) {
        if (!isMountedRef.current) return null;

        let errorMsg = 'Failed to fetch workflow run details.';
        if (err instanceof FlowForgeApiError) {
          errorMsg = err.message;
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }

        setPollError(errorMsg);
        return null;
      } finally {
        if (!isBackgroundPoll && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [getRunFn, onRunUpdated, stopPolling]
  );

  // Setup initial load and polling loop
  useEffect(() => {
    isMountedRef.current = true;

    if (!isOpen || !runId) {
      stopPolling();
      return;
    }

    // Execute immediate fetch
    void (async () => {
      const data = await fetchRunDetails(runId, false);
      if (!isMountedRef.current) return;

      // If run is still active (RUNNING or PENDING), begin polling
      const status = data?.status || initialRun?.status || 'RUNNING';
      if (!isTerminalStatus(status)) {
        stopPolling(); // Ensure no duplicate timer
        setIsPolling(true);

        pollTimerRef.current = setInterval(() => {
          if (!isMountedRef.current || !activeRunIdRef.current) {
            stopPolling();
            return;
          }
          void fetchRunDetails(activeRunIdRef.current, true);
        }, pollIntervalMs);
      }
    })();

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [isOpen, runId, fetchRunDetails, initialRun?.status, pollIntervalMs, stopPolling]);

  if (!isOpen) return null;

  const runStatus = currentRun?.status ?? 'RUNNING';
  const isRunning = runStatus === 'RUNNING';
  const isCompleted = runStatus === 'COMPLETED';
  const isFailed = runStatus === 'FAILED';

  const tasks: TaskRunResponseDto[] = currentRun?.tasks || [];
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;
  const runningCount = tasks.filter((t) => t.status === 'RUNNING').length;
  const failedCount = tasks.filter((t) => t.status === 'FAILED').length;
  const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Durable Run Execution Dashboard"
      description={
        workflowName
          ? `Live execution telemetry for "${workflowName}"`
          : 'Durable execution state recorded in PostgreSQL store'
      }
      maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            {isPolling && (
              <span
                data-testid="live-polling-indicator"
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--accent-blue)]"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-blue)] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent-blue)]"></span>
                </span>
                Live Polling (1s)
              </span>
            )}
            {!isPolling && isTerminalStatus(runStatus) && (
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                Execution Complete • Polling Stopped
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onViewHistory && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onViewHistory();
                }}
                data-testid="view-history-button"
              >
                Run History
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={onClose} data-testid="close-dashboard-button">
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs" data-testid="run-dashboard-modal">
        {/* Run Overview Header Card */}
        <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Workflow Run
                </span>
                {runId && (
                  <span className="font-mono text-[11px] text-[var(--text-muted)]" data-testid="dashboard-run-id">
                    ({runId})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] font-mono">
                {currentRun?.versionNumber && (
                  <span>Version: v{currentRun.versionNumber}</span>
                )}
                {currentRun?.triggeredBy && (
                  <>
                    <span>•</span>
                    <span>Trigger: {currentRun.triggeredBy}</span>
                  </>
                )}
                {currentRun?.durationMs !== null && currentRun?.durationMs !== undefined && (
                  <>
                    <span>•</span>
                    <span>Duration: {formatDuration(currentRun.durationMs)}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={getRunStatusBadgeVariant(runStatus)}
                size="md"
                dot
                data-testid="workflow-run-status-badge"
              >
                {runStatus}
              </Badge>
              {runId && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />}
                  onClick={() => void fetchRunDetails(runId, false)}
                  disabled={isLoading}
                  data-testid="dashboard-manual-refresh"
                  title="Refresh status manually"
                />
              )}
            </div>
          </div>

          {/* Operational Progress Summary */}
          <div className="grid grid-cols-4 gap-2 pt-1 border-t border-[var(--border-default)]">
            <div className="rounded-[4px] bg-[var(--bg-surface)] p-2 text-center border border-[var(--border-default)]/60">
              <div className="text-[10px] text-[var(--text-muted)] uppercase font-mono">Pending</div>
              <div className="text-sm font-bold font-mono text-[var(--text-secondary)]" data-testid="stat-pending">
                {pendingCount}
              </div>
            </div>
            <div className="rounded-[4px] bg-[var(--bg-surface)] p-2 text-center border border-[var(--border-default)]/60">
              <div className="text-[10px] text-[var(--text-muted)] uppercase font-mono">Running</div>
              <div className="text-sm font-bold font-mono text-[var(--status-cyan-text,#0284c7)]" data-testid="stat-running">
                {runningCount}
              </div>
            </div>
            <div className="rounded-[4px] bg-[var(--bg-surface)] p-2 text-center border border-[var(--border-default)]/60">
              <div className="text-[10px] text-[var(--text-muted)] uppercase font-mono">Completed</div>
              <div className="text-sm font-bold font-mono text-[var(--status-green-text)]" data-testid="stat-completed">
                {completedCount}
              </div>
            </div>
            <div className="rounded-[4px] bg-[var(--bg-surface)] p-2 text-center border border-[var(--border-default)]/60">
              <div className="text-[10px] text-[var(--text-muted)] uppercase font-mono">Failed</div>
              <div className="text-sm font-bold font-mono text-[var(--status-red-text)]" data-testid="stat-failed">
                {failedCount}
              </div>
            </div>
          </div>
        </div>

        {/* Live Status Notification Banner */}
        {isRunning && (
          <div
            data-testid="dashboard-running-banner"
            className="rounded-[5px] border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 p-3 text-xs text-[var(--text-primary)] flex items-center gap-2.5 shadow-xs"
          >
            <Loader2 size={16} className="animate-spin text-[var(--accent-blue)] shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold block text-[11px]">Workflow Execution in Progress</span>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Tasks are being dispatched according to DAG dependency constraints. Observing live state updates.
              </p>
            </div>
          </div>
        )}

        {isCompleted && (
          <div
            data-testid="dashboard-completed-banner"
            className="rounded-[5px] border border-[var(--status-green-border)] bg-[var(--status-green-bg)] p-3 text-xs text-[var(--status-green-text)] flex items-center gap-2.5 shadow-xs"
          >
            <CheckCircle2 size={16} className="shrink-0" />
            <div>
              <span className="font-semibold block text-[11px]">Execution Succeeded</span>
              <p className="text-[11px] opacity-90">
                All workflow tasks concluded successfully. Telemetry committed to PostgreSQL.
              </p>
            </div>
          </div>
        )}

        {isFailed && (
          <div
            data-testid="dashboard-failed-banner"
            className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-3 text-xs text-[var(--status-red-text)] flex items-center gap-2.5 shadow-xs"
          >
            <XCircle size={16} className="shrink-0" />
            <div>
              <span className="font-semibold block text-[11px]">Execution Failed</span>
              <p className="text-[11px] opacity-90">
                One or more tasks encountered terminal failures or retry exhaustion.
              </p>
            </div>
          </div>
        )}

        {/* Polling Error Banner (Non-fatal, shows warning while preserving UI) */}
        {pollError && (
          <div
            data-testid="dashboard-poll-error"
            className="rounded-[5px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-2.5 text-xs text-[var(--status-yellow-text)] flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="truncate">Polling notice: {pollError}</span>
            </div>
            <span className="text-[10px] font-mono shrink-0">Retrying next tick...</span>
          </div>
        )}

        {/* Task Execution Breakdown Table */}
        <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2 bg-[var(--bg-subsurface)]">
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-[var(--text-secondary)]" />
              <span className="font-semibold text-[11px] text-[var(--text-primary)]">
                Task Execution Pipeline
              </span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} registered
            </span>
          </div>

          {tasks.length > 0 ? (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-default)] bg-[var(--bg-surface)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                    <th className="py-2 px-3">Task ID</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Attempts</th>
                    <th className="py-2 px-3">Duration</th>
                    <th className="py-2 px-3">Error / Diagnostics</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const isTaskRunning = task.status === 'RUNNING';
                    const isTaskFailed = task.status === 'FAILED';
                    const isTaskPending = task.status === 'PENDING';

                    return (
                      <tr
                        key={task.id || task.taskId}
                        data-testid={`task-row-${task.taskId}`}
                        className={`border-b border-[var(--border-default)]/40 transition-colors ${
                          isTaskRunning
                            ? 'bg-[var(--accent-blue)]/5'
                            : isTaskFailed
                            ? 'bg-[var(--status-red-bg)]/30'
                            : 'hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono font-medium text-[11px] whitespace-nowrap text-[var(--text-primary)]">
                          <div className="flex items-center gap-1.5">
                            {isTaskRunning && (
                              <Loader2 size={11} className="animate-spin text-[var(--accent-blue)]" />
                            )}
                            {task.taskId}
                          </div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <Badge
                            variant={getRunStatusBadgeVariant(task.status)}
                            size="sm"
                            dot
                            data-testid={`task-status-${task.taskId}`}
                          >
                            {task.status}
                          </Badge>
                        </td>
                        <td
                          className="py-2 px-3 font-mono text-[11px] whitespace-nowrap text-[var(--text-secondary)]"
                          data-testid={`task-attempts-${task.taskId}`}
                        >
                          <span
                            className={
                              task.attemptCount && task.attemptCount > 1
                                ? 'text-[var(--status-yellow-text)] font-semibold'
                                : ''
                            }
                          >
                            {task.attemptCount ?? 1} {task.attemptCount === 1 ? 'attempt' : 'attempts'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                          {formatDuration(task.durationMs)}
                        </td>
                        <td className="py-2 px-3 text-[11px]">
                          {task.errorMessage ? (
                            <div
                              data-testid={`task-error-${task.taskId}`}
                              className="flex items-center gap-1.5 text-[var(--status-red-text)] font-mono text-[10px] bg-[var(--status-red-bg)] border border-[var(--status-red-border)] px-1.5 py-0.5 rounded-[3px] max-w-xs truncate"
                              title={task.errorMessage}
                            >
                              <AlertCircle size={10} className="shrink-0" />
                              <span className="truncate">{task.errorMessage}</span>
                            </div>
                          ) : isTaskPending ? (
                            <span className="text-[var(--text-muted)] font-mono text-[10px] italic">
                              Queued • Waiting for prerequisites
                            </span>
                          ) : isTaskRunning ? (
                            <span className="text-[var(--accent-blue)] font-mono text-[10px] italic">
                              Executing action...
                            </span>
                          ) : (
                            <span className="text-[var(--text-muted)] font-mono text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 text-center text-[11px] text-[var(--text-muted)] font-mono">
              {isLoading ? 'Loading task records...' : 'Initializing task pipeline...'}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
