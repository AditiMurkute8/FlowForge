import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TaskNodeData, TaskType } from '../../types';
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
  const isCycleNode = (data as Record<string, unknown>).isCycle === true;

  const renderStatus = () => {
    switch (data.status) {
      case 'COMPLETED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--status-green-text)]">
            <CheckCircle2 size={10} />
            {data.executionDurationMs ? `${data.executionDurationMs}ms` : 'done'}
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
          {taskIcons[data.taskType]}
          <span className="text-[10px] font-mono font-medium text-[var(--text-muted)] uppercase tracking-wider">
            {data.taskType.replace('_', ' ')}
          </span>
        </div>
        {renderStatus()}
      </div>

      {/* Node Title & Metadata */}
      <div className="px-2.5 py-2">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate">
          {data.label}
        </h4>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
          <span>{data.timeoutMs / 1000}s timeout</span>
          <span>•</span>
          <span>{data.maxRetries} retries</span>
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
