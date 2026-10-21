import type {
  ValidateDagRequest,
  ValidateDagResponse,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
  ApiErrorResponse,
  PageResponse,
  CreateProjectRequest,
  ProjectResponseDto,
  CreateWorkflowRequest,
  WorkflowResponseDto,
  CreateWorkflowVersionRequest,
  WorkflowVersionResponseDto,
  WorkflowVersionSummaryResponseDto,
  ExecuteRunRequest,
  WorkflowRunResponseDto,
  WorkflowRunSummaryResponseDto,
  TaskRunResponseDto,
  RegisterRequest,
  LoginRequest,
  UserResponseDto,
  AuthResponseDto,
  ProjectMemberResponseDto,
  AddProjectMemberRequest,
} from '../types';

/**
 * Standardized error thrown for failed FlowForge backend REST API requests.
 */
export class FlowForgeApiError extends Error {
  readonly status: number;
  readonly details: string[];
  readonly errorBody?: ApiErrorResponse;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    message: string,
    details: string[] = [],
    errorBody?: ApiErrorResponse,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'FlowForgeApiError';
    this.status = status;
    this.details = details;
    this.errorBody = errorBody;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Options for configuring API client requests.
 */
export interface ApiClientOptions {
  /**
   * Base URL override for testing or custom host configuration.
   * If omitted, falls back to `VITE_API_BASE_URL` or `http://localhost:8080`.
   */
  baseUrl?: string;

  /**
   * Custom fetch implementation for unit testing or node environments.
   * Defaults to global `fetch`.
   */
  fetchFn?: typeof fetch;

  /**
   * Optional bearer token override for this specific request.
   * Takes precedence over the global auth token getter if provided.
   * Pass null or empty string to explicitly omit the Authorization header.
   */
  token?: string | null;
}

export type AuthTokenGetter = () => string | null | undefined;

let authTokenGetter: AuthTokenGetter | null = null;

/**
 * Registers a function that dynamically resolves the active authentication bearer token.
 * Decouples the API client from React state or specific storage mechanisms (e.g. AuthContext)
 * without introducing React dependencies.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  authTokenGetter = getter;
}

/**
 * Returns the active authentication bearer token if a getter is configured.
 */
export function getAuthToken(): string | null {
  if (!authTokenGetter) {
    return null;
  }
  const token = authTokenGetter();
  return token && token.trim() ? token.trim() : null;
}

export type UnauthorizedHandler = (error: FlowForgeApiError) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Registers a callback invoked whenever any API request encounters an HTTP 401 Unauthorized response.
 * Allows centralized session state managers to clear invalid/expired sessions and prompt sign-in.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Returns the currently registered unauthorized handler if one is set.
 */
export function getUnauthorizedHandler(): UnauthorizedHandler | null {
  return unauthorizedHandler;
}

/**
 * Invokes the active unauthorized handler safely if configured.
 */
export function notifyUnauthorized(error: FlowForgeApiError): void {
  if (unauthorizedHandler) {
    try {
      unauthorizedHandler(error);
    } catch {
      // Safeguard against listener exceptions disrupting API error handling
    }
  }
}

/**
 * Helper to build standard request headers including Accept, Content-Type,
 * and Authorization: Bearer <token> for protected endpoints.
 */
function buildHeaders(
  options?: ApiClientOptions,
  isProtected = true,
  hasJsonBody = false
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json';
  }

  headers['Accept'] = 'application/json';

