import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TaskNodeData, TaskType } from '../../types';
import { extractSimulationConfig } from '../../utils/workflowExecutionAdapters';
import {
  Globe,
  Terminal,
  Code2,
  Database,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Ban,
} from 'lucide-react';

const taskIcons: Record<TaskType, React.ReactNode> = {
  HTTP_REQUEST: <Globe size={12} className="text-[var(--accent-blue)]" />,
  PYTHON_SCRIPT: <Terminal size={12} className="text-[var(--status-green-text)]" />,
  BASH_COMMAND: <Code2 size={12} className="text-[var(--status-yellow-text)]" />,
  SQL_QUERY: <Database size={12} className="text-[#A855F7]" />,
  LLM_PROMPT: <Sparkles size={12} className="text-[#EC4899]" />,
  DELAY_WAIT: <Clock size={12} className="text-[var(--text-muted)]" />,
};

interface CustomTaskNodeProps extends NodeProps {
  data: TaskNodeData;
}

export const CustomTaskNode: React.FC<CustomTaskNodeProps> = ({
  data,
  selected,
}) => {
  const nodeData = data || ({} as Partial<TaskNodeData>);
  const isCycleNode = (nodeData as Record<string, unknown>).isCycle === true;

  const simConfig = extractSimulationConfig(nodeData.parameters);
  const resolvedAction = simConfig.hasExplicitOverride
    ? simConfig.action ?? (simConfig.isMalformed ? 'MALFORMED' : simConfig.rawActionName ?? 'UNKNOWN')
    : nodeData.taskType === 'DELAY_WAIT'
    ? 'DELAY'
    : 'NO_OP';

  const isMalformedSim =
    simConfig.hasExplicitOverride && (simConfig.isMalformed || !simConfig.action);

  const isInvalidRetries =
    typeof nodeData.maxRetries === 'number' &&
    (nodeData.maxRetries < 0 || nodeData.maxRetries > 4 || !Number.isInteger(nodeData.maxRetries));

  const rawDelay =
    simConfig.hasExplicitOverride && simConfig.rawDelay !== undefined
      ? simConfig.rawDelay
      : nodeData.parameters?.delayMs ?? nodeData.parameters?.delay;

  const taskTypeString = typeof nodeData.taskType === 'string' && nodeData.taskType.trim() ? nodeData.taskType : 'TASK';
  const taskIcon =
    (nodeData.taskType && taskIcons[nodeData.taskType as TaskType]) || (
      <Code2 size={12} className="text-[var(--text-muted)]" />
    );

  const displayTimeout =
    typeof nodeData.timeoutMs === 'number' && !isNaN(nodeData.timeoutMs)
      ? `${nodeData.timeoutMs / 1000}s`
      : '30s';

  const displayRetries =
    typeof nodeData.maxRetries === 'number' && !isNaN(nodeData.maxRetries)
      ? nodeData.maxRetries
      : 3;

  const renderStatus = () => {
    switch (nodeData.status) {
      case 'COMPLETED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--status-green-text)]">
            <CheckCircle2 size={10} />
            {nodeData.executionDurationMs ? `${nodeData.executionDurationMs}ms` : 'done'}
          </span>
        );
      case 'RUNNING':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--accent-blue)]">
            <Loader2 size={10} className="animate-spin" />
            running
          </span>
        );
      case 'FAILED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--status-red-text)]">
            <AlertCircle size={10} />
            failed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--status-yellow-text)]">
            <Ban size={10} />
            cancelled
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono text-[var(--text-muted)]">idle</span>
        );
    }
  };

  return (
    <div
      style={{ width: 210 }}
      className={`rounded-[6px] border bg-[var(--bg-surface)] text-[var(--text-primary)] transition-all select-none shadow-xs ${
        isCycleNode
          ? 'border-[var(--status-red-text)] ring-1 ring-[var(--status-red-text)]'
          : selected
          ? 'border-[var(--accent-blue)] ring-1 ring-[var(--accent-blue)]'
          : 'border-[var(--border-default)] hover:border-[var(--border-emphasis)]'
      }`}
    >
      {/* Target (Input) Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !bg-[var(--accent-blue)] !border-2 !border-[var(--bg-surface)]"
      />

      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2.5 py-1.5 rounded-t-[5px]">
        <div className="flex items-center gap-1.5">
          {taskIcon}
          <span className="text-[10px] font-mono font-medium text-[var(--text-muted)] uppercase tracking-wider">
            {taskTypeString.replace(/_/g, ' ')}
          </span>
        </div>
        {renderStatus()}
      </div>

      {/* Node Title & Metadata */}
      <div className="px-2.5 py-2">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate">
          {nodeData.label || 'Unnamed Task'}
        </h4>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
          <span>{displayTimeout} timeout</span>
          <span>•</span>
          <span className={isInvalidRetries ? 'text-[var(--status-red-text)] font-semibold' : ''}>
            {displayRetries} {displayRetries === 1 ? 'retry' : 'retries'}
            {isInvalidRetries ? ' (!)' : ''}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[9px] font-mono pt-1 border-t border-[var(--border-default)]/60">
          <span className="text-[var(--text-muted)]">sim:</span>
          {isMalformedSim ? (
            <span
              className="text-[var(--status-red-text)] font-semibold truncate max-w-[130px]"
              title={simConfig.malformedReason ?? `Unsupported action "${simConfig.rawActionName}"`}
            >
              {simConfig.rawActionName || 'MALFORMED'}
            </span>
          ) : (
            <span
              className={
                simConfig.hasExplicitOverride
                  ? 'text-[var(--accent-blue)] font-medium truncate max-w-[130px]'
                  : 'text-[var(--text-muted)] truncate max-w-[130px]'
              }
            >
              {resolvedAction}
              {resolvedAction === 'DELAY' && rawDelay !== undefined
                ? ` (${rawDelay}ms)`
                : resolvedAction === 'DELAY' && nodeData.taskType === 'DELAY_WAIT'
                ? ' (500ms)'
                : ''}
            </span>
          )}
        </div>
      </div>

      {/* Source (Output) Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !bg-[var(--accent-blue)] !border-2 !border-[var(--bg-surface)]"
      />
    </div>
  );
};
