import React, { useState, useCallback, useMemo, useEffect, useRef, useContext } from 'react';
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
import { INITIAL_DAG_NODES, INITIAL_DAG_EDGES, MOCK_WORKFLOWS, MOCK_PROJECTS } from '../mockData';
import type {
  TaskNodeData,
  TaskType,
  TaskStatus,
  DagValidationResult,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
  WorkflowResponseDto,
  WorkflowVersionResponseDto,
  ProjectRole,
} from '../types';
import {
  fetchWorkflows as defaultFetchWorkflows,
  createWorkflow as defaultCreateWorkflow,
  getLatestWorkflowVersion as defaultGetLatestWorkflowVersion,
  createWorkflowVersion as defaultCreateWorkflowVersion,
  fetchWorkflowRuns as defaultFetchWorkflowRuns,
  getWorkflowRun as defaultGetWorkflowRun,
  executeWorkflowVersionRun as defaultExecuteWorkflowVersionRun,
  fetchProjectMembers as defaultFetchProjectMembers,
  FlowForgeApiError,
} from '../api/flowForgeApi';
import { AuthContext } from '../context/AuthContext';
import { useProjectMembership } from '../utils/useProjectMembership';
import { ProjectMembersModal } from '../components/project/ProjectMembersModal';
import { saveWorkflowDraft, restoreCanvasFromGraphPayload } from '../utils/workflowPersistenceAdapters';
import { CustomTaskNode } from '../components/workflow/CustomTaskNode';
import { TaskPalette } from '../components/workflow/TaskPalette';
import { TaskInspector } from '../components/workflow/TaskInspector';
import { ExecutionModal } from '../components/workflow/ExecutionModal';
import { RunHistoryModal } from '../components/workflow/RunHistoryModal';
import {
  executeWorkflowValidation,
} from '../utils/dagValidationAdapters';
import {
  executeWorkflowRun,
  type ExecutionRunResult,
} from '../utils/workflowExecutionAdapters';
import {
  executeDurableWorkflowRun,
  isCanvasDirty,
} from '../utils/durableExecutionAdapters';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  ArrowLeft,
  CheckCircle2,
  Play,
  Save,
  AlertTriangle,
  AlertCircle,
  RotateCcw,
  Maximize2,
  Loader2,
  History,
  Users,
  Info,
} from 'lucide-react';

