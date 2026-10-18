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
  topologicalOrder?: string[];
  isLocalFallback?: boolean;
}

// --- Backend REST API DTOs & Enums ---

export interface EdgeDto {
  source: string;
  target: string;
}

export interface ValidateDagRequest {
  taskIds: string[];
  edges: EdgeDto[];
}

export interface ValidateDagResponse {
  isValid: boolean;
  hasCycle: boolean;
  errors: string[];
  warnings: string[];
  cycleNodes: string[];
  disconnectedNodes: string[];
  topologicalOrder: string[];
}

export type TaskActionType = 'NO_OP' | 'DELAY' | 'FAIL' | 'FAIL_UNTIL_ATTEMPT';

export interface TaskActionDto {
  type: TaskActionType;
  delayMs?: number;
  failUntilAttempt?: number;
  errorMessage?: string;
}

export type BackoffStrategy = 'NONE' | 'FIXED' | 'EXPONENTIAL';
export type JitterStrategy = 'NONE' | 'FULL';

export interface RetryPolicyDto {
  maxAttempts?: number;
  backoffStrategy?: BackoffStrategy;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterStrategy?: JitterStrategy;
}

export interface TaskDefinitionDto {
  id: string;
  action?: TaskActionDto;
  retryPolicy?: RetryPolicyDto;
}

export interface ExecuteWorkflowRequest {
  tasks: TaskDefinitionDto[];
  edges: EdgeDto[];
  concurrency?: number;
}

export type WorkflowRunState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type BackendTaskState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TaskExecutionResponseDto {
  taskId: string;
  state: BackendTaskState;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attemptCount: number;
  errorMessage: string | null;
  attemptErrors: string[];
}

export interface ExecuteWorkflowResponse {
  state: WorkflowRunState;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  taskResults: Record<string, TaskExecutionResponseDto>;
}

export interface ApiErrorResponse {
  status: number;
  error: string;
  message: string;
  timestamp: string;
  details: string[];
}
