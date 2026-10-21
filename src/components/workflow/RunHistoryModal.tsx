import React, { useState, useEffect, useCallback } from 'react';
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

  const loadRunDetail = useCallback(
    async (runId: string) => {
      setIsLoadingDetail(true);
      setDetailError(null);
      try {
        const detail = await getRunFn(runId);
        setSelectedRunDetail(detail);
      } catch (err) {
        let msg = 'Failed to load task details for run.';
        if (err instanceof FlowForgeApiError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setDetailError(msg);
      } finally {
        setIsLoadingDetail(false);
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
        const content = pageRes.content || [];
        setRuns(content);
        setTotalPages(pageRes.totalPages || 0);
        setTotalElements(pageRes.totalElements || 0);
        setCurrentPage(pageToLoad);

        if (content.length > 0) {
          // If current selection is still in the new page, keep it, else auto-select first item
          const stillSelected = selectedRunId && content.some((r) => r.id === selectedRunId);
          const nextSelectedId = stillSelected ? (selectedRunId as string) : content[0].id;
          setSelectedRunId(nextSelectedId);
          void loadRunDetail(nextSelectedId);
        } else {
          setSelectedRunId(null);
          setSelectedRunDetail(null);
        }
      } catch (err) {
        let msg = 'Failed to load execution runs.';
        if (err instanceof FlowForgeApiError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setRunsError(msg);
      } finally {
        setIsLoadingRuns(false);
      }
    },
    [workflowId, isMockWorkflow, fetchRunsFn, selectedRunId, loadRunDetail]
  );

  useEffect(() => {
    if (isOpen) {
      void loadRuns(0);
    }
  }, [isOpen, workflowId, isMockWorkflow, refreshTrigger]);

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Durable Execution History"
      description={
        workflowName
          ? `Persisted execution runs for "${workflowName}"`
          : 'Durable execution runs recorded in PostgreSQL store'
      }
      maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            {isMockWorkflow
              ? 'Preview mode (no database persistence)'
              : `${totalElements} ${totalElements === 1 ? 'run' : 'runs'} recorded`}
          </span>
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
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw size={11} className={isLoadingRuns ? 'animate-spin' : ''} />}
                  onClick={() => void loadRuns(currentPage)}
                  disabled={isLoadingRuns}
                  data-testid="run-history-refresh-button"
                >
                  Refresh
                </Button>
              </div>

              {/* Runs Table */}
              <div className="overflow-x-auto max-h-52 overflow-y-auto">
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
                                {task.attemptCount} {task.attemptCount === 1 ? 'attempt' : 'attempts'}
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
                                  <span className="text-[var(--text-muted)] font-mono text-[10px]">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--text-muted)] py-3 text-center italic">
                      No task execution records recorded for this workflow run.
                    </p>
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
