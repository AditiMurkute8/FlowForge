import React, { useState, useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { TaskNodeData } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Trash2, X, Sliders, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import {
  MAX_RETRIES_LIMIT,
  MAX_SIMULATION_DELAY_MS,
  MAX_RETRY_INITIAL_DELAY_MS,
  MAX_ERROR_MESSAGE_LENGTH,
  extractSimulationConfig,
  extractRetryConfig,
  validateStrictInteger,
} from '../../utils/workflowExecutionAdapters';

interface TaskInspectorProps {
  selectedNode: Node<TaskNodeData> | null;
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  onUpdateNode: (nodeId: string, updatedData: Partial<TaskNodeData>) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

type SimulationActionOption = 'DEFAULT' | 'NO_OP' | 'DELAY' | 'FAIL' | 'FAIL_UNTIL_ATTEMPT' | 'CUSTOM';

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
  const [maxRetries, setMaxRetries] = useState<number | string>(3);
  const [simAction, setSimAction] = useState<SimulationActionOption>('DEFAULT');
  const [simDelayMs, setSimDelayMs] = useState<number | string>(500);
  const [simFailUntil, setSimFailUntil] = useState<number | string>(2);
  const [simErrorMessage, setSimErrorMessage] = useState('');
  const [retryInitialDelayMs, setRetryInitialDelayMs] = useState<number | string>(50);
  const [parametersJson, setParametersJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const prevNodeIdRef = useRef<string | null>(null);

  // Sync state when selected node changes
  useEffect(() => {
    if (!selectedNode) {
      prevNodeIdRef.current = null;
      return;
    }

    const isNewNode = prevNodeIdRef.current !== selectedNode.id;
    prevNodeIdRef.current = selectedNode.id;

    if (isNewNode) {
      setLabel(selectedNode.data.label);
      setTimeoutMs(selectedNode.data.timeoutMs ?? 30000);
      setMaxRetries(selectedNode.data.maxRetries ?? 0);

      const params = selectedNode.data.parameters ?? {};
      setParametersJson(JSON.stringify(params, null, 2));
      setJsonError(null);

      const simConfig = extractSimulationConfig(params);
      const retryConfig = extractRetryConfig(params);

      if (simConfig.hasExplicitOverride) {
        if (simConfig.isMalformed || !simConfig.action) {
          setSimAction('CUSTOM');
        } else {
          setSimAction(simConfig.action);
          if (simConfig.rawDelay !== undefined) {
            setSimDelayMs(typeof simConfig.rawDelay === 'number' ? simConfig.rawDelay : String(simConfig.rawDelay));
          } else {
            setSimDelayMs(500);
          }
          if (simConfig.rawFailUntil !== undefined) {
            setSimFailUntil(typeof simConfig.rawFailUntil === 'number' ? simConfig.rawFailUntil : String(simConfig.rawFailUntil));
          } else {
            setSimFailUntil(2);
          }
          setSimErrorMessage(simConfig.errorMessage ?? '');
        }
      } else {
        setSimAction('DEFAULT');
        const defaultDelay = params.delayMs ?? params.delay;
        setSimDelayMs(defaultDelay !== undefined && typeof defaultDelay === 'number' ? defaultDelay : 500);
        setSimFailUntil(2);
        setSimErrorMessage('');
      }

      if (retryConfig.rawInitialDelayMs !== undefined) {
        setRetryInitialDelayMs(
          typeof retryConfig.rawInitialDelayMs === 'number'
            ? retryConfig.rawInitialDelayMs
            : String(retryConfig.rawInitialDelayMs)
        );
      } else {
        setRetryInitialDelayMs(50);
      }
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

  // Current simulation and retry configurations for validation display
  const currentParams = selectedNode.data.parameters ?? {};
  const currentSimConfig = extractSimulationConfig(currentParams);

  // Retries validation
  const retriesRes = validateStrictInteger(maxRetries, 'maxRetries');
  let retriesError: string | undefined;
  if (!retriesRes.isValid) {
    retriesError = retriesRes.errorReason;
  } else if (retriesRes.isProvided && retriesRes.value !== undefined) {
    if (retriesRes.value < 0) {
      retriesError = 'Retries cannot be negative.';
    } else if (retriesRes.value > MAX_RETRIES_LIMIT) {
      retriesError = `Max ${MAX_RETRIES_LIMIT} retries allowed (${MAX_RETRIES_LIMIT + 1} total attempts). Execution will be blocked.`;
    }
  }

  // Simulation delay validation
  let delayError: string | undefined;
  if (simAction === 'DELAY') {
    const delayRes = validateStrictInteger(simDelayMs, 'simulation delayMs');
    if (!delayRes.isValid) {
      delayError = delayRes.errorReason;
    } else if (delayRes.value !== undefined && (delayRes.value < 0 || delayRes.value > MAX_SIMULATION_DELAY_MS)) {
      delayError = `Must be between 0 and ${MAX_SIMULATION_DELAY_MS} ms.`;
    }
  }

  // Fail-until threshold validation
  let threshError: string | undefined;
  if (simAction === 'FAIL_UNTIL_ATTEMPT') {
    const threshRes = validateStrictInteger(simFailUntil, 'failUntilAttempt');
    if (!threshRes.isValid) {
      threshError = threshRes.errorReason;
    } else if (threshRes.value !== undefined && (threshRes.value < 1 || threshRes.value > 5)) {
      threshError = 'Must be between 1 and 5 attempts.';
    }
  }

  // Error message length validation
  let errorMsgError: string | undefined;
  if (simAction === 'FAIL' || simAction === 'FAIL_UNTIL_ATTEMPT') {
    if (simErrorMessage && simErrorMessage.length > MAX_ERROR_MESSAGE_LENGTH) {
      errorMsgError = `Exceeds ${MAX_ERROR_MESSAGE_LENGTH} characters (${simErrorMessage.length} chars).`;
    }
  }

  // Retry delay validation
  let retryDelayError: string | undefined;
  const numRetries = typeof maxRetries === 'number' ? maxRetries : parseInt(String(maxRetries), 10);
  if (numRetries > 0) {
    const retryRes = validateStrictInteger(retryInitialDelayMs, 'retry initial delay');
    if (!retryRes.isValid) {
      retryDelayError = retryRes.errorReason;
    } else if (retryRes.value !== undefined && (retryRes.value < 0 || retryRes.value > MAX_RETRY_INITIAL_DELAY_MS)) {
      retryDelayError = `Must be between 0 and ${MAX_RETRY_INITIAL_DELAY_MS} ms.`;
    }
  }

  // Helper to commit simulation changes to node parameters
  const updateSimulationParams = (
    newAction: SimulationActionOption,
    newDelay: number | string,
    newThresh: number | string,
    newErrorMsg: string
  ) => {
    const params = { ...selectedNode.data.parameters };

    if (newAction === 'DEFAULT') {
      delete params.simulation;
      delete params.action;
      delete params.delayMs;
      delete params.delay;
      delete params.failUntilAttempt;
      delete params.threshold;
      delete params.errorMessage;
      delete params.error;
    } else if (newAction === 'NO_OP') {
      params.simulation = { action: 'NO_OP' };
      delete params.action;
    } else if (newAction === 'DELAY') {
      const parsedDelay = typeof newDelay === 'number' ? newDelay : parseInt(String(newDelay), 10);
      params.simulation = {
        action: 'DELAY',
        delayMs: Number.isNaN(parsedDelay) ? newDelay : parsedDelay,
      };
      delete params.action;
    } else if (newAction === 'FAIL') {
      params.simulation = {
        action: 'FAIL',
        errorMessage: newErrorMsg.trim() || 'Simulated task failure',
      };
      delete params.action;
    } else if (newAction === 'FAIL_UNTIL_ATTEMPT') {
      const parsedThresh = typeof newThresh === 'number' ? newThresh : parseInt(String(newThresh), 10);
      params.simulation = {
        action: 'FAIL_UNTIL_ATTEMPT',
        failUntilAttempt: Number.isNaN(parsedThresh) ? newThresh : parsedThresh,
        ...(newErrorMsg.trim() ? { errorMessage: newErrorMsg.trim() } : {}),
      };
      delete params.action;
    }

    onUpdateNode(selectedNode.id, { parameters: params });
    setParametersJson(JSON.stringify(params, null, 2));
    setJsonError(null);
  };

  const handleActionChange = (actionVal: SimulationActionOption) => {
    setSimAction(actionVal);
    if (actionVal !== 'CUSTOM') {
      updateSimulationParams(actionVal, simDelayMs, simFailUntil, simErrorMessage);
    }
  };

  const handleDelayChange = (valStr: string) => {
    const val = valStr === '' ? '' : parseInt(valStr, 10);
    const parsed = Number.isNaN(val) ? valStr : val;
    setSimDelayMs(parsed);
    if (simAction === 'DELAY') {
      updateSimulationParams('DELAY', parsed, simFailUntil, simErrorMessage);
    }
  };

  const handleFailUntilChange = (valStr: string) => {
    const val = valStr === '' ? '' : parseInt(valStr, 10);
    const parsed = Number.isNaN(val) ? valStr : val;
    setSimFailUntil(parsed);
    if (simAction === 'FAIL_UNTIL_ATTEMPT') {
      updateSimulationParams('FAIL_UNTIL_ATTEMPT', simDelayMs, parsed, simErrorMessage);
    }
  };

  const handleErrorMessageChange = (msg: string) => {
    setSimErrorMessage(msg);
    if (simAction === 'FAIL' || simAction === 'FAIL_UNTIL_ATTEMPT') {
      updateSimulationParams(simAction, simDelayMs, simFailUntil, msg);
    }
  };

  const handleRetryDelayChange = (valStr: string) => {
    const val = valStr === '' ? '' : parseInt(valStr, 10);
    const parsed = Number.isNaN(val) ? valStr : val;
    setRetryInitialDelayMs(parsed);

    const params = { ...selectedNode.data.parameters };
    if (valStr === '') {
      delete params.retryInitialDelayMs;
    } else {
      params.retryInitialDelayMs = parsed;
    }
    onUpdateNode(selectedNode.id, { parameters: params });
    setParametersJson(JSON.stringify(params, null, 2));
  };

  const handleSaveParameters = (jsonStr: string) => {
    setParametersJson(jsonStr);
    try {
      const parsed = JSON.parse(jsonStr);
      setJsonError(null);
      onUpdateNode(selectedNode.id, { parameters: parsed });

      // Reflect updated JSON into UI simulation controls
      const sim = extractSimulationConfig(parsed);
      if (sim.hasExplicitOverride) {
        if (sim.isMalformed || !sim.action) {
          setSimAction('CUSTOM');
        } else {
          setSimAction(sim.action);
          if (sim.rawDelay !== undefined) setSimDelayMs(sim.rawDelay as number);
          if (sim.rawFailUntil !== undefined) setSimFailUntil(sim.rawFailUntil as number);
          if (sim.errorMessage !== undefined) setSimErrorMessage(sim.errorMessage);
        }
      } else {
        setSimAction('DEFAULT');
      }
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
        <div className="space-y-2">
          <Input
            label="Client Timeout (ms)"
            type="number"
            step="1000"
            min="1000"
            value={timeoutMs}
            helperText="Client-side timeout metadata."
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              const nextVal = Number.isNaN(val) ? 1000 : val;
              setTimeoutMs(nextVal);
              onUpdateNode(selectedNode.id, { timeoutMs: nextVal });
            }}
          />

          <Input
            label="Max Retries (0–4)"
            type="number"
            min="0"
            max="4"
            step="1"
            value={maxRetries}
            error={retriesError}
            helperText={
              !retriesError && retriesRes.value !== undefined
                ? `${retriesRes.value} additional ${
                    retriesRes.value === 1 ? 'retry' : 'retries'
                  } (${retriesRes.value + 1} total backend attempts)`
                : undefined
            }
            onChange={(e) => {
              const valStr = e.target.value;
              const val = valStr === '' ? '' : parseInt(valStr, 10);
              const nextVal = Number.isNaN(val) ? valStr : val;
              setMaxRetries(nextVal);
              onUpdateNode(selectedNode.id, {
                maxRetries: typeof nextVal === 'number' ? nextVal : (nextVal as unknown as number),
              });
            }}
          />

          {/* Retry Initial Delay: distinct from timeoutMs and delayMs */}
          {numRetries > 0 && (
            <Input
              label="Retry Initial Delay (ms)"
              type="number"
              min="0"
              max="2000"
              step="50"
              value={retryInitialDelayMs}
              error={retryDelayError}
              helperText={!retryDelayError ? 'Fixed backoff delay before each retry attempt (0–2000 ms).' : undefined}
              onChange={(e) => handleRetryDelayChange(e.target.value)}
            />
          )}
        </div>

        {/* Simulated Execution Section */}
        <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2.5 space-y-2.5">
          <div className="flex items-start justify-between gap-1">
            <div>
              <span className="text-[11px] font-semibold text-[var(--text-primary)] block">
                Simulated Execution
              </span>
              <span className="text-[9px] text-[var(--text-muted)] block">
                In-process execution. Real actions are simulated.
              </span>
            </div>
            <Info size={12} className="text-[var(--accent-blue)] shrink-0 mt-0.5" />
          </div>

          {/* Action Selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-[var(--text-secondary)] block">
              Simulation Action
            </label>
            <select
              value={simAction}
              onChange={(e) => handleActionChange(e.target.value as SimulationActionOption)}
              className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-1.5 px-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)]"
            >
              <option value="DEFAULT">
                Default ({selectedNode.data.taskType === 'DELAY_WAIT' ? 'DELAY 500ms' : 'NO_OP'})
              </option>
              <option value="NO_OP">NO_OP (Immediate Success)</option>
              <option value="DELAY">DELAY (Simulated Pause)</option>
              <option value="FAIL">FAIL (Simulated Error)</option>
              <option value="FAIL_UNTIL_ATTEMPT">FAIL_UNTIL_ATTEMPT (Transient Failure)</option>
              {simAction === 'CUSTOM' && (
                <option value="CUSTOM" disabled>
                  (Custom / Malformed Override)
                </option>
              )}
            </select>
          </div>

          {/* Malformed Override Warning */}
          {currentSimConfig.hasExplicitOverride && currentSimConfig.isMalformed && (
            <div className="rounded border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2 text-[10px] text-[var(--status-red-text)] flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                <strong>Malformed Simulation:</strong> {currentSimConfig.malformedReason} Preflight will block execution.
              </span>
            </div>
          )}

          {/* Unsupported Action Warning */}
          {currentSimConfig.hasExplicitOverride && !currentSimConfig.isMalformed && !currentSimConfig.action && (
            <div className="rounded border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2 text-[10px] text-[var(--status-red-text)] flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                <strong>Unsupported Action:</strong> &quot;{currentSimConfig.rawActionName}&quot;. Allowed actions: NO_OP, DELAY, FAIL, FAIL_UNTIL_ATTEMPT.
              </span>
            </div>
          )}

          {/* Action-Specific Inputs */}
          {simAction === 'DELAY' && (
            <Input
              label="Simulation Delay (ms)"
              type="number"
              min="0"
              max="5000"
              step="100"
              value={simDelayMs}
              error={delayError}
              helperText={!delayError ? 'Execution pause duration (0–5000 ms).' : undefined}
              onChange={(e) => handleDelayChange(e.target.value)}
            />
          )}

          {simAction === 'FAIL' && (
            <Input
              label="Error Message (max 255 chars)"
              type="text"
              maxLength={255}
              placeholder="Simulated task failure"
              value={simErrorMessage}
              error={errorMsgError}
              helperText={`${simErrorMessage.length} / ${MAX_ERROR_MESSAGE_LENGTH} chars`}
              onChange={(e) => handleErrorMessageChange(e.target.value)}
            />
          )}

          {simAction === 'FAIL_UNTIL_ATTEMPT' && (
            <div className="space-y-2">
              <Input
                label="Fail Until Attempt (1–5)"
                type="number"
                min="1"
                max="5"
                step="1"
                value={simFailUntil}
                error={threshError}
                helperText={!threshError ? 'Fails on attempts < N, succeeds on attempt N.' : undefined}
                onChange={(e) => handleFailUntilChange(e.target.value)}
              />
              <Input
                label="Simulated Error Message"
                type="text"
                maxLength={255}
                placeholder="Simulated transient failure"
                value={simErrorMessage}
                error={errorMsgError}
                helperText={`${simErrorMessage.length} / ${MAX_ERROR_MESSAGE_LENGTH} chars`}
                onChange={(e) => handleErrorMessageChange(e.target.value)}
              />
            </div>
          )}
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
