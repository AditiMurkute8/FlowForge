import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateDag,
  executeWorkflow,
  resolveApiRoot,
  FlowForgeApiError,
  fetchProjects,
  createProject,
  getProject,
  fetchWorkflows,
  createWorkflow,
  fetchWorkflowVersions,
  getLatestWorkflowVersion,
  createWorkflowVersion,
  executeWorkflowVersionRun,
  fetchWorkflowRuns,
  getWorkflowRun,
  fetchTaskRuns,
  registerUser,
  loginUser,
  getCurrentUser,
  setAuthTokenGetter,
  getAuthToken,
  register,
  login,
  getMe,
  deleteProject,
  fetchProjectMembers,
  addOrUpdateProjectMember,
  removeProjectMember,
} from './flowForgeApi';
import type {
  ValidateDagRequest,
  ValidateDagResponse,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
  ExecuteRunRequest,
  WorkflowRunResponseDto,
  WorkflowRunSummaryResponseDto,
  TaskRunResponseDto,
  PageResponse,
  RegisterRequest,
  LoginRequest,
  UserResponseDto,
  AuthResponseDto,
  ProjectMemberResponseDto,
  AddProjectMemberRequest,
} from '../types';

describe('flowForgeApi', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    setAuthTokenGetter(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
  });

  describe('resolveApiRoot', () => {
    it('uses fallback URL when no baseUrl or env variable is supplied', () => {
      expect(resolveApiRoot()).toBe('http://localhost:8080/api/v1');
    });

    it('normalizes trailing slashes properly', () => {
      expect(resolveApiRoot('http://localhost:8080/')).toBe('http://localhost:8080/api/v1');
      expect(resolveApiRoot('http://localhost:8080///')).toBe('http://localhost:8080/api/v1');
    });

    it('does not duplicate /api/v1 if already present in base URL', () => {
      expect(resolveApiRoot('http://api.flowforge.internal/api/v1')).toBe(
        'http://api.flowforge.internal/api/v1'
      );
      expect(resolveApiRoot('http://api.flowforge.internal/api/v1/')).toBe(
        'http://api.flowforge.internal/api/v1'
      );
    });

    it('trims leading and trailing whitespace', () => {
      expect(resolveApiRoot('  http://custom-host:9090  ')).toBe(
        'http://custom-host:9090/api/v1'
      );
    });
  });

  describe('validateDag', () => {
    const mockRequest: ValidateDagRequest = {
      taskIds: ['task-1', 'task-2'],
      edges: [{ source: 'task-1', target: 'task-2' }],
    };

    const mockResponse: ValidateDagResponse = {
      isValid: true,
      hasCycle: false,
      errors: [],
      warnings: [],
      cycleNodes: [],
      disconnectedNodes: [],
      topologicalOrder: ['task-1', 'task-2'],
    };

    it('sends correct HTTP method, URL, headers, and serialized body', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await validateDag(mockRequest, {
        baseUrl: 'http://localhost:8080',
        fetchFn: mockFetch,
      });

      expect(capturedUrl).toBe('http://localhost:8080/api/v1/dag/validate');
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(JSON.parse(capturedInit?.body as string)).toEqual(mockRequest);
      expect(result).toEqual(mockResponse);
    });

    it('handles non-2xx response with backend error payload', async () => {
      const errorPayload = {
        status: 400,
        error: 'Bad Request',
        message: 'Cannot schedule invalid DAG: Cyclic dependency',
        timestamp: '2026-10-18T00:00:00Z',
        details: ['Cyclic dependency: task-1 -> task-2 -> task-1'],
      };

      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(errorPayload), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/json' },
          })
        )
      );

      await expect(
        validateDag(mockRequest, { fetchFn: mockFetch })
      ).rejects.toThrow(FlowForgeApiError);

      try {
        await validateDag(mockRequest, { fetchFn: mockFetch });
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(400);
        expect(apiError.message).toBe('Cannot schedule invalid DAG: Cyclic dependency');
        expect(apiError.details).toEqual(['Cyclic dependency: task-1 -> task-2 -> task-1']);
        expect(apiError.errorBody?.status).toBe(400);
      }
    });

    it('handles non-2xx response with empty body gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('', {
          status: 502,
          statusText: 'Bad Gateway',
        })
      );

      try {
        await validateDag(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(502);
        expect(apiError.message).toContain('HTTP 502');
      }
    });

    it('handles non-2xx response with HTML or non-JSON body safely', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('<html><body>503 Service Unavailable</body></html>', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/html' },
        })
      );

      try {
        await validateDag(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(503);
        expect(apiError.message).toBe('HTTP 503: Service Unavailable');
      }
    });

    it('handles empty 200 OK response by throwing FlowForgeApiError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('', {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await validateDag(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(200);
        expect(apiError.message).toBe('Invalid JSON received from FlowForge server');
        expect(apiError.details).toEqual([]);
      }
    });

    it('handles malformed JSON 200 OK response by throwing FlowForgeApiError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('invalid-json-body', {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await validateDag(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(200);
        expect(apiError.message).toBe('Invalid JSON received from FlowForge server');
        expect(apiError.details).toEqual([]);
      }
    });

    it('sanitizes network failures without leaking raw error messages, IPs, or socket details', async () => {
      const sensitiveMessage = 'connect ECONNREFUSED 10.240.0.14:8080 at internal-gateway.corp';
      const mockFetch = vi.fn().mockRejectedValue(new Error(sensitiveMessage));

      try {
        await validateDag(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(0);
        expect(apiError.message).toBe('Network failure: Unable to connect to FlowForge server');
        expect(apiError.message).not.toContain('10.240.0.14');
        expect(apiError.message).not.toContain('8080');
        expect(apiError.message).not.toContain('internal-gateway.corp');
        expect(apiError.cause).toBeUndefined();
      }
    });
  });

  describe('executeWorkflow', () => {
    const mockRequest: ExecuteWorkflowRequest = {
      tasks: [
        {
          id: 'step-1',
          action: { type: 'DELAY', delayMs: 100 },
          retryPolicy: {
            maxAttempts: 3,
            backoffStrategy: 'FIXED',
            initialDelayMs: 50,
          },
        },
        {
          id: 'step-2',
          action: { type: 'NO_OP' },
        },
      ],
      edges: [{ source: 'step-1', target: 'step-2' }],
      concurrency: 2,
    };

    const mockResponse: ExecuteWorkflowResponse = {
      state: 'COMPLETED',
      startedAt: '2026-10-18T00:00:00Z',
      completedAt: '2026-10-18T00:00:01Z',
      durationMs: 1000,
      taskResults: {
        'step-1': {
          taskId: 'step-1',
          state: 'COMPLETED',
          startedAt: '2026-10-18T00:00:00Z',
          completedAt: '2026-10-18T00:00:00.500Z',
          durationMs: 500,
          attemptCount: 1,
          errorMessage: null,
          attemptErrors: [],
        },
        'step-2': {
          taskId: 'step-2',
          state: 'COMPLETED',
          startedAt: '2026-10-18T00:00:00.500Z',
          completedAt: '2026-10-18T00:00:01Z',
          durationMs: 500,
          attemptCount: 1,
          errorMessage: null,
          attemptErrors: [],
        },
      },
    };

    it('sends correct HTTP method, URL, headers, and serialized body', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await executeWorkflow(mockRequest, {
        baseUrl: 'http://localhost:8080',
        fetchFn: mockFetch,
      });

      expect(capturedUrl).toBe('http://localhost:8080/api/v1/workflows/execute');
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(JSON.parse(capturedInit?.body as string)).toEqual(mockRequest);
      expect(result).toEqual(mockResponse);
      expect(result.state).toBe('COMPLETED');
      expect(result.taskResults['step-1'].state).toBe('COMPLETED');
    });

    it('handles workflow execution failure (e.g. 504 Gateway Timeout)', async () => {
      const errorPayload = {
        status: 504,
        error: 'Gateway Timeout',
        message: 'Workflow execution exceeded maximum synchronous limit of 15 seconds',
        timestamp: '2026-10-18T00:00:15Z',
        details: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorPayload), {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await executeWorkflow(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(504);
        expect(apiError.message).toBe(
          'Workflow execution exceeded maximum synchronous limit of 15 seconds'
        );
      }
    });

    it('handles workflow execution capacity exhaustion (429 Too Many Requests)', async () => {
      const errorPayload = {
        status: 429,
        error: 'Too Many Requests',
        message:
          'Server workflow execution capacity is exhausted (max 4 concurrent workflows). Please retry shortly.',
        timestamp: '2026-10-18T00:00:00Z',
        details: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorPayload), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await executeWorkflow(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(429);
        expect(apiError.message).toContain('capacity is exhausted');
      }
    });

    it('handles empty 200 OK response by throwing FlowForgeApiError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('', {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await executeWorkflow(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(200);
        expect(apiError.message).toBe('Invalid JSON received from FlowForge server');
        expect(apiError.details).toEqual([]);
      }
    });

    it('handles malformed JSON 200 OK response by throwing FlowForgeApiError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{ truncated_json: ', {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await executeWorkflow(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(200);
        expect(apiError.message).toBe('Invalid JSON received from FlowForge server');
        expect(apiError.details).toEqual([]);
      }
    });

    it('sanitizes network failures without leaking internal IP addresses or host details', async () => {
      const sensitiveMessage =
        'TypeError: Failed to fetch https://192.168.1.100:8443/api/v1/workflows/execute socket hang up';
      const mockFetch = vi.fn().mockRejectedValue(new TypeError(sensitiveMessage));

      try {
        await executeWorkflow(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        const apiError = err as FlowForgeApiError;
        expect(apiError.status).toBe(0);
        expect(apiError.message).toBe('Network failure: Unable to connect to FlowForge server');
        expect(apiError.message).not.toContain('192.168.1.100');
        expect(apiError.message).not.toContain('8443');
        expect(apiError.message).not.toContain('socket hang up');
        expect(apiError.cause).toBeUndefined();
      }
    });
  });

  describe('Persistence API Client Methods', () => {
    describe('fetchProjects', () => {
      it('issues GET /projects with pagination and returns page payload', async () => {
        const mockPage = {
          content: [
            {
              id: 'p-1',
              name: 'Project 1',
              slug: 'project-1',
              description: 'Desc 1',
              createdAt: '2026-10-19T00:00:00Z',
              updatedAt: '2026-10-19T00:00:00Z',
            },
          ],
          totalElements: 1,
          totalPages: 1,
          size: 10,
          number: 0,
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockPage), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await fetchProjects({
          baseUrl: 'http://localhost:8080',
          page: 0,
          size: 10,
          fetchFn: mockFetch,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/projects?page=0&size=10',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toEqual(mockPage);
      });
    });

    describe('createProject', () => {
      it('issues POST /projects with request body and returns created project', async () => {
        const mockCreated = {
          id: 'p-new',
          name: 'Analytics Pipeline',
          slug: 'analytics-pipeline',
          description: 'Telemetry ingest',
          createdAt: '2026-10-19T10:00:00Z',
          updatedAt: '2026-10-19T10:00:00Z',
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockCreated), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await createProject(
          { name: 'Analytics Pipeline', description: 'Telemetry ingest' },
          { baseUrl: 'http://localhost:8080', fetchFn: mockFetch }
        );

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/projects',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Analytics Pipeline', description: 'Telemetry ingest' }),
          })
        );
        expect(result).toEqual(mockCreated);
      });
    });

    describe('getProject', () => {
      it('issues GET /projects/{id} and returns project response', async () => {
        const mockProject = {
          id: 'p-123',
          name: 'Single Project',
          slug: 'single-project',
          description: null,
          createdAt: '2026-10-19T10:00:00Z',
          updatedAt: '2026-10-19T10:00:00Z',
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockProject), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await getProject('p-123', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/projects/p-123',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toEqual(mockProject);
      });
    });

    describe('fetchWorkflows', () => {
      it('issues GET /projects/{projectId}/workflows with pagination', async () => {
        const mockPage = {
          content: [
            {
              id: 'wf-1',
              projectId: 'proj-1',
              name: 'Ingestion Workflow',
              slug: 'ingestion-workflow',
              description: 'Ingest events',
              createdAt: '2026-10-19T00:00:00Z',
              updatedAt: '2026-10-19T00:00:00Z',
            },
          ],
          totalElements: 1,
          totalPages: 1,
          size: 50,
          number: 0,
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockPage), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await fetchWorkflows('proj-1', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/projects/proj-1/workflows?page=0&size=100',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toEqual(mockPage);
      });
    });

    describe('createWorkflow', () => {
      it('issues POST /projects/{projectId}/workflows with body', async () => {
        const mockWf = {
          id: 'wf-created',
          projectId: 'proj-1',
          name: 'ETL Pipeline',
          slug: 'etl-pipeline',
          description: 'Nightly batch',
          createdAt: '2026-10-19T10:00:00Z',
          updatedAt: '2026-10-19T10:00:00Z',
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockWf), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await createWorkflow(
          'proj-1',
          { name: 'ETL Pipeline', description: 'Nightly batch' },
          { baseUrl: 'http://localhost:8080', fetchFn: mockFetch }
        );

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/projects/proj-1/workflows',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'ETL Pipeline', description: 'Nightly batch' }),
          })
        );
        expect(result).toEqual(mockWf);
      });
    });

    describe('fetchWorkflowVersions', () => {
      it('issues GET /workflows/{workflowId}/versions and returns summary page', async () => {
        const mockPage = {
          content: [
            {
              id: 'ver-1',
              workflowId: 'wf-1',
              versionNumber: 1,
              versionTag: 'v1.0',
              description: 'Initial',
              taskCount: 3,
              edgeCount: 2,
              isValidDag: true,
              createdAt: '2026-10-19T10:00:00Z',
            },
          ],
          totalElements: 1,
          totalPages: 1,
          size: 50,
          number: 0,
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockPage), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await fetchWorkflowVersions('wf-1', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/workflows/wf-1/versions?page=0&size=50',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toEqual(mockPage);
      });
    });

    describe('getLatestWorkflowVersion', () => {
      it('issues GET /workflows/{workflowId}/versions/latest and returns full version with graphPayload', async () => {
        const mockVersion = {
          id: 'ver-latest',
          workflowId: 'wf-1',
          versionNumber: 2,
          versionTag: 'v2.0',
          description: 'Latest snapshot',
          graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
          taskCount: 5,
          edgeCount: 4,
          isValidDag: true,
          createdAt: '2026-10-19T11:00:00Z',
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockVersion), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await getLatestWorkflowVersion('wf-1', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/workflows/wf-1/versions/latest',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toEqual(mockVersion);
      });
    });

    describe('createWorkflowVersion', () => {
      it('issues POST /workflows/{workflowId}/versions with payload and returns created version', async () => {
        const payload = {
          versionTag: 'v1.1',
          description: 'Draft save',
          graphPayload: { schemaVersion: 1, nodes: [], edges: [] },
        };

        const mockVersion = {
          id: 'ver-new',
          workflowId: 'wf-1',
          versionNumber: 3,
          versionTag: 'v1.1',
          description: 'Draft save',
          graphPayload: payload.graphPayload,
          taskCount: 4,
          edgeCount: 3,
          isValidDag: true,
          createdAt: '2026-10-19T12:00:00Z',
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockVersion), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await createWorkflowVersion('wf-1', payload, {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/v1/workflows/wf-1/versions',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(payload),
          })
        );
        expect(result).toEqual(mockVersion);
      });
    });
  });

  describe('Durable Run API Client Methods (Phase 1.4.1)', () => {
    const mockTaskRun1: TaskRunResponseDto = {
      id: 'task-run-1',
      taskId: 'step-a',
      status: 'COMPLETED',
      attemptCount: 1,
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:00:01Z',
      durationMs: 1000,
      errorMessage: null,
      createdAt: '2026-10-20T09:59:59Z',
    };

    const mockTaskRun2: TaskRunResponseDto = {
      id: 'task-run-2',
      taskId: 'step-b',
      status: 'FAILED',
      attemptCount: 2,
      startedAt: '2026-10-20T10:00:01Z',
      completedAt: '2026-10-20T10:00:02Z',
      durationMs: 1000,
      errorMessage: 'Simulated service failure',
      createdAt: '2026-10-20T09:59:59Z',
    };

    const mockWorkflowRunResponse: WorkflowRunResponseDto = {
      id: 'run-123',
      workflowId: 'wf-456',
      workflowVersionId: 'ver-789',
      versionNumber: 2,
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:00:02Z',
      durationMs: 2000,
      triggeredBy: 'manual-ui',
      createdAt: '2026-10-20T09:59:59Z',
      tasks: [mockTaskRun1],
    };

    const mockWorkflowRunSummary: WorkflowRunSummaryResponseDto = {
      id: 'run-123',
      workflowId: 'wf-456',
      workflowVersionId: 'ver-789',
      versionNumber: 2,
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:00:02Z',
      durationMs: 2000,
      triggeredBy: 'manual-ui',
      createdAt: '2026-10-20T09:59:59Z',
      taskCount: 3,
    };

    describe('executeWorkflowVersionRun', () => {
      it('issues POST /workflows/{workflowId}/runs with empty body when request is omitted, returning 201 Created', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify(mockWorkflowRunResponse), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await executeWorkflowVersionRun('wf-456', undefined, {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/workflows/wf-456/runs');
        expect(capturedInit?.method).toBe('POST');
        expect(capturedInit?.headers).toEqual({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        });
        expect(capturedInit?.body).toBe('{}');
        expect(result).toEqual(mockWorkflowRunResponse);
      });

      it('encodes special characters in workflowId path segment', async () => {
        let capturedUrl = '';
        const mockFetch = vi.fn().mockImplementation(async (url: string) => {
          capturedUrl = url;
          return new Response(JSON.stringify(mockWorkflowRunResponse), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        await executeWorkflowVersionRun('wf/special id?123', undefined, {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/workflows/wf%2Fspecial%20id%3F123/runs');
      });

      it('sends explicit versionNumber, triggeredBy, and concurrency in request payload', async () => {
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
          capturedInit = init;
          return new Response(JSON.stringify(mockWorkflowRunResponse), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const requestPayload: ExecuteRunRequest = {
          versionNumber: 3,
          triggeredBy: 'scheduler-cron',
          concurrency: 2,
        };

        const result = await executeWorkflowVersionRun('wf-456', requestPayload, {
          fetchFn: mockFetch,
        });

        expect(JSON.parse(capturedInit?.body as string)).toEqual(requestPayload);
        expect(result).toEqual(mockWorkflowRunResponse);
      });

      it('handles 404 Not Found error by throwing FlowForgeApiError with status and message', async () => {
        const errorBody = {
          status: 404,
          error: 'Not Found',
          message: 'Workflow not found: wf-missing',
          timestamp: '2026-10-20T10:00:00Z',
          details: [],
        };

        const mockFetch = vi.fn().mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify(errorBody), {
              status: 404,
              statusText: 'Not Found',
              headers: { 'Content-Type': 'application/json' },
            })
          )
        );

        await expect(
          executeWorkflowVersionRun('wf-missing', undefined, { fetchFn: mockFetch })
        ).rejects.toThrow(FlowForgeApiError);

        try {
          await executeWorkflowVersionRun('wf-missing', undefined, { fetchFn: mockFetch });
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe('Workflow not found: wf-missing');
          expect(apiErr.errorBody?.error).toBe('Not Found');
        }
      });

      it('handles 400 Bad Request error with validation details', async () => {
        const errorBody = {
          status: 400,
          error: 'Bad Request',
          message: 'Invalid request parameters',
          timestamp: '2026-10-20T10:00:00Z',
          details: ['concurrency: Concurrency must not exceed 4'],
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(errorBody), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/json' },
          })
        );

        try {
          await executeWorkflowVersionRun('wf-456', { concurrency: 10 }, { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(400);
          expect(apiErr.message).toBe('Invalid request parameters');
          expect(apiErr.details).toContain('concurrency: Concurrency must not exceed 4');
        }
      });

      it('handles 429 Too Many Requests capacity exhaustion error', async () => {
        const errorBody = {
          status: 429,
          error: 'Too Many Requests',
          message: 'Maximum concurrent workflow executions (4) reached. Capacity exhausted.',
          timestamp: '2026-10-20T10:00:00Z',
          details: [],
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(errorBody), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          })
        );

        try {
          await executeWorkflowVersionRun('wf-456', undefined, { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(429);
          expect(apiErr.message).toContain('Capacity exhausted');
        }
      });

      it('handles 504 Gateway Timeout error', async () => {
        const errorBody = {
          status: 504,
          error: 'Gateway Timeout',
          message: 'Workflow execution timed out after 30000ms',
          timestamp: '2026-10-20T10:00:00Z',
          details: [],
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(errorBody), {
            status: 504,
            statusText: 'Gateway Timeout',
            headers: { 'Content-Type': 'application/json' },
          })
        );

        try {
          await executeWorkflowVersionRun('wf-456', undefined, { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(504);
          expect(apiErr.message).toContain('timed out');
        }
      });

      it('sanitizes network failures to generic connection error with status 0', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

        try {
          await executeWorkflowVersionRun('wf-456', undefined, { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(0);
          expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
        }
      });
    });

    describe('fetchWorkflowRuns', () => {
      it('issues GET /workflows/{workflowId}/runs with default pagination (page=0, size=20)', async () => {
        const mockPage: PageResponse<WorkflowRunSummaryResponseDto> = {
          content: [mockWorkflowRunSummary],
          totalElements: 1,
          totalPages: 1,
          size: 20,
          number: 0,
        };

        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify(mockPage), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await fetchWorkflowRuns('wf-456', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/workflows/wf-456/runs?page=0&size=20');
        expect(capturedInit?.method).toBe('GET');
        expect(capturedInit?.headers).toEqual({ Accept: 'application/json' });
        expect(result).toEqual(mockPage);
      });

      it('issues GET with custom page and size query parameters', async () => {
        const mockPage: PageResponse<WorkflowRunSummaryResponseDto> = {
          content: [],
          totalElements: 100,
          totalPages: 2,
          size: 50,
          number: 1,
        };

        let capturedUrl = '';
        const mockFetch = vi.fn().mockImplementation(async (url: string) => {
          capturedUrl = url;
          return new Response(JSON.stringify(mockPage), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await fetchWorkflowRuns('wf-456', {
          page: 1,
          size: 50,
          fetchFn: mockFetch,
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/workflows/wf-456/runs?page=1&size=50');
        expect(result).toEqual(mockPage);
      });

      it('handles 404 when parent workflow does not exist', async () => {
        const errorBody = {
          status: 404,
          error: 'Not Found',
          message: 'Workflow not found: wf-not-found',
          timestamp: '2026-10-20T10:00:00Z',
          details: [],
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(errorBody), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        await expect(
          fetchWorkflowRuns('wf-not-found', { fetchFn: mockFetch })
        ).rejects.toThrow(FlowForgeApiError);
      });

      it('handles network failures with status 0', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

        try {
          await fetchWorkflowRuns('wf-456', { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(0);
          expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
        }
      });
    });

    describe('getWorkflowRun', () => {
      it('issues GET /runs/{runId} and returns detailed run response with tasks', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify(mockWorkflowRunResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await getWorkflowRun('run-123', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/runs/run-123');
        expect(capturedInit?.method).toBe('GET');
        expect(capturedInit?.headers).toEqual({ Accept: 'application/json' });
        expect(result).toEqual(mockWorkflowRunResponse);
        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].taskId).toBe('step-a');
      });

      it('encodes special characters in runId path segment', async () => {
        let capturedUrl = '';
        const mockFetch = vi.fn().mockImplementation(async (url: string) => {
          capturedUrl = url;
          return new Response(JSON.stringify(mockWorkflowRunResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        await getWorkflowRun('run/special#id', { fetchFn: mockFetch });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/runs/run%2Fspecial%23id');
      });

      it('handles 404 when runId does not exist', async () => {
        const errorBody = {
          status: 404,
          error: 'Not Found',
          message: 'Workflow run not found: run-missing',
          timestamp: '2026-10-20T10:00:00Z',
          details: [],
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(errorBody), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        try {
          await getWorkflowRun('run-missing', { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe('Workflow run not found: run-missing');
        }
      });

      it('handles network failure with status 0', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Connection reset'));

        try {
          await getWorkflowRun('run-123', { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(0);
          expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
        }
      });
    });

    describe('fetchTaskRuns', () => {
      it('issues GET /runs/{runId}/tasks and returns ordered task runs array', async () => {
        const mockTasks = [mockTaskRun1, mockTaskRun2];

        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify(mockTasks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await fetchTaskRuns('run-123', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/runs/run-123/tasks');
        expect(capturedInit?.method).toBe('GET');
        expect(capturedInit?.headers).toEqual({ Accept: 'application/json' });
        expect(result).toEqual(mockTasks);
        expect(result).toHaveLength(2);
        expect(result[0].taskId).toBe('step-a');
        expect(result[1].taskId).toBe('step-b');
        expect(result[1].errorMessage).toBe('Simulated service failure');
      });

      it('returns empty array when workflow run has no tasks executed', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const result = await fetchTaskRuns('run-empty', { fetchFn: mockFetch });

        expect(result).toEqual([]);
      });

      it('handles 404 when workflow run does not exist', async () => {
        const errorBody = {
          status: 404,
          error: 'Not Found',
          message: 'Workflow run not found: run-missing',
          timestamp: '2026-10-20T10:00:00Z',
          details: [],
        };

        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(errorBody), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        );

        try {
          await fetchTaskRuns('run-missing', { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe('Workflow run not found: run-missing');
        }
      });

      it('handles network failure with status 0', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Connection dropped'));

        try {
          await fetchTaskRuns('run-123', { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          const apiErr = err as FlowForgeApiError;
          expect(apiErr.status).toBe(0);
          expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
        }
      });
    });
  });

  describe('FlowForgeApiError status getters', () => {
    it('accurately identifies HTTP status codes via convenience getters', () => {
      const err401 = new FlowForgeApiError(401, 'Unauthorized');
      expect(err401.isUnauthorized).toBe(true);
      expect(err401.isConflict).toBe(false);
      expect(err401.isForbidden).toBe(false);
      expect(err401.isNotFound).toBe(false);

      const err409 = new FlowForgeApiError(409, 'Conflict');
      expect(err409.isUnauthorized).toBe(false);
      expect(err409.isConflict).toBe(true);

      const err403 = new FlowForgeApiError(403, 'Forbidden');
      expect(err403.isForbidden).toBe(true);

      const err404 = new FlowForgeApiError(404, 'Not Found');
      expect(err404.isNotFound).toBe(true);

      const err500 = new FlowForgeApiError(500, 'Server Error');
      expect(err500.isUnauthorized).toBe(false);
      expect(err500.isConflict).toBe(false);
      expect(err500.isForbidden).toBe(false);
      expect(err500.isNotFound).toBe(false);
    });
  });

  describe('setAuthTokenGetter and getAuthToken', () => {
    it('returns null by default when no getter is registered', () => {
      expect(getAuthToken()).toBeNull();
    });

    it('returns trimmed token from registered getter', () => {
      setAuthTokenGetter(() => '  jwt-token-xyz  ');
      expect(getAuthToken()).toBe('jwt-token-xyz');
    });

    it('returns null if getter returns null, undefined, or empty/whitespace string', () => {
      setAuthTokenGetter(() => null);
      expect(getAuthToken()).toBeNull();

      setAuthTokenGetter(() => undefined);
      expect(getAuthToken()).toBeNull();

      setAuthTokenGetter(() => '');
      expect(getAuthToken()).toBeNull();

      setAuthTokenGetter(() => '   ');
      expect(getAuthToken()).toBeNull();
    });

    it('clears registered getter when set to null', () => {
      setAuthTokenGetter(() => 'temp-token');
      expect(getAuthToken()).toBe('temp-token');

      setAuthTokenGetter(null);
      expect(getAuthToken()).toBeNull();
    });
  });

  describe('registerUser', () => {
    const mockRequest: RegisterRequest = {
      email: 'newuser@flowforge.dev',
      password: 'SecurePassword123!',
      fullName: 'New User',
    };

    const mockResponse: AuthResponseDto = {
      token: 'jwt-registration-token-abc',
      user: {
        id: 'user-uuid-1',
        email: 'newuser@flowforge.dev',
        fullName: 'New User',
        active: true,
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
    };

    it('sends POST /api/v1/auth/register with correct headers and serialized body', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify(mockResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await registerUser(mockRequest, {
        baseUrl: 'http://localhost:8080',
        fetchFn: mockFetch,
      });

      expect(capturedUrl).toBe('http://localhost:8080/api/v1/auth/register');
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(JSON.parse(capturedInit?.body as string)).toEqual(mockRequest);
      expect(result).toEqual(mockResponse);
    });

    it('does NOT attach Authorization header even if auth token getter or options.token is set', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'global-secret-token');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify(mockResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await registerUser(mockRequest, {
        fetchFn: mockFetch,
        token: 'override-secret-token',
      });

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    });

    it('propagates 409 Conflict with status and error details on duplicate email', async () => {
      const errorBody = {
        status: 409,
        error: 'Conflict',
        message: 'User with email newuser@flowforge.dev already exists',
        timestamp: '2026-10-20T10:00:00Z',
        details: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await registerUser(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(409);
        expect(apiErr.isConflict).toBe(true);
        expect(apiErr.isUnauthorized).toBe(false);
        expect(apiErr.message).toBe('User with email newuser@flowforge.dev already exists');
        expect(apiErr.errorBody?.status).toBe(409);
      }
    });

    it('propagates 400 Bad Request with validation details', async () => {
      const errorBody = {
        status: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        timestamp: '2026-10-20T10:00:00Z',
        details: ['Email must be valid', 'Password must be between 8 and 100 characters'],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await registerUser(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toBe('Validation failed');
        expect(apiErr.details).toEqual([
          'Email must be valid',
          'Password must be between 8 and 100 characters',
        ]);
      }
    });

    it('handles network failure with status 0', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      try {
        await registerUser(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
      }
    });
  });

  describe('loginUser', () => {
    const mockRequest: LoginRequest = {
      email: 'user@flowforge.dev',
      password: 'SecretPassword123!',
    };

    const mockResponse: AuthResponseDto = {
      token: 'jwt-login-token-xyz',
      user: {
        id: 'user-uuid-2',
        email: 'user@flowforge.dev',
        fullName: 'Existing User',
        active: true,
        createdAt: '2026-10-20T08:00:00Z',
        updatedAt: '2026-10-20T08:00:00Z',
      },
    };

    it('sends POST /api/v1/auth/login with correct headers and serialized body', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await loginUser(mockRequest, {
        baseUrl: 'http://localhost:8080',
        fetchFn: mockFetch,
      });

      expect(capturedUrl).toBe('http://localhost:8080/api/v1/auth/login');
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(JSON.parse(capturedInit?.body as string)).toEqual(mockRequest);
      expect(result).toEqual(mockResponse);
    });

    it('does NOT attach Authorization header even if auth token getter or options.token is set', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'stale-token');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await loginUser(mockRequest, {
        fetchFn: mockFetch,
        token: 'another-token',
      });

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    });

    it('propagates 401 Unauthorized with status and message on invalid credentials', async () => {
      const errorBody = {
        status: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
        timestamp: '2026-10-20T10:00:00Z',
        details: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await loginUser(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.isUnauthorized).toBe(true);
        expect(apiErr.isConflict).toBe(false);
        expect(apiErr.message).toBe('Invalid email or password');
        expect(apiErr.errorBody?.status).toBe(401);
      }
    });

    it('propagates 400 Bad Request with validation message', async () => {
      const errorBody = {
        status: 400,
        error: 'Bad Request',
        message: 'Email is required',
        timestamp: '2026-10-20T10:00:00Z',
        details: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await loginUser(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toBe('Email is required');
      }
    });

    it('handles network failure with status 0', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection reset'));

      try {
        await loginUser(mockRequest, { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
      }
    });
  });

  describe('getCurrentUser', () => {
    const mockUser: UserResponseDto = {
      id: 'user-uuid-3',
      email: 'current@flowforge.dev',
      fullName: 'Current Authenticated User',
      active: true,
      createdAt: '2026-10-15T12:00:00Z',
      updatedAt: '2026-10-20T12:00:00Z',
    };

    it('sends GET /api/v1/auth/me with Authorization: Bearer <token> when options.token is passed', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await getCurrentUser({
        baseUrl: 'http://localhost:8080',
        fetchFn: mockFetch,
        token: 'direct-token-123',
      });

      expect(capturedUrl).toBe('http://localhost:8080/api/v1/auth/me');
      expect(capturedInit?.method).toBe('GET');
      expect(capturedInit?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer direct-token-123',
      });
      expect(result).toEqual(mockUser);
    });

    it('sends GET /api/v1/auth/me with Authorization from setAuthTokenGetter when options.token is omitted', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'getter-token-456');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await getCurrentUser({ fetchFn: mockFetch });

      expect(capturedInit?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer getter-token-456',
      });
      expect(result).toEqual(mockUser);
    });

    it('sends request without Authorization header when no token is present', async () => {
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await getCurrentUser({ fetchFn: mockFetch });

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers).toEqual({
        Accept: 'application/json',
      });
    });

    it('propagates 401 Unauthorized when token is rejected by server with JSON error body', async () => {
      const errorBody = {
        status: 401,
        error: 'Unauthorized',
        message: 'JWT token has expired',
        timestamp: '2026-10-20T10:00:00Z',
        details: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await getCurrentUser({ fetchFn: mockFetch, token: 'expired-token' });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.isUnauthorized).toBe(true);
        expect(apiErr.message).toBe('JWT token has expired');
        expect(apiErr.errorBody?.status).toBe(401);
      }
    });

    it('propagates 401 Unauthorized even when server returns empty body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('', {
          status: 401,
          statusText: 'Unauthorized',
        })
      );

      try {
        await getCurrentUser({ fetchFn: mockFetch, token: 'bad-token' });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.isUnauthorized).toBe(true);
        expect(apiErr.message).toContain('401');
      }
    });

    it('handles network failure with status 0', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      try {
        await getCurrentUser({ fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        const apiErr = err as FlowForgeApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.message).toBe('Network failure: Unable to connect to FlowForge server');
      }
    });
  });

  describe('Bearer token attachment on protected API endpoints', () => {
    it('attaches Authorization header to fetchProjects when options.token is provided', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({ content: [], totalElements: 0, totalPages: 0, size: 10, number: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await fetchProjects({ fetchFn: mockFetch, token: 'my-project-token' });

      expect(capturedInit?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer my-project-token',
      });
    });

    it('attaches Authorization header to fetchProjects from global setAuthTokenGetter', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'global-context-token');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({ content: [], totalElements: 0, totalPages: 0, size: 10, number: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await fetchProjects({ fetchFn: mockFetch });

      expect(capturedInit?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer global-context-token',
      });
    });

    it('options.token override takes precedence over global setAuthTokenGetter', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'global-token');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({ content: [], totalElements: 0, totalPages: 0, size: 10, number: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await fetchProjects({ fetchFn: mockFetch, token: 'override-token' });

      expect(capturedInit?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer override-token',
      });
    });

    it('options.token: null explicitly suppresses Authorization header even if global getter exists', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'global-token');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({ content: [], totalElements: 0, totalPages: 0, size: 10, number: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await fetchProjects({ fetchFn: mockFetch, token: null });

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers).toEqual({
        Accept: 'application/json',
      });
    });

    it('attaches Authorization alongside Content-Type for POST requests like createWorkflow', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            id: 'wf-1',
            projectId: 'p-1',
            name: 'WF',
            slug: 'wf',
            description: null,
            createdAt: '2026-10-20T10:00:00Z',
            updatedAt: '2026-10-20T10:00:00Z',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await createWorkflow(
        'proj-123',
        { name: 'Workflow One' },
        { fetchFn: mockFetch, token: 'post-token-999' }
      );

      expect(capturedInit?.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer post-token-999',
      });
    });

    it('does NOT attach Authorization header to validateDag even if token is configured', async () => {
      let capturedInit: RequestInit | undefined;
      setAuthTokenGetter(() => 'active-user-token');

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            isValid: true,
            hasCycle: false,
            errors: [],
            warnings: [],
            cycleNodes: [],
            disconnectedNodes: [],
            topologicalOrder: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await validateDag(
        { taskIds: ['t1'], edges: [] },
        { fetchFn: mockFetch, token: 'extra-token' }
      );

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    });
  });

  describe('Auth API method aliases', () => {
    it('aliases register, login, and getMe reference their primary implementations', () => {
      expect(register).toBe(registerUser);
      expect(login).toBe(loginUser);
      expect(getMe).toBe(getCurrentUser);
    });
  });

  describe('deleteProject (Phase 1.5.5)', () => {
    it('sends DELETE /api/v1/projects/{projectId} with Authorization header and handles 204 No Content', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(null, { status: 204 });
      });

      await deleteProject('proj-uuid-1', {
        baseUrl: 'http://localhost:8080',
        fetchFn: mockFetch,
        token: 'admin-token',
      });

      expect(capturedUrl).toBe('http://localhost:8080/api/v1/projects/proj-uuid-1');
      expect(capturedInit?.method).toBe('DELETE');
      expect(capturedInit?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer admin-token',
      });
    });

    it('propagates 409 Conflict when project has dependent workflows', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 409,
            error: 'Conflict',
            message: 'Cannot delete project because dependent workflows exist',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        deleteProject('proj-uuid-1', { baseUrl: 'http://localhost:8080', fetchFn: mockFetch })
      ).rejects.toThrow('Cannot delete project because dependent workflows exist');
    });

    it('propagates 403 Forbidden when user is not an administrator', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 403,
            error: 'Forbidden',
            message: 'User role DEVELOPER is not permitted to perform administrative operations',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        deleteProject('proj-uuid-1', { baseUrl: 'http://localhost:8080', fetchFn: mockFetch })
      ).rejects.toThrow('User role DEVELOPER is not permitted');
    });

    it('handles network failure with status 0', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      try {
        await deleteProject('proj-uuid-1', { fetchFn: mockFetch });
        expect.unreachable('Should have thrown FlowForgeApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FlowForgeApiError);
        expect((err as FlowForgeApiError).status).toBe(0);
      }
    });
  });

  describe('Project Membership API Client Methods (Phase 1.5.5)', () => {
    const mockMembers: ProjectMemberResponseDto[] = [
      {
        id: 'pm-1',
        projectId: 'proj-1',
        userId: 'u-1',
        email: 'admin@flowforge.io',
        fullName: 'Admin User',
        role: 'ADMIN',
        createdAt: '2026-10-20T10:00:00Z',
      },
      {
        id: 'pm-2',
        projectId: 'proj-1',
        userId: 'u-2',
        email: 'dev@flowforge.io',
        fullName: 'Dev User',
        role: 'DEVELOPER',
        createdAt: '2026-10-20T11:00:00Z',
      },
    ];

    describe('fetchProjectMembers', () => {
      it('sends GET /api/v1/projects/{projectId}/members with Authorization header', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify(mockMembers), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await fetchProjectMembers('proj-1', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
          token: 'auth-token',
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/projects/proj-1/members');
        expect(capturedInit?.method).toBe('GET');
        expect(capturedInit?.headers).toEqual({
          Accept: 'application/json',
          Authorization: 'Bearer auth-token',
        });
        expect(result).toEqual(mockMembers);
      });

      it('propagates 404 Not Found when non-member probes private project (anti-leakage)', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ status: 404, error: 'Not Found', message: 'Project not found: proj-1' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          )
        );

        await expect(
          fetchProjectMembers('proj-1', { baseUrl: 'http://localhost:8080', fetchFn: mockFetch })
        ).rejects.toThrow('Project not found: proj-1');
      });

      it('propagates 401 Unauthorized when session is unauthenticated', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ status: 401, error: 'Unauthorized', message: 'Full authentication is required' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        );

        await expect(
          fetchProjectMembers('proj-1', { baseUrl: 'http://localhost:8080', fetchFn: mockFetch })
        ).rejects.toThrow('Full authentication is required');
      });
    });

    describe('addOrUpdateProjectMember', () => {
      it('sends POST /api/v1/projects/{projectId}/members with serialized payload and receives 201 Created', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const request: AddProjectMemberRequest = {
          email: 'newbie@flowforge.io',
          role: 'DEVELOPER',
        };

        const createdMember: ProjectMemberResponseDto = {
          id: 'pm-new',
          projectId: 'proj-1',
          userId: 'u-3',
          email: 'newbie@flowforge.io',
          fullName: 'Newbie User',
          role: 'DEVELOPER',
          createdAt: '2026-10-21T09:00:00Z',
        };

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify(createdMember), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const result = await addOrUpdateProjectMember('proj-1', request, {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
          token: 'admin-token',
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/projects/proj-1/members');
        expect(capturedInit?.method).toBe('POST');
        expect(capturedInit?.headers).toEqual({
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer admin-token',
        });
        expect(JSON.parse(capturedInit?.body as string)).toEqual(request);
        expect(result).toEqual(createdMember);
      });

      it('propagates 400 Bad Request when attempting to demote the sole administrator', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: 400,
              error: 'Bad Request',
              message: 'Cannot demote the only administrator of the project',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        );

        await expect(
          addOrUpdateProjectMember(
            'proj-1',
            { userId: 'u-1', role: 'VIEWER' },
            { baseUrl: 'http://localhost:8080', fetchFn: mockFetch }
          )
        ).rejects.toThrow('Cannot demote the only administrator of the project');
      });

      it('propagates 403 Forbidden when caller is not an administrator', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: 403,
              error: 'Forbidden',
              message: 'User role DEVELOPER is not permitted to perform administrative operations',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          )
        );

        await expect(
          addOrUpdateProjectMember(
            'proj-1',
            { email: 'dev@flowforge.io', role: 'VIEWER' },
            { baseUrl: 'http://localhost:8080', fetchFn: mockFetch }
          )
        ).rejects.toThrow('User role DEVELOPER is not permitted');
      });
    });

    describe('removeProjectMember', () => {
      it('sends DELETE /api/v1/projects/{projectId}/members/{userId} and handles 204 No Content', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;

        const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(null, { status: 204 });
        });

        await removeProjectMember('proj-1', 'u-2', {
          baseUrl: 'http://localhost:8080',
          fetchFn: mockFetch,
          token: 'admin-token',
        });

        expect(capturedUrl).toBe('http://localhost:8080/api/v1/projects/proj-1/members/u-2');
        expect(capturedInit?.method).toBe('DELETE');
        expect(capturedInit?.headers).toEqual({
          Accept: 'application/json',
          Authorization: 'Bearer admin-token',
        });
      });

      it('propagates 400 Bad Request when attempting to remove the only remaining administrator', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: 400,
              error: 'Bad Request',
              message: 'Cannot remove the only administrator of the project',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        );

        await expect(
          removeProjectMember('proj-1', 'u-1', {
            baseUrl: 'http://localhost:8080',
            fetchFn: mockFetch,
          })
        ).rejects.toThrow('Cannot remove the only administrator of the project');
      });

      it('handles network failure with status 0', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Connection lost'));

        try {
          await removeProjectMember('proj-1', 'u-2', { fetchFn: mockFetch });
          expect.unreachable('Should have thrown FlowForgeApiError');
        } catch (err) {
          expect(err).toBeInstanceOf(FlowForgeApiError);
          expect((err as FlowForgeApiError).status).toBe(0);
        }
      });
    });
  });
});
