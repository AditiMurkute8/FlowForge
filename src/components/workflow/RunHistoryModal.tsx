import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  WorkflowRunSummaryResponseDto,
  WorkflowRunResponseDto,
  TaskRunResponseDto,
  WorkflowRunState,
  TaskRunStatus,
} from '../../types';
import {
  fetchWorkflowRuns as defaultFetchWorkflowRuns,
  getWorkflowRun as defaultGetWorkflowRun,
  FlowForgeApiError,
} from '../../api/flowForgeApi';
import { Modal } from '../ui/Modal';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import {
  History,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Clock,
  Radio,
} from 'lucide-react';

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

export function formatTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
  } catch {
    return isoString;
  }
}

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

export interface RunHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId?: string;
  workflowName?: string;
  isMockWorkflow?: boolean;
  fetchRunsFn?: typeof defaultFetchWorkflowRuns;
  getRunFn?: typeof defaultGetWorkflowRun;
  refreshTrigger?: number;
  activeRunId?: string | null;
  pollingIntervalMs?: number;
}

export const RunHistoryModal: React.FC<RunHistoryModalProps> = ({
  isOpen,
  onClose,
  workflowId,
  workflowName,
  isMockWorkflow = false,
  fetchRunsFn = defaultFetchWorkflowRuns,
  getRunFn = defaultGetWorkflowRun,
  refreshTrigger,
  activeRunId,
  pollingIntervalMs = 1500,
}) => {
  const [runs, setRuns] = useState<WorkflowRunSummaryResponseDto[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<WorkflowRunResponseDto | null>(null);

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);

  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadRunDetail = useCallback(
    async (runId: string, isSilent = false) => {
      if (!isSilent) {
        setIsLoadingDetail(true);
      }
      setDetailError(null);
      try {
        const detail = await getRunFn(runId);
        if (!isMountedRef.current) return;
        setSelectedRunDetail(detail);

        // Reconcile status in the runs table if it was updated
        setRuns((prev) =>
          prev.map((r) =>
            r.id === detail.id
              ? {
                  ...r,
                  status: detail.status,
                  durationMs: detail.durationMs,
                  startedAt: detail.startedAt,
                  completedAt: detail.completedAt,
                }
              : r
          )
        );
      } catch (err) {
        if (!isMountedRef.current) return;
        let msg = 'Failed to load task details for run.';
        if (err instanceof FlowForgeApiError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        if (!isSilent) {
          setDetailError(msg);
        }
      } finally {
        if (isMountedRef.current && !isSilent) {
          setIsLoadingDetail(false);
        }
      }
    },
    [getRunFn]
  );

  const loadRuns = useCallback(
    async (pageToLoad: number) => {
      if (!workflowId || isMockWorkflow) {
        setRuns([]);
        setSelectedRunId(null);
        setSelectedRunDetail(null);
        setIsLoadingRuns(false);
        setRunsError(null);
        return;
      }

      setIsLoadingRuns(true);
      setRunsError(null);

      try {
        const pageRes = await fetchRunsFn(workflowId, { page: pageToLoad, size: 6 });
        if (!isMountedRef.current) return;

        const content = pageRes.content || [];
        setRuns(content);
        setTotalPages(pageRes.totalPages || 0);
        setTotalElements(pageRes.totalElements || 0);
        setCurrentPage(pageToLoad);

        if (content.length > 0) {
          // If activeRunId is given, prioritize it; otherwise check current selection or first item
          const targetId = activeRunId && content.some((r) => r.id === activeRunId)
            ? activeRunId
            : selectedRunId && content.some((r) => r.id === selectedRunId)
            ? selectedRunId
            : content[0].id;

          setSelectedRunId(targetId);
          void loadRunDetail(targetId);
        } else {
          setSelectedRunId(null);
          setSelectedRunDetail(null);
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        let msg = 'Failed to load execution runs.';
        if (err instanceof FlowForgeApiError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setRunsError(msg);
      } finally {
        if (isMountedRef.current) {
          setIsLoadingRuns(false);
        }
      }
    },
    [workflowId, isMockWorkflow, fetchRunsFn, selectedRunId, activeRunId, loadRunDetail]
  );

  useEffect(() => {
    if (isOpen) {
      void loadRuns(0);
    }
  }, [isOpen, workflowId, isMockWorkflow, refreshTrigger, activeRunId]);

  // Automated live polling for in-flight execution runs
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    const isRunActive =
      isOpen &&
      selectedRunId &&
      selectedRunDetail &&
      (selectedRunDetail.status === 'RUNNING' || selectedRunDetail.status === 'PENDING');

    if (!isRunActive) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);

    const poll = async () => {
      try {
        const updated = await getRunFn(selectedRunId!);
        if (isCancelled || !isMountedRef.current) return;

        setSelectedRunDetail(updated);
        setRuns((prev) =>
          prev.map((r) =>
            r.id === updated.id
              ? {
                  ...r,
                  status: updated.status,
                  durationMs: updated.durationMs,
                  startedAt: updated.startedAt,
                  completedAt: updated.completedAt,
                }
              : r
          )
        );

        if (
          updated.status === 'COMPLETED' ||
          updated.status === 'FAILED' ||
          updated.status === 'CANCELLED'
        ) {
          setIsPolling(false);
        } else {
          timerId = setTimeout(() => {
            void poll();
          }, pollingIntervalMs);
        }
      } catch {
        if (!isCancelled && isMountedRef.current) {
          // Graceful soft-retry on transient network hiccup
          timerId = setTimeout(() => {
            void poll();
          }, pollingIntervalMs * 2);
        }
      }
    };

    timerId = setTimeout(() => {
      void poll();
    }, pollingIntervalMs);

    return () => {
      isCancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
      setIsPolling(false);
    };
  }, [isOpen, selectedRunId, selectedRunDetail?.status, getRunFn, pollingIntervalMs]);

  const handleSelectRun = (run: WorkflowRunSummaryResponseDto) => {
    if (selectedRunId === run.id && selectedRunDetail) return;
    setSelectedRunId(run.id);
    void loadRunDetail(run.id);
  };

  const handlePrevPage = () => {
    if (currentPage > 0 && !isLoadingRuns) {
      void loadRuns(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages - 1 && !isLoadingRuns) {
      void loadRuns(currentPage + 1);
    }
  };

  // Task count aggregation for the live Run Dashboard
  const tasks = selectedRunDetail?.tasks || [];
  const queuedCount = tasks.filter((t) => t.status === 'PENDING').length;
  const runningCount = tasks.filter((t) => t.status === 'RUNNING').length;
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;
  const failedCount = tasks.filter((t) => t.status === 'FAILED').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Durable Run Dashboard & History"
      description={
        workflowName
          ? `Live execution telemetry and persisted runs for "${workflowName}"`
          : 'Durable execution runs recorded in PostgreSQL store'
      }
      maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              {isMockWorkflow
                ? 'Preview mode (no database persistence)'
                : `${totalElements} ${totalElements === 1 ? 'run' : 'runs'} recorded`}
            </span>
            {isPolling && (
              <span
                data-testid="live-polling-indicator"
                className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 px-2 py-0.5 rounded-[4px]"
              >
                <Radio size={10} className="animate-pulse" />
                Live Polling ({pollingIntervalMs}ms)
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onClose} data-testid="close-history-modal">
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-xs" data-testid="run-history-modal">
        {/* Sample Template Disclaimer */}
        {isMockWorkflow && (
          <div
            data-testid="run-history-mock-notice"
            className="rounded-[5px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-3 text-xs text-[var(--status-yellow-text)] flex items-start gap-2.5"
          >
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold block">Sample Template Workspace</span>
              <p className="text-[11px] opacity-90">
                Sample templates run in offline preview mode without PostgreSQL persistence. Create
                or open a persistent project workspace to inspect durable execution history.
              </p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {!isMockWorkflow && isLoadingRuns && (
          <div
            data-testid="run-history-loading"
            className="py-10 flex flex-col items-center justify-center text-center space-y-2 border border-dashed border-[var(--border-default)] rounded-[6px] bg-[var(--bg-subsurface)]"
          >
            <Loader2 size={22} className="animate-spin text-[var(--accent-blue)]" />
            <span className="text-xs text-[var(--text-secondary)]">Loading execution runs...</span>
          </div>
        )}

        {/* Error State */}
        {!isMockWorkflow && !isLoadingRuns && runsError && (
          <div
            data-testid="run-history-error"
            className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-3 text-xs text-[var(--status-red-text)] flex items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={15} className="shrink-0" />
              <span className="truncate">{runsError}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRuns(currentPage)}
              data-testid="run-history-retry-button"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!isMockWorkflow && !isLoadingRuns && !runsError && runs.length === 0 && (
          <EmptyState
            data-testid="run-history-empty"
            icon={<History size={22} />}
            title="No Execution Runs Recorded"
            description="No durable execution history has been recorded for this workflow yet. Execution runs triggered on saved workflow versions will be preserved and displayed here."
          />
        )}

        {/* Active Runs Table & Detail View */}
        {!isMockWorkflow && !isLoadingRuns && !runsError && runs.length > 0 && (
          <div className="space-y-3.5">
            {/* Runs Master List Card */}
            <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2 bg-[var(--bg-subsurface)]">
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-[var(--text-secondary)]" />
                  <span className="font-semibold text-[11px] text-[var(--text-primary)]">
                    Recorded Executions
                  </span>
                  {isPolling && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-blue)] font-mono">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)] animate-ping" />
                      polling
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw size={11} className={isLoadingRuns || isPolling ? 'animate-spin' : ''} />}
                  onClick={() => {
                    void loadRuns(currentPage);
                    if (selectedRunId) void loadRunDetail(selectedRunId);
                  }}
                  disabled={isLoadingRuns}
                  data-testid="run-history-refresh-button"
                >
                  Refresh
                </Button>
              </div>

              {/* Runs Table */}
              <div className="overflow-x-auto max-h-44 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-default)] bg-[var(--bg-surface)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Version</th>
                      <th className="py-2 px-3">Duration</th>
                      <th className="py-2 px-3">Triggered By</th>
                      <th className="py-2 px-3">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const isSelected = selectedRunId === run.id;
                      return (
                        <tr
                          key={run.id}
                          onClick={() => handleSelectRun(run)}
                          data-testid={`run-row-${run.id}`}
                          className={`border-b border-[var(--border-default)]/50 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[var(--accent-blue)]/10 font-medium'
                              : 'hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          <td className="py-2 px-3 whitespace-nowrap">
                            <Badge
                              variant={getRunStatusBadgeVariant(run.status)}
                              size="sm"
                              dot
                              data-testid={`run-status-badge-${run.id}`}
                            >
                              {run.status}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">
                            v{run.versionNumber}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-secondary)]">
                            {formatDuration(run.durationMs)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-muted)]">
                            {run.triggeredBy || 'manual'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-mono text-[10px] text-[var(--text-secondary)]">
                            {formatTimestamp(run.startedAt || run.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div
                data-testid="run-history-pagination"
                className="flex items-center justify-between border-t border-[var(--border-default)] px-3 py-2 bg-[var(--bg-subsurface)] text-[11px]"
              >
                <span className="font-mono text-[var(--text-secondary)]">
                  Page {currentPage + 1} of {Math.max(1, totalPages)}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<ChevronLeft size={12} />}
                    onClick={handlePrevPage}
                    disabled={currentPage === 0 || isLoadingRuns}
                    data-testid="run-history-prev-page"
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<ChevronRight size={12} />}
                    onClick={handleNextPage}
                    disabled={currentPage >= totalPages - 1 || isLoadingRuns}
                    data-testid="run-history-next-page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>

            {/* Selected Run Details & Task Execution Breakdown */}
            <div
              data-testid="run-detail-panel"
              className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[var(--text-primary)]">
                      Run Details
                    </span>
                    {selectedRunDetail && (
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        ({selectedRunDetail.id})
                      </span>
                    )}
                  </div>
                  {selectedRunDetail && (
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-secondary)]">
                      <span>Version: v{selectedRunDetail.versionNumber}</span>
                      <span>•</span>
                      <span>Trigger: {selectedRunDetail.triggeredBy || 'manual'}</span>
                      <span>•</span>
                      <span>Duration: {formatDuration(selectedRunDetail.durationMs)}</span>
                    </div>
                  )}
                </div>

                {selectedRunDetail && (
                  <Badge variant={getRunStatusBadgeVariant(selectedRunDetail.status)} size="md" dot>
                    {selectedRunDetail.status}
                  </Badge>
                )}
              </div>

              {/* Task Details Loading */}
              {isLoadingDetail && (
                <div
                  data-testid="task-runs-loading"
                  className="py-6 flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)]"
                >
                  <Loader2 size={16} className="animate-spin text-[var(--accent-blue)]" />
                  <span>Loading task execution details...</span>
                </div>
              )}

              {/* Task Details Error */}
              {detailError && !isLoadingDetail && (
                <div
                  data-testid="task-runs-error"
                  className="rounded-[4px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2.5 text-xs text-[var(--status-red-text)] flex items-center gap-2"
                >
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{detailError}</span>
                </div>
              )}

              {/* Run Dashboard: Task Status Summary Cards */}
              {!isLoadingDetail && !detailError && selectedRunDetail && (
                <div className="grid grid-cols-5 gap-2" data-testid="run-dashboard-task-counts">
                  <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-center">
                    <span className="block text-[10px] font-mono text-[var(--text-muted)] uppercase">Status</span>
                    <Badge variant={getRunStatusBadgeVariant(selectedRunDetail.status)} size="sm" dot>
                      {selectedRunDetail.status}
                    </Badge>
                  </div>
                  <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-center">
                    <span className="block text-[10px] font-mono text-[var(--text-muted)] uppercase">Queued</span>
                    <span className="font-mono text-xs font-semibold text-[var(--text-secondary)]" data-testid="count-queued">
                      {queuedCount}
                    </span>
                  </div>
                  <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-center">
                    <span className="block text-[10px] font-mono text-[var(--text-muted)] uppercase">Running</span>
                    <span className="font-mono text-xs font-semibold text-[var(--accent-blue)]" data-testid="count-running">
                      {runningCount}
                    </span>
                  </div>
                  <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-center">
                    <span className="block text-[10px] font-mono text-[var(--text-muted)] uppercase">Completed</span>
                    <span className="font-mono text-xs font-semibold text-[var(--status-green-text)]" data-testid="count-completed">
                      {completedCount}
                    </span>
                  </div>
                  <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-center">
                    <span className="block text-[10px] font-mono text-[var(--text-muted)] uppercase">Failed</span>
                    <span className="font-mono text-xs font-semibold text-[var(--status-red-text)]" data-testid="count-failed">
                      {failedCount}
                    </span>
                  </div>
                </div>
              )}

              {/* Task Runs Table */}
              {!isLoadingDetail && !detailError && selectedRunDetail && (
                <div>
                  {selectedRunDetail.tasks && selectedRunDetail.tasks.length > 0 ? (
                    <div className="overflow-x-auto rounded-[4px] border border-[var(--border-default)]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border-default)] bg-[var(--bg-subsurface)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                            <th className="py-1.5 px-3">Task ID</th>
                            <th className="py-1.5 px-3">Status</th>
                            <th className="py-1.5 px-3">Attempts</th>
                            <th className="py-1.5 px-3">Duration</th>
                            <th className="py-1.5 px-3">Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRunDetail.tasks.map((task: TaskRunResponseDto) => (
                            <tr
                              key={task.id || task.taskId}
                              data-testid={`task-run-row-${task.taskId}`}
                              className="border-b border-[var(--border-default)]/40 hover:bg-[var(--bg-hover)] transition-colors"
                            >
                              <td className="py-2 px-3 font-mono font-medium text-[11px] whitespace-nowrap">
                                {task.taskId}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <Badge
                                  variant={getRunStatusBadgeVariant(task.status)}
                                  size="sm"
                                  dot
                                  data-testid={`task-status-badge-${task.taskId}`}
                                >
                                  {task.status}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                                <span>{task.attemptCount} {task.attemptCount === 1 ? 'attempt' : 'attempts'}</span>
                                {task.attemptCount > 1 && (
                                  <span
                                    data-testid={`task-retried-${task.taskId}`}
                                    className="ml-1.5 text-[10px] text-[var(--status-yellow-text)] font-semibold"
                                  >
                                    (Retried)
                                  </span>
                                )}
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
                                ) : (
                                  <span className="text-[var(--text-muted)] font-mono text-[11px]">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-xs text-[var(--text-muted)]">
                      No task telemetry recorded for this run.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