  if (isProtected) {
    const token =
      options?.token !== undefined
        ? options.token && options.token.trim()
          ? options.token.trim()
          : null
        : getAuthToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
}

/**
 * Resolves the root `/api/v1` base URL, ensuring trailing slashes and version path segments are normalized.
 */
export function resolveApiRoot(baseUrl?: string): string {
  const envUrl =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : undefined;

  const raw =
    (baseUrl && baseUrl.trim()) ||
    (envUrl && typeof envUrl === 'string' && envUrl.trim()) ||
    'http://localhost:8080';

  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

/**
 * Parses HTTP responses safely, throwing a detailed `FlowForgeApiError` on non-2xx statuses.
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) {
      return undefined as T;
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof FlowForgeApiError) {
        throw err;
      }
      throw new FlowForgeApiError(res.status, 'Invalid JSON received from FlowForge server');
    }
  }

  let errorBody: ApiErrorResponse | undefined;
  let message = `HTTP ${res.status}: ${res.statusText || 'Request failed'}`;
  let details: string[] = [];

  try {
    const rawText = await res.text();
    if (rawText && rawText.trim()) {
      const parsed: unknown = JSON.parse(rawText);
      if (typeof parsed === 'object' && parsed !== null) {
        const candidate = parsed as Record<string, unknown>;
        if (typeof candidate.message === 'string' && candidate.message.trim()) {
          message = candidate.message.trim();
        } else if (typeof candidate.error === 'string' && candidate.error.trim()) {
          message = candidate.error.trim();
        }

        if (Array.isArray(candidate.details)) {
          details = candidate.details.map((item: unknown) => String(item));
        }

        if (typeof candidate.status === 'number' && typeof candidate.error === 'string') {
          errorBody = candidate as unknown as ApiErrorResponse;
        }
      }
    }
  } catch {
    // Body was not JSON or was unreadable; keep default HTTP status message
  }

  let retryAfterSeconds: number | undefined;
  try {
    const retryHeader =
      res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
    if (retryHeader) {
      const parsedSec = parseInt(retryHeader, 10);
      if (!Number.isNaN(parsedSec) && parsedSec > 0) {
        retryAfterSeconds = parsedSec;
      }
    }
  } catch {
    // Body was not JSON or was unreadable; keep default HTTP status message
  }

  const apiError = new FlowForgeApiError(res.status, message, details, errorBody, retryAfterSeconds);
  if (res.status === 401) {
    notifyUnauthorized(apiError);
  }
  throw apiError;
}

/**
 * Validates a DAG graph structure for cycles, missing references, and disconnected nodes.
 *
 * @param request Directed graph node IDs and dependency edges
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns Server validation diagnostics, cycle nodes, and deterministic topological ordering
 * @throws FlowForgeApiError on validation failures, structural errors, or network outages
 */
export async function validateDag(
  request: ValidateDagRequest,
  options?: ApiClientOptions
): Promise<ValidateDagResponse> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/dag/validate`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, false, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) {
      throw err;
    }
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ValidateDagResponse>(response);
}

/**
 * Submits a workflow for execution on the server within bounded concurrency and timeout limits.
 *
 * @param request Tasks with safe actions, retry policies, dependencies, and concurrency limit
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns Workflow execution status and detailed per-task execution results
 * @throws FlowForgeApiError on validation rejection, capacity saturation (429), timeout (504), or failure
 */
export async function executeWorkflow(
  request: ExecuteWorkflowRequest,
  options?: ApiClientOptions
): Promise<ExecuteWorkflowResponse> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/workflows/execute`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, true, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) {
      throw err;
    }
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ExecuteWorkflowResponse>(response);
}

// ============================================================================
// PERSISTENCE REST API CLIENT METHODS (Phase 1.2 Step 2)
// ============================================================================

/**
 * Loads paginated projects from the FlowForge backend.
 */
export async function fetchProjects(
  options?: ApiClientOptions & { page?: number; size?: number }
): Promise<PageResponse<ProjectResponseDto>> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const page = options?.page ?? 0;
  const size = options?.size ?? 100;
  const url = `${apiRoot}/projects?page=${page}&size=${size}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<PageResponse<ProjectResponseDto>>(response);
}

/**
 * Creates a new project in the FlowForge backend.
 */
export async function createProject(
  request: CreateProjectRequest,
  options?: ApiClientOptions
): Promise<ProjectResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, true, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ProjectResponseDto>(response);
}

/**
 * Fetches a single project by ID.
 */
export async function getProject(
  projectId: string,
  options?: ApiClientOptions
): Promise<ProjectResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ProjectResponseDto>(response);
}

/**
 * Deletes a project by ID from the FlowForge backend.
 * Protected endpoint; requires ADMIN role in the project.
 *
 * @param projectId Unique identifier of the project to delete
 * @param options Optional client overrides (custom baseUrl, fetch implementation, or token)
 * @throws FlowForgeApiError on conflict (409 if workflows exist), forbidden (403), not found (404), or network error
 */
export async function deleteProject(
  projectId: string,
  options?: ApiClientOptions
): Promise<void> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'DELETE',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<void>(response);
}


/**
 * Loads paginated workflows for a specific parent project.
 */
export async function fetchWorkflows(
  projectId: string,
  options?: ApiClientOptions & { page?: number; size?: number }
): Promise<PageResponse<WorkflowResponseDto>> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const page = options?.page ?? 0;
  const size = options?.size ?? 100;
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}/workflows?page=${page}&size=${size}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<PageResponse<WorkflowResponseDto>>(response);
}

/**
 * Creates a new workflow under a parent project.
 */
export async function createWorkflow(
  projectId: string,
  request: CreateWorkflowRequest,
  options?: ApiClientOptions
): Promise<WorkflowResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}/workflows`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, true, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<WorkflowResponseDto>(response);
}

