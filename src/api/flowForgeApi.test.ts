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
} from './flowForgeApi';
import type {
  ValidateDagRequest,
  ValidateDagResponse,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
} from '../types';

describe('flowForgeApi', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
});
