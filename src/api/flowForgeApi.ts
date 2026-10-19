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
} from '../types';

/**
 * Standardized error thrown for failed FlowForge backend REST API requests.
 */
export class FlowForgeApiError extends Error {
  readonly status: number;
  readonly details: string[];
  readonly errorBody?: ApiErrorResponse;

  constructor(
    status: number,
    message: string,
    details: string[] = [],
    errorBody?: ApiErrorResponse
  ) {
    super(message);
    this.name = 'FlowForgeApiError';
    this.status = status;
    this.details = details;
    this.errorBody = errorBody;
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

  throw new FlowForgeApiError(res.status, message, details, errorBody);
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: { Accept: 'application/json' },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<ProjectResponseDto>(response);
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
      headers: { Accept: 'application/json' },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: { Accept: 'application/json' },
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
      headers: { Accept: 'application/json' },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof FlowForgeApiError) throw err;
    throw new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
  }

  return handleResponse<WorkflowVersionResponseDto>(response);
}
