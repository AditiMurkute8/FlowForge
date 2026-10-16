// --- Project & Telemetry Models ---
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'MAINTENANCE';
export type PipelineHealth = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'QUEUED';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  workflowCount: number;
  lastExecutionAt: string;
  lastExecutionStatus: PipelineHealth;
  tags: string[];
  owner: string;
  isMock: boolean;
  version: string;
  updatedAt: string;
}

export interface ProjectStats {
  totalProjects: number;
  activeWorkflows: number;
  executions24h: number;
  successRatePercent: number;
}

// --- Workflow & DAG Task Models ---
export type TaskType =
  | 'HTTP_REQUEST'
  | 'PYTHON_SCRIPT'
  | 'BASH_COMMAND'
  | 'SQL_QUERY'
  | 'LLM_PROMPT'
  | 'DELAY_WAIT';

export type TaskStatus = 'IDLE' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface TaskNodeData {
  [key: string]: unknown;
  label: string;
  taskType: TaskType;
  timeoutMs: number;
  maxRetries: number;
  parameters: Record<string, string>;
  status?: TaskStatus;
  executionDurationMs?: number;
  isCycle?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  projectId: string;
  name: string;
  version: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  updatedAt: string;
}

export interface DagValidationResult {
  isValid: boolean;
  hasCycle: boolean;
  cycleNodes: string[];
  cycleEdges: string[];
  disconnectedNodes: string[];
  errors: string[];
  warnings: string[];
}
