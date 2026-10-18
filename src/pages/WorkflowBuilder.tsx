import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  Controls,
  MiniMap,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import { INITIAL_DAG_NODES, INITIAL_DAG_EDGES } from '../mockData';
import type { TaskNodeData, TaskType, DagValidationResult } from '../types';
import { CustomTaskNode } from '../components/workflow/CustomTaskNode';
import { TaskPalette } from '../components/workflow/TaskPalette';
import { TaskInspector } from '../components/workflow/TaskInspector';
import {
  executeWorkflowValidation,
} from '../utils/dagValidationAdapters';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import {
  ArrowLeft,
  CheckCircle2,
  Play,
  Save,
  AlertTriangle,
  AlertCircle,
  RotateCcw,
  Maximize2,
} from 'lucide-react';

interface WorkflowBuilderProps {
  onBackToProjects: () => void;
  onShowToast: (title: string, message?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  theme?: 'light' | 'dark';
}

const WorkflowBuilderContent: React.FC<WorkflowBuilderProps> = ({
  onBackToProjects,
  onShowToast,
  theme = 'dark',
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>(INITIAL_DAG_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_DAG_EDGES);
  const { fitView } = useReactFlow();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<DagValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSimulateRunModalOpen, setIsSimulateRunModalOpen] = useState(false);

  const nodeTypes = useMemo(() => ({ customTask: CustomTaskNode }), []);

  // Ensure initial DAG is centered and correctly fitted on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.25, duration: 200 });
    }, 100);
    return () => clearTimeout(timer);
  }, [fitView]);

  // Connect new edges
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
          },
          eds
        )
      );
      setValidationResult(null);
    },
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Add task from palette
  const handleAddTask = (taskType: TaskType, label: string) => {
    const newNodeId = `node-${Date.now()}`;
    const newNode: Node<TaskNodeData> = {
      id: newNodeId,
      type: 'customTask',
      position: {
        x: 220 + Math.random() * 150,
        y: 120 + Math.random() * 120,
      },
      data: {
        label,
        taskType,
        timeoutMs: 30000,
        maxRetries: 3,
        parameters: {},
        status: 'IDLE',
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    onShowToast('Task Placed', `Added "${label}" to canvas.`);
  };

  const handleUpdateNode = (nodeId: string, updatedData: Partial<TaskNodeData>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              ...updatedData,
            },
          };
        }
        return node;
      })
    );
  };

  const handleDeleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
    onShowToast('Task Removed', 'Node removed from pipeline.');
  };

  const handleResetGraph = () => {
    setNodes(INITIAL_DAG_NODES);
    setEdges(INITIAL_DAG_EDGES);
    setSelectedNodeId(null);
    setValidationResult(null);
    fitView({ padding: 0.25, duration: 200 });
    onShowToast('Pipeline Reset', 'Restored 4-node sample DAG.');
  };

  const applyValidationVisuals = useCallback(
    (result: DagValidationResult) => {
      if (result.hasCycle) {
        setEdges((eds) =>
          eds.map((edge) => ({
            ...edge,
            className: result.cycleEdges.includes(edge.id) ? 'cycle-edge' : '',
          }))
        );
        setNodes((nds) =>
          nds.map((node) => ({
            ...node,
            data: {
              ...node.data,
              isCycle: result.cycleNodes.includes(node.id),
            },
          }))
        );
      } else {
        setEdges((eds) =>
          eds.map((edge) => ({
            ...edge,
            className: '',
          }))
        );
        setNodes((nds) =>
          nds.map((node) => {
            const { isCycle: _, ...rest } = node.data as Record<string, unknown>;
            return {
              ...node,
              data: rest as TaskNodeData,
            };
          })
        );
      }
    },
    [setEdges, setNodes]
  );

  const handleValidateDag = () => {
    void executeWorkflowValidation({
      nodes,
      edges,
      isValidating,
      setIsValidating,
      setValidationResult,
      applyValidationVisuals,
      onShowToast,
    });
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-canvas)]">
      {/* Workflow Builder Control Bar */}
      <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={13} />}
            onClick={onBackToProjects}
          >
            Inventory
          </Button>

          <span className="text-[var(--border-emphasis)]">/</span>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Clickstream Ingestion & Deduplication
            </span>
            <Badge variant="cyan" size="sm">
              v1.4.0 [Draft]
            </Badge>
            <Badge variant="outline" size="sm">
              {nodes.length} nodes • {edges.length} edges
            </Badge>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Maximize2 size={11} />}
            onClick={() => fitView({ padding: 0.25, duration: 200 })}
          >
            Fit View
          </Button>

          <Button
            variant="outline"
            size="sm"
            icon={<RotateCcw size={11} />}
            onClick={handleResetGraph}
          >
            Reset
          </Button>

          <Button
            variant="outline"
            size="sm"
            icon={<CheckCircle2 size={12} />}
            onClick={handleValidateDag}
            isLoading={isValidating}
            disabled={isValidating}
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon={<Save size={12} />}
            onClick={() =>
              onShowToast('Draft Saved', 'Pipeline state cached locally.', 'success')
            }
          >
            Save Draft
          </Button>

          <Button
            variant="primary"
            size="sm"
            icon={<Play size={12} />}
            onClick={() => setIsSimulateRunModalOpen(true)}
          >
            Run (Simulated)
          </Button>
        </div>
      </div>

      {/* Validation Status Notification */}
      {validationResult && (
        <div
          className={`flex items-center gap-2 border-b px-4 py-2 text-xs font-mono ${
            validationResult.isValid && validationResult.warnings.length === 0
              ? 'border-[var(--status-green-border)] bg-[var(--status-green-bg)] text-[var(--status-green-text)]'
              : validationResult.hasCycle || validationResult.errors.length > 0
              ? 'border-[var(--status-red-border)] bg-[var(--status-red-bg)] text-[var(--status-red-text)]'
              : 'border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] text-[var(--status-yellow-text)]'
          }`}
        >
          {validationResult.isLocalFallback && (
            <Badge variant="warning" size="sm" className="mr-1 shrink-0">
              Local Only (Server Offline)
            </Badge>
          )}
          {!validationResult.isLocalFallback && validationResult.isValid && (
            <Badge variant="success" size="sm" className="mr-1 shrink-0">
              Server Verified
            </Badge>
          )}
          {validationResult.isValid && validationResult.warnings.length === 0 ? (
            <>
              <CheckCircle2 size={13} className="shrink-0" />
              <span>
                DAG Valid: Acyclic directed graph ready for execution.
                {validationResult.topologicalOrder && validationResult.topologicalOrder.length > 0
                  ? ` Deterministic order: [${validationResult.topologicalOrder.join(' \u2192 ')}]`
                  : ''}
              </span>
            </>
          ) : validationResult.hasCycle || validationResult.errors.length > 0 ? (
            <>
              <AlertCircle size={13} className="shrink-0" />
              <span>Cycle Error: {validationResult.errors.join('; ')}</span>
            </>
          ) : (
            <>
              <AlertTriangle size={13} className="shrink-0" />
              <span>Warning: {validationResult.warnings.join('; ')}</span>
            </>
          )}
        </div>
      )}

      {/* Main Workspace: Palette + Canvas + Inspector */}
      <div className="flex-1 flex min-h-0 relative">
        <TaskPalette onAddTask={handleAddTask} />

        <div className="flex-1 w-full h-full canvas-dot-grid relative min-h-[500px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            defaultViewport={{ x: 50, y: 80, zoom: 0.95 }}
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background
              color={theme === 'dark' ? '#262626' : '#E4E4E7'}
              gap={20}
              size={1.5}
            />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={theme === 'dark' ? '#58A6FF' : '#0070F3'}
              maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.75)'}
            />
          </ReactFlow>
        </div>

        <TaskInspector
          selectedNode={selectedNode}
          nodes={nodes}
          edges={edges}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          onClose={() => setSelectedNodeId(null)}
        />
      </div>

      {/* Simulated Execution Modal */}
      <Modal
        isOpen={isSimulateRunModalOpen}
        onClose={() => setIsSimulateRunModalOpen(false)}
        title="Simulated Pipeline Execution"
        description="Phase 0 UI Foundation Scope Boundary"
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsSimulateRunModalOpen(false)}
          >
            Close
          </Button>
        }
      >
        <div className="space-y-3 text-xs">
          <div className="rounded-[5px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-3 text-[var(--status-yellow-text)] flex items-start gap-2.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              <strong className="block font-medium">Phase 0 Architecture Boundary</strong>
              <span>
                Task execution is simulated in the browser. Spring Boot scheduler, worker leases, and PostgreSQL persistence are scheduled for Phase 1.
              </span>
            </div>
          </div>

          <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-3 font-mono text-[11px] space-y-1.5 text-[var(--text-secondary)]">
            <div className="text-[var(--accent-blue)]">[DRY-RUN] Validating graph topology...</div>
            <div className="text-[var(--status-green-text)]">✔ Structure: 4 tasks, 4 edges, acyclic verified</div>
            <div>▶ [Task 1] Fetch Clickstream API (HTTP GET 200 OK — 420ms)</div>
            <div>▶ [Task 2] Deduplicate & Cleanse (Cleaned 14,200 records — 1850ms)</div>
            <div>▶ [Task 3] Verify Schema Hash (Avro schema valid — 610ms)</div>
            <div>▶ [Task 4] Load to Data Warehouse (Transaction ready)</div>
            <div className="text-[var(--status-green-text)] font-semibold pt-1">
              ✔ Simulated run completed with 0 errors.
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderContent {...props} />
    </ReactFlowProvider>
  );
};
