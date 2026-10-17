import type {
  ValidateDagRequest,
  ValidateDagResponse,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
  ApiErrorResponse,
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