/**
 * Loads paginated version summaries for a workflow (omitting graphPayload).
 */
export async function fetchWorkflowVersions(
  workflowId: string,
  options?: ApiClientOptions & { page?: number; size?: number }
): Promise<PageResponse<WorkflowVersionSummaryResponseDto>> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const page = options?.page ?? 0;
  const size = options?.size ?? 50;
  const url = `${apiRoot}/workflows/${encodeURIComponent(workflowId)}/versions?page=${page}&size=${size}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<PageResponse<WorkflowVersionSummaryResponseDto>>(response);
}

/**
 * Fetches the latest immutable workflow version including full graphPayload.
 */
export async function getLatestWorkflowVersion(
  workflowId: string,
  options?: ApiClientOptions
): Promise<WorkflowVersionResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/workflows/${encodeURIComponent(workflowId)}/versions/latest`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<WorkflowVersionResponseDto>(response);
}

/**
 * Creates a new immutable workflow version snapshot (draft or valid DAG).
 */
export async function createWorkflowVersion(
  workflowId: string,
  request: CreateWorkflowVersionRequest,
  options?: ApiClientOptions
): Promise<WorkflowVersionResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/workflows/${encodeURIComponent(workflowId)}/versions`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, true, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<WorkflowVersionResponseDto>(response);
}

// ============================================================================
// DURABLE WORKFLOW RUN REST API CLIENT METHODS (Phase 1.4.1)
// ============================================================================

/**
 * Triggers synchronous execution of an immutable workflow version on the backend engine,
 * durably persisting the workflow run and task run records.
 *
 * @param workflowId Unique identifier of the parent workflow
 * @param request Optional execution options (versionNumber, triggeredBy, concurrency override)
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns Fully executed workflow run in terminal state with associated task runs
 * @throws FlowForgeApiError on validation rejection (400), not found (404), capacity saturation (429), timeout (504), or server failure
 */
export async function executeWorkflowVersionRun(
  workflowId: string,
  request?: ExecuteRunRequest,
  options?: ApiClientOptions
): Promise<WorkflowRunResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/workflows/${encodeURIComponent(workflowId)}/runs`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, true, true),
      body: JSON.stringify(request ?? {}),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<WorkflowRunResponseDto>(response);
}

/**
 * Loads paginated durable workflow runs for a specific workflow, ordered newest-first.
 *
 * @param workflowId Unique identifier of the parent workflow
 * @param options Pagination parameters (page, size) and client configuration
 * @returns Paginated list of workflow run summaries without task runs payload
 * @throws FlowForgeApiError on not found (404), network errors, or server failure
 */
export async function fetchWorkflowRuns(
  workflowId: string,
  options?: ApiClientOptions & { page?: number; size?: number }
): Promise<PageResponse<WorkflowRunSummaryResponseDto>> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const page = options?.page ?? 0;
  const size = options?.size ?? 20;
  const url = `${apiRoot}/workflows/${encodeURIComponent(workflowId)}/runs?page=${page}&size=${size}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<PageResponse<WorkflowRunSummaryResponseDto>>(response);
}

/**
 * Fetches a single durable workflow run by ID, including its associated task execution records.
 *
 * @param runId Unique identifier of the workflow run
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns Detailed workflow run record with tasks array
 * @throws FlowForgeApiError on not found (404), network errors, or server failure
 */
export async function getWorkflowRun(
  runId: string,
  options?: ApiClientOptions
): Promise<WorkflowRunResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/runs/${encodeURIComponent(runId)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<WorkflowRunResponseDto>(response);
}

/**
 * Lists individual task execution records for a durable workflow run in deterministic order.
 *
 * @param runId Unique identifier of the workflow run
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns Ordered array of task run execution records
 * @throws FlowForgeApiError on not found (404), network errors, or server failure
 */
export async function fetchTaskRuns(
  runId: string,
  options?: ApiClientOptions
): Promise<TaskRunResponseDto[]> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/runs/${encodeURIComponent(runId)}/tasks`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<TaskRunResponseDto[]>(response);
}