export interface WorkflowBuilderProps {
  projectId?: string;
  workflowId?: string;
  onBackToProjects: () => void;
  onShowToast: (title: string, message?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  theme?: 'light' | 'dark';
  executeApiFn?: (request: ExecuteWorkflowRequest) => Promise<ExecuteWorkflowResponse>;
  fetchWorkflowsFn?: typeof defaultFetchWorkflows;
  createWorkflowFn?: typeof defaultCreateWorkflow;
  getLatestVersionFn?: typeof defaultGetLatestWorkflowVersion;
  createVersionFn?: typeof defaultCreateWorkflowVersion;
  fetchRunsFn?: typeof defaultFetchWorkflowRuns;
  getRunFn?: typeof defaultGetWorkflowRun;
  executeDurableRunFn?: typeof defaultExecuteWorkflowVersionRun;
  fetchMembersFn?: typeof defaultFetchProjectMembers;
  overrideRole?: ProjectRole | null;
  isAuthenticated?: boolean;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
}

const WorkflowBuilderContent: React.FC<WorkflowBuilderProps> = ({
  projectId,
  workflowId,
  onBackToProjects,
  onShowToast,
  theme = 'dark',
  executeApiFn,
  fetchWorkflowsFn = defaultFetchWorkflows,
  createWorkflowFn = defaultCreateWorkflow,
  getLatestVersionFn = defaultGetLatestWorkflowVersion,
  createVersionFn = defaultCreateWorkflowVersion,
  fetchRunsFn = defaultFetchWorkflowRuns,
  getRunFn = defaultGetWorkflowRun,
  executeDurableRunFn = defaultExecuteWorkflowVersionRun,
  fetchMembersFn = defaultFetchProjectMembers,
  overrideRole,
  isAuthenticated,
  onOpenAuth,
}) => {
  const authContext = useContext(AuthContext);
  const effectiveIsAuthenticated =
    isAuthenticated !== undefined ? isAuthenticated : (authContext?.isAuthenticated ?? true);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>(INITIAL_DAG_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_DAG_EDGES);
  const { fitView } = useReactFlow();

  const [currentWorkflow, setCurrentWorkflow] = useState<{
    id: string;
    projectId?: string;
    name: string;
    slug?: string;
    isMock?: boolean;
  } | null>(null);

  const effectiveProjectId = currentWorkflow?.projectId || projectId;
  const {
    role,
    permissions,
    isLoading: isLoadingRole,
  } = useProjectMembership(effectiveProjectId, {
    fetchMembersFn,
    overrideRole,
    isMock: currentWorkflow?.isMock,
  });

  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<WorkflowVersionResponseDto | null>(null);
  const [isLoadingWorkflow, setIsLoadingWorkflow] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const isSavingRef = useRef<boolean>(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<DagValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSimulateRunModalOpen, setIsSimulateRunModalOpen] = useState(false);
  const [isRunHistoryOpen, setIsRunHistoryOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState<number>(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionRunResult | null>(null);

  // Synchronous in-flight execution lock to prevent race conditions from rapid duplicate triggers
  const isExecutingRef = useRef<boolean>(false);
  // Monotonically increasing run ID to ignore stale responses if the graph is edited while in flight
  const activeRunIdRef = useRef<number>(0);

  const nodeTypes = useMemo(
    () => ({
      customTask: CustomTaskNode,
      taskNode: CustomTaskNode,
    }),
    []
  );

  // Workflow initialization & persistence fetch
  useEffect(() => {
    let isCancelled = false;

    const loadWorkflow = async () => {
      if (!projectId && !workflowId) {
        setCurrentWorkflow({
          id: MOCK_WORKFLOWS[0].id,
          projectId: MOCK_WORKFLOWS[0].projectId,
          name: MOCK_WORKFLOWS[0].name,
          slug: MOCK_WORKFLOWS[0].id,
          isMock: true,
        });
        return;
      }

      setIsLoadingWorkflow(true);

      try {
        let activeWf: { id: string; projectId?: string; name: string; slug?: string; isMock?: boolean } | null = null;

        if (workflowId) {
          const isMockWorkflow = MOCK_WORKFLOWS.some((w) => w.id === workflowId);
          activeWf = { id: workflowId, name: 'Active Workflow', isMock: isMockWorkflow };
        } else if (projectId) {
          const isMockProject = MOCK_PROJECTS.some((p) => p.id === projectId);
          if (isMockProject) {
            const mockWf = MOCK_WORKFLOWS.find((w) => w.projectId === projectId) || MOCK_WORKFLOWS[0];
            activeWf = {
              id: mockWf.id,
              projectId,
              name: mockWf.name,
              slug: mockWf.id,
              isMock: true,
            };
          } else {
            try {
              const page = await fetchWorkflowsFn(projectId, { page: 0, size: 10 });
              if (page.content && page.content.length > 0) {
                activeWf = { ...page.content[0], isMock: false };
              } else {
                const created: WorkflowResponseDto = await createWorkflowFn(projectId, {
                  name: 'Main Pipeline',
                  description: 'Default orchestration workflow',
                });
                activeWf = { ...created, isMock: false };
              }
            } catch (err) {
              const isAuthError = err instanceof FlowForgeApiError && (err.isUnauthorized || err.status === 401);
              if (isAuthError) {
                onShowToast(
                  'Authentication Required',
                  'Please sign in to access workflows for this project.',
                  'warning'
                );
                if (onOpenAuth) {
                  onOpenAuth('login');
                }
                return;
              }
              const mockWf = MOCK_WORKFLOWS.find((w) => w.projectId === projectId) || MOCK_WORKFLOWS[0];
              activeWf = {
                id: mockWf.id,
                projectId,
                name: mockWf.name,
                slug: mockWf.id,
                isMock: true,
              };
            }
          }
        }

        if (isCancelled || !activeWf) return;
        setCurrentWorkflow(activeWf);

        if (!activeWf.isMock) {
          try {
            const latest = await getLatestVersionFn(activeWf.id);
            if (!isCancelled && latest) {
              setCurrentVersion(latest);
              const payload = latest.graphPayload;
              if (payload && Array.isArray(payload.nodes)) {
                const { nodes: loadedNodes, edges: loadedEdges } = restoreCanvasFromGraphPayload(payload);
                setNodes(loadedNodes);
                setEdges(loadedEdges);
                if (loadedNodes.length > 0) {
                  setTimeout(() => {
                    fitView({ padding: 0.25, duration: 200 });
                  }, 50);
                }
              }
            }
          } catch {
            // No versions persisted yet: initial canvas remains active
          }
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingWorkflow(false);
        }
      }
    };

    void loadWorkflow();

    return () => {
      isCancelled = true;
    };
  }, [projectId, workflowId, fetchWorkflowsFn, createWorkflowFn, getLatestVersionFn, setNodes, setEdges, fitView]);

  // Helper to reset execution results and revert non-IDLE canvas node statuses when the graph is modified
  const resetStaleExecution = useCallback(() => {
    // Invalidate in-flight execution run so late responses are ignored
    activeRunIdRef.current += 1;
    setExecutionResult(null);
    setNodes((nds) => {
      const hasNonIdle = nds.some((n) => n.data.status && n.data.status !== 'IDLE');
      if (!hasNonIdle) return nds;
      return nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          status: 'IDLE' as TaskStatus,
        },
      }));
    });
  }, [setNodes]);

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
      resetStaleExecution();
    },
    [setEdges, resetStaleExecution]
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
    setValidationResult(null);
    resetStaleExecution();
  };

  const handleUpdateNode = (nodeId: string, updatedData: Partial<TaskNodeData>) => {
    activeRunIdRef.current += 1;
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              ...updatedData,
              status: 'IDLE' as TaskStatus,
            },
          };
        }
        return node;
      })
    );
    setExecutionResult(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
    onShowToast('Task Removed', 'Node removed from pipeline.');
    setValidationResult(null);
    resetStaleExecution();
  };

  const handleResetGraph = () => {
    activeRunIdRef.current += 1;
    setNodes(INITIAL_DAG_NODES);
    setEdges(INITIAL_DAG_EDGES);
    setSelectedNodeId(null);
    setValidationResult(null);
    setExecutionResult(null);
    fitView({ padding: 0.25, duration: 200 });
    onShowToast('Pipeline Reset', 'Restored 4-node sample DAG.');
  };

  const handleRunSimulation = useCallback(async () => {
    // Synchronous guard: If already in flight, reopen modal without dispatching duplicate request
    if (isExecutingRef.current || isExecuting) {
      setIsSimulateRunModalOpen(true);
      return;
    }

    isExecutingRef.current = true;
    setIsSimulateRunModalOpen(true);

    const currentRunId = activeRunIdRef.current + 1;
    activeRunIdRef.current = currentRunId;

    try {
      await executeWorkflowRun({
        nodes,
        edges,
        isExecuting: false,
        setIsExecuting,
        onExecutionComplete: (result) => {
          // Discard results if graph has been edited/reset since this run started
          if (activeRunIdRef.current !== currentRunId) return;
          setExecutionResult(result);
        },
        onUpdateNodeStatus: (nodeId, status) => {
          // Discard status updates if graph has been edited/reset since this run started
          if (activeRunIdRef.current !== currentRunId) return;
          setNodes((nds) =>
            nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))
          );
        },
        onShowToast,
        executeApiFn,
      });
    } finally {
      isExecutingRef.current = false;
    }
  }, [nodes, edges, isExecuting, onShowToast, setNodes, executeApiFn]);

  const handleRunDurable = useCallback(async () => {
    if (isExecutingRef.current || isExecuting) {
      return;
    }

    if (!effectiveIsAuthenticated) {
      onShowToast(
        'Authentication Required',
        'Please sign in to execute durable workflow runs.',
        'warning'
      );
      if (onOpenAuth) {
        onOpenAuth('login');
      }
      return;
    }

    if (!permissions.canExecuteRuns) {
      onShowToast(
        'Execution Forbidden',
        role === 'VIEWER'
          ? 'Read-only access: Viewers cannot execute durable workflow runs.'
          : 'You do not have permission to execute durable runs in this project.',
        'warning'
      );
      return;
    }

    isExecutingRef.current = true;
    try {
      await executeDurableWorkflowRun({
        workflowId: currentWorkflow?.id,
        workflowName: currentWorkflow?.name,
        isMockWorkflow: currentWorkflow?.isMock,
        currentVersion,
        nodes,
        edges,
        isExecuting,
        setIsExecuting,
        setNodes,
        onShowToast,
        isAuthenticated: effectiveIsAuthenticated,
        onExecutionComplete: () => {
          setHistoryRefreshKey((prev) => prev + 1);
        },
        executeDurableApiFn: executeDurableRunFn,
      });
    } finally {
      isExecutingRef.current = false;
    }
  }, [
    isExecuting,
    currentWorkflow?.id,
    currentWorkflow?.name,
    currentWorkflow?.isMock,
    currentVersion,
    nodes,
    edges,
    setIsExecuting,
    setNodes,
    onShowToast,
    executeDurableRunFn,
    effectiveIsAuthenticated,
    onOpenAuth,
    permissions.canExecuteRuns,
    role,
  ]);

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

  const handleSaveDraft = async () => {
    if (isSavingRef.current || isSavingDraft) {
      return;
    }

    if (!effectiveIsAuthenticated) {
      onShowToast(
        'Authentication Required',
        'Please sign in to save workflow drafts to the server.',
        'warning'
      );
      if (onOpenAuth) {
        onOpenAuth('login');
      }
      return;
    }

    if (!permissions.canEditWorkflows) {
      onShowToast(
        'Save Forbidden',
        role === 'VIEWER'
          ? 'Read-only access: Viewers cannot save workflow drafts.'
          : 'You do not have permission to modify workflows in this project.',
        'warning'
      );
      return;
    }

    if (!currentWorkflow?.id || currentWorkflow.isMock) {
      onShowToast(
        'Sample Template (Cannot Save)',
        'Sample template workflows cannot be saved directly to the backend. Create or open a persistent project workspace to persist workflow drafts.',
        'warning'
      );
      return;
    }

    isSavingRef.current = true;
    setIsSavingDraft(true);

    try {
      const saved = await saveWorkflowDraft({
        workflowId: currentWorkflow.id,
        isMock: currentWorkflow.isMock,
        isAuthenticated: effectiveIsAuthenticated,
        nodes,
        edges,
        versionTag: currentVersion ? `v${currentVersion.versionNumber + 1}.0` : undefined,
        isSaving: false,
        setIsSaving: () => {},
        onShowToast,
        createVersionApiFn: createVersionFn,
      });

      if (saved) {
        setCurrentVersion(saved);
      }
    } catch {
      // Error toast already displayed by saveWorkflowDraft; no fake success
    } finally {
      isSavingRef.current = false;
      setIsSavingDraft(false);
    }
  };

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
              {currentWorkflow ? currentWorkflow.name : 'Clickstream Ingestion & Deduplication'}
            </span>
            <Badge
              variant={currentVersion?.isValidDag === false ? 'warning' : 'cyan'}
              size="sm"
              data-testid="workflow-version-badge"
            >
              {currentVersion ? `v${currentVersion.versionNumber} [Draft]` : 'v1.4.0 [Draft]'}
            </Badge>
            <Badge variant="outline" size="sm" data-testid="workflow-metrics-badge">
              {currentVersion
                ? `${currentVersion.taskCount} tasks • ${currentVersion.edgeCount} edges`
                : `${nodes.length} nodes • ${edges.length} edges`}
            </Badge>
            {currentVersion && (
              <Badge
                variant={currentVersion.isValidDag ? 'success' : 'warning'}
                size="sm"
                data-testid="dag-validity-badge"
              >
                {currentVersion.isValidDag ? 'DAG Valid' : 'Cyclic Draft'}
              </Badge>
            )}
            {currentVersion && isCanvasDirty(nodes, edges, currentVersion) && (
              <Badge variant="warning" size="sm" data-testid="unsaved-edits-badge">
                Unsaved Edits
              </Badge>
            )}
            {isLoadingWorkflow && (
              <Badge variant="outline" size="sm">
                <Loader2 size={10} className="animate-spin mr-1 text-[var(--accent-blue)]" />
                Syncing...
              </Badge>
            )}
            {/* User Project Role Badge */}
            <Badge
              variant={role === 'ADMIN' ? 'cyan' : role === 'DEVELOPER' ? 'default' : 'outline'}
              size="sm"
              data-testid="user-project-role-badge"
            >
              Role: {role ?? (isLoadingRole ? 'Verifying...' : 'Viewer')}
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
            variant="outline"
            size="sm"
            icon={<History size={12} />}
            onClick={() => setIsRunHistoryOpen(true)}
            data-testid="run-history-button"
          >
            Run History
          </Button>

          {/* Admin Only: Membership Management */}
          {permissions.canManageMembers && effectiveProjectId && !currentWorkflow?.isMock && (
            <Button
              variant="outline"
              size="sm"
              icon={<Users size={12} />}
              onClick={() => setIsMembersModalOpen(true)}
              data-testid="workflow-builder-members-button"
              title="Manage project members and roles"
            >
              Members
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={isSavingDraft ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            onClick={() => void handleSaveDraft()}
            disabled={isSavingDraft || isLoadingWorkflow || !permissions.canEditWorkflows}
            title={
              !permissions.canEditWorkflows
                ? role === 'VIEWER'
                  ? 'Read-only access: Viewers cannot save workflow drafts'
                  : 'Saving disabled for current role'
                : undefined
            }
            data-testid="save-draft-button"
          >
            {isSavingDraft ? 'Saving Draft...' : 'Save Draft'}
          </Button>

          <Button
            variant="primary"
            size="sm"
            icon={isExecuting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            onClick={() => {
              if (currentWorkflow?.isMock) {
                if (isExecuting) {
                  setIsSimulateRunModalOpen(true);
                } else {
                  void handleRunSimulation();
                }
              } else {
                void handleRunDurable();
              }
            }}
            disabled={
              isExecuting ||
              (!currentWorkflow?.isMock && !permissions.canExecuteRuns)
            }
            title={
              !currentWorkflow?.isMock && !permissions.canExecuteRuns
                ? role === 'VIEWER'
                  ? 'Read-only access: Viewers cannot execute durable runs'
                  : 'Execution disabled for current role'
                : undefined
            }
            data-testid={currentWorkflow?.isMock ? 'run-simulated-button' : 'run-durable-button'}
          >
            {isExecuting
              ? 'Executing...'
              : currentWorkflow?.isMock
              ? 'Run (Simulated)'
              : currentVersion
              ? `Run v${currentVersion.versionNumber}`
              : 'Run'}
          </Button>
        </div>
      </div>

      {/* Read-Only Viewer Notice Banner */}
      {role === 'VIEWER' && !currentWorkflow?.isMock && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-subsurface)] px-4 py-1.5 text-xs text-[var(--text-secondary)] shrink-0"
          data-testid="viewer-read-only-banner"
        >
          <Info size={13} className="text-[var(--accent-blue)] shrink-0" />
          <span>
            <strong>Read-Only Access:</strong> You hold Viewer permissions for this project workspace. Canvas edits cannot be saved and durable runs are disabled.
          </span>
        </div>
      )}

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

        <div className="flex-1 min-w-0 h-full canvas-dot-grid relative">
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
      <ExecutionModal
        isOpen={isSimulateRunModalOpen}
        onClose={() => setIsSimulateRunModalOpen(false)}
        isExecuting={isExecuting}
        executionResult={executionResult}
        onRunExecution={handleRunSimulation}
        nodes={nodes}
      />

      {/* Durable Run History Modal */}
      <RunHistoryModal
        isOpen={isRunHistoryOpen}
        onClose={() => setIsRunHistoryOpen(false)}
        workflowId={currentWorkflow?.id}
        workflowName={currentWorkflow?.name}
        isMockWorkflow={currentWorkflow?.isMock}
        fetchRunsFn={fetchRunsFn}
        getRunFn={getRunFn}
        refreshTrigger={historyRefreshKey}
      />

      {/* Project Members Modal for Admin */}
      {effectiveProjectId && isMembersModalOpen && (
        <ProjectMembersModal
          isOpen={isMembersModalOpen}
          onClose={() => setIsMembersModalOpen(false)}
          projectId={effectiveProjectId}
          projectName={currentWorkflow?.name || 'Project'}
          currentUserRole={role}
          fetchMembersFn={fetchMembersFn}
          onShowToast={onShowToast}
        />
      )}
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
