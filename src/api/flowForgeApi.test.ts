import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateDag,
  executeWorkflow,
  resolveApiRoot,
  FlowForgeApiError,
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
});