// ============================================================================
// AUTHENTICATION & USER PROFILE REST API CLIENT METHODS (Phase 1.5.4)
// ============================================================================

/**
 * Registers a new user account with the FlowForge backend.
 * Public endpoint; does not attach bearer tokens.
 *
 * @param request User registration payload (email, password, fullName)
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns AuthResponse containing JWT token and registered user profile
 * @throws FlowForgeApiError on validation rejection (400), email conflict (409), or network error
 */
export async function registerUser(
  request: RegisterRequest,
  options?: ApiClientOptions
): Promise<AuthResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/auth/register`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, false, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<AuthResponseDto>(response);
}

/**
 * Authenticates an existing user account using email and password.
 * Public endpoint; does not attach bearer tokens.
 *
 * @param request User login payload (email, password)
 * @param options Optional client overrides (custom baseUrl or fetch implementation)
 * @returns AuthResponse containing JWT token and authenticated user profile
 * @throws FlowForgeApiError on invalid credentials (401), validation failure (400), or network error
 */
export async function loginUser(
  request: LoginRequest,
  options?: ApiClientOptions
): Promise<AuthResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/auth/login`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, false, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<AuthResponseDto>(response);
}

/**
 * Fetches the currently authenticated user profile from `/api/v1/auth/me`.
 * Protected endpoint; requires Authorization: Bearer <token>.
 *
 * @param options Optional client overrides (custom baseUrl, fetch implementation, or token override)
 * @returns Currently authenticated user profile
 * @throws FlowForgeApiError on unauthorized (401), forbidden (403), or network error
 */
export async function getCurrentUser(
  options?: ApiClientOptions
): Promise<UserResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/auth/me`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<UserResponseDto>(response);
}

// Convenient aliases
export const register = registerUser;
export const login = loginUser;
export const getMe = getCurrentUser;

// ============================================================================
// PROJECT MEMBERSHIP & RBAC REST API CLIENT METHODS (Phase 1.5.5)
// ============================================================================

/**
 * Lists all members and their roles for a specific project.
 * Protected endpoint; permitted for VIEWER, DEVELOPER, and ADMIN members.
 *
 * @param projectId Unique identifier of the project
 * @param options Optional client overrides (custom baseUrl, fetch implementation, or token)
 * @returns Array of project member response records
 * @throws FlowForgeApiError on unauthorized (401), forbidden (403), not found (404), or network error
 */
export async function fetchProjectMembers(
  projectId: string,
  options?: ApiClientOptions
): Promise<ProjectMemberResponseDto[]> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}/members`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ProjectMemberResponseDto[]>(response);
}

/**
 * Adds a new member to a project or updates an existing member's role.
 * Protected endpoint; permitted strictly for ADMIN members.
 *
 * @param projectId Unique identifier of the project
 * @param request Member payload containing email or userId, and target role
 * @param options Optional client overrides (custom baseUrl, fetch implementation, or token)
 * @returns Created or updated project member details
 * @throws FlowForgeApiError on validation (400, including sole admin demotion), unauthorized (401), forbidden (403), not found (404), or network error
 */
export async function addOrUpdateProjectMember(
  projectId: string,
  request: AddProjectMemberRequest,
  options?: ApiClientOptions
): Promise<ProjectMemberResponseDto> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}/members`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: buildHeaders(options, true, true),
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ProjectMemberResponseDto>(response);
}

/**
 * Removes a member from a project.
 * Protected endpoint; permitted strictly for ADMIN members.
 *
 * @param projectId Unique identifier of the project
 * @param userId Unique identifier of the member to remove
 * @param options Optional client overrides (custom baseUrl, fetch implementation, or token)
 * @throws FlowForgeApiError on validation (400, including sole admin removal), unauthorized (401), forbidden (403), not found (404), or network error
 */
export async function removeProjectMember(
  projectId: string,
  userId: string,
  options?: ApiClientOptions
): Promise<void> {
  const fetchImpl = options?.fetchFn || fetch;
  const apiRoot = resolveApiRoot(options?.baseUrl);
  const url = `${apiRoot}/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'DELETE',
      headers: buildHeaders(options, true, false),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<void>(response);
}
