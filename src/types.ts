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

export type TaskStatus = 'IDLE' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TaskNodeData {
  [key: string]: unknown;
  label: string;
  taskType: TaskType;
  timeoutMs: number;
  maxRetries: number;
  parameters: Record<string, unknown>;
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

export type WorkflowRunState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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

// --- Persistence REST API DTOs (Phase 1.2 Step 2) ---

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

export interface CreateProjectRequest {
  name: string;
  slug?: string;
  description?: string;
}

export interface ProjectResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowRequest {
  name: string;
  slug?: string;
  description?: string;
}

export interface WorkflowResponseDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowVersionRequest {
  versionTag?: string;
  description?: string;
  graphPayload: Record<string, unknown>;
}

export interface WorkflowVersionResponseDto {
  id: string;
  workflowId: string;
  versionNumber: number;
  versionTag: string;
  description: string | null;
  graphPayload: {
    nodes?: unknown[];
    edges?: unknown[];
    [key: string]: unknown;
  };
  taskCount: number;
  edgeCount: number;
  isValidDag: boolean;
  createdAt: string;
}

export interface WorkflowVersionSummaryResponseDto {
  id: string;
  workflowId: string;
  versionNumber: number;
  versionTag: string;
  description: string | null;
  taskCount: number;
  edgeCount: number;
  isValidDag: boolean;
  createdAt: string;
}

// --- Durable Workflow Run REST API DTOs (Phase 1.3 / Phase 1.4) ---

export interface ExecuteRunRequest {
  versionNumber?: number;
  triggeredBy?: string;
  concurrency?: number;
}

export type TaskRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TaskRunResponseDto {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  attemptCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface WorkflowRunResponseDto {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  versionNumber: number;
  status: WorkflowRunState;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  createdAt: string;
  tasks: TaskRunResponseDto[];
}

export interface WorkflowRunSummaryResponseDto {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  versionNumber: number;
  status: WorkflowRunState;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  createdAt: string;
  taskCount: number;
}

// --- Authentication & User REST API DTOs (Phase 1.5.4) ---

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UserResponseDto {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserResponse = UserResponseDto;

export interface AuthResponseDto {
  token: string;
  user: UserResponseDto;
}

export type AuthResponse = AuthResponseDto;

// --- Role-Based Access Control (RBAC) & Membership DTOs (Phase 1.5.5) ---

export type ProjectRole = 'ADMIN' | 'DEVELOPER' | 'VIEWER';

export interface ProjectMemberResponseDto {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  fullName: string;
  role: ProjectRole;
  createdAt: string;
}

export type ProjectMemberResponse = ProjectMemberResponseDto;

export interface AddProjectMemberRequest {
  userId?: string;
  email?: string;
  role: ProjectRole;
}
