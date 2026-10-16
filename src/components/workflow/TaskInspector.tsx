import React, { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { TaskNodeData } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Trash2, X, Sliders, ArrowRight } from 'lucide-react';

interface TaskInspectorProps {
  selectedNode: Node<TaskNodeData> | null;
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  onUpdateNode: (nodeId: string, updatedData: Partial<TaskNodeData>) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

export const TaskInspector: React.FC<TaskInspectorProps> = ({
  selectedNode,
  nodes,
  edges,
  onUpdateNode,
  onDeleteNode,
  onClose,
}) => {
  const [label, setLabel] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [parametersJson, setParametersJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setLabel(selectedNode.data.label);
      setTimeoutMs(selectedNode.data.timeoutMs ?? 30000);
      setMaxRetries(selectedNode.data.maxRetries ?? 3);
      setParametersJson(
        JSON.stringify(selectedNode.data.parameters ?? {}, null, 2)
      );
      setJsonError(null);
    }
  }, [selectedNode]);

  if (!selectedNode) {
    return (
      <aside className="w-64 border-l border-[var(--border-default)] bg-[var(--bg-surface)] p-4 flex flex-col items-center justify-center text-center text-[var(--text-muted)] select-none">
        <Sliders size={20} className="mb-2 text-[var(--text-muted)]" />
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          No Task Selected
        </span>
        <span className="text-[11px] mt-1 max-w-[180px] text-[var(--text-muted)]">
          Click any task node to configure parameters.
        </span>
      </aside>
    );
  }

  const handleSaveParameters = (jsonStr: string) => {
    setParametersJson(jsonStr);
    try {
      const parsed = JSON.parse(jsonStr);
      setJsonError(null);
      onUpdateNode(selectedNode.id, { parameters: parsed });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setJsonError(message);
    }
  };

  const upstreamEdges = edges.filter((e) => e.target === selectedNode.id);
  const downstreamEdges = edges.filter((e) => e.source === selectedNode.id);

  const upstreamNodes = upstreamEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter(Boolean) as Node<TaskNodeData>[];

  const downstreamNodes = downstreamEdges
    .map((e) => nodes.find((n) => n.id === e.target))
    .filter(Boolean) as Node<TaskNodeData>[];

  return (
    <aside className="w-64 border-l border-[var(--border-default)] bg-[var(--bg-surface)] flex flex-col shrink-0 select-none overflow-y-auto">
      {/* Inspector Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2.5 bg-[var(--bg-subsurface)]">
        <div className="min-w-0 pr-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
            Task Inspector
          </span>
          <h3 className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {selectedNode.data.label}
          </h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>

      {/* Form Fields */}
      <div className="p-3 space-y-3.5 flex-1">
        {/* Node ID */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--text-secondary)]">Node ID:</span>
          <span className="font-mono text-[var(--text-primary)] bg-[var(--bg-subsurface)] px-1.5 py-0.5 rounded border border-[var(--border-default)]">
            {selectedNode.id}
          </span>
        </div>

        {/* Display Name */}
        <Input
          label="Display Name"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            onUpdateNode(selectedNode.id, { label: e.target.value });
          }}
        />

        {/* Timeout & Retries */}
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Timeout (ms)"
            type="number"
            step="1000"
            value={timeoutMs}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10) || 1000;
              setTimeoutMs(val);
              onUpdateNode(selectedNode.id, { timeoutMs: val });
            }}
          />
          <Input
            label="Max Retries"
            type="number"
            min="0"
            max="10"
            value={maxRetries}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10) || 0;
              setMaxRetries(val);
              onUpdateNode(selectedNode.id, { maxRetries: val });
            }}
          />
        </div>

        {/* JSON Parameters */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[var(--text-secondary)] block">
            Parameters (JSON)
          </label>
          <textarea
            rows={4}
            value={parametersJson}
            onChange={(e) => handleSaveParameters(e.target.value)}
            className={`w-full rounded-[5px] border bg-[var(--bg-subsurface)] p-2 text-[11px] font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 transition-colors ${
              jsonError
                ? 'border-[var(--status-red-text)] focus:ring-[var(--status-red-text)]'
                : 'border-[var(--border-default)] focus:border-[var(--accent-blue)] focus:ring-[var(--accent-blue)]'
            }`}
          />
          {jsonError && (
            <span className="text-[10px] text-[var(--status-red-text)] block">{jsonError}</span>
          )}
        </div>

        {/* Prerequisites and Dependents */}
        <div className="space-y-2.5 border-t border-[var(--border-default)] pt-2.5 text-[11px]">
          <span className="font-mono uppercase tracking-wider text-[10px] text-[var(--text-muted)] block">
            Prerequisites ({upstreamNodes.length})
          </span>
          {upstreamNodes.length === 0 ? (
            <span className="text-[10px] text-[var(--text-muted)] italic block">
              None (Root Task)
            </span>
          ) : (
            <ul className="space-y-1">
              {upstreamNodes.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--text-primary)] bg-[var(--bg-subsurface)] px-2 py-1 rounded-[4px] border border-[var(--border-default)]"
                >
                  <ArrowRight size={10} className="text-[var(--accent-blue)] shrink-0" />
                  <span className="truncate">{n.data.label}</span>
                </li>
              ))}
            </ul>
          )}

          <span className="font-mono uppercase tracking-wider text-[10px] text-[var(--text-muted)] block pt-1">
            Dependents ({downstreamNodes.length})
          </span>
          {downstreamNodes.length === 0 ? (
            <span className="text-[10px] text-[var(--text-muted)] italic block">
              None (Terminal Task)
            </span>
          ) : (
            <ul className="space-y-1">
              {downstreamNodes.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--text-primary)] bg-[var(--bg-subsurface)] px-2 py-1 rounded-[4px] border border-[var(--border-default)]"
                >
                  <ArrowRight size={10} className="text-[var(--status-green-text)] shrink-0" />
                  <span className="truncate">{n.data.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Delete Task */}
      <div className="border-t border-[var(--border-default)] p-2.5 bg-[var(--bg-subsurface)]">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          icon={<Trash2 size={12} />}
          onClick={() => onDeleteNode(selectedNode.id)}
        >
          Delete Task
        </Button>
      </div>
    </aside>
  );
};
