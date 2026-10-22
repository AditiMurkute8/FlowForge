import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AuthSessionManager,
  sessionStorageAuthStorage,
  useAuth,
  AuthProvider,
  type AuthTokenStorage,
} from './AuthContext';
import { FlowForgeApiError, getAuthToken, setAuthTokenGetter } from '../api/flowForgeApi';
import type {
  UserResponseDto,
  AuthResponseDto,
  LoginRequest,
  RegisterRequest,
} from '../types';

describe('AuthContext & AuthSessionManager', () => {
  const mockUser: UserResponseDto = {
    id: 'user-uuid-1',
    email: 'alice@flowforge.dev',
    fullName: 'Alice Engineer',
    active: true,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
  };

  const mockAuthResponse: AuthResponseDto = {
    token: 'jwt-token-alpha-123',
    user: mockUser,
  };

  function createMockStorage(initialToken: string | null = null): AuthTokenStorage {
    let token = initialToken;
    return {
      getToken: vi.fn(() => token),
      setToken: vi.fn((newToken: string) => {
        token = newToken;
      }),
      clearToken: vi.fn(() => {
        token = null;
      }),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    setAuthTokenGetter(null);
  });

  afterEach(() => {
    setAuthTokenGetter(null);
  });

  describe('sessionStorageAuthStorage helper', () => {
    it('interacts safely with window.sessionStorage when available', () => {
      const mockStorageMap = new Map<string, string>();
      const originalWindow = globalThis.window;

      // Provide a mock window.sessionStorage
      const mockWindow = {
        sessionStorage: {
          getItem: vi.fn((key: string) => mockStorageMap.get(key) ?? null),
          setItem: vi.fn((key: string, val: string) => {
            mockStorageMap.set(key, val);
          }),
          removeItem: vi.fn((key: string) => {
            mockStorageMap.delete(key);
          }),
        },
      };

      // @ts-expect-error mocking global window in test
      globalThis.window = mockWindow;

      try {
        expect(sessionStorageAuthStorage.getToken()).toBeNull();

        sessionStorageAuthStorage.setToken('test-session-jwt');
        expect(mockWindow.sessionStorage.setItem).toHaveBeenCalledWith(
          'flowforge_session_token',
          'test-session-jwt'
        );
        expect(sessionStorageAuthStorage.getToken()).toBe('test-session-jwt');

        sessionStorageAuthStorage.clearToken();
        expect(mockWindow.sessionStorage.removeItem).toHaveBeenCalledWith('flowforge_session_token');
        expect(sessionStorageAuthStorage.getToken()).toBeNull();
      } finally {
        globalThis.window = originalWindow;
      }
    });

    it('gracefully handles missing window in non-browser environments', () => {
      expect(sessionStorageAuthStorage.getToken()).toBeNull();
      expect(() => sessionStorageAuthStorage.setToken('abc')).not.toThrow();
      expect(() => sessionStorageAuthStorage.clearToken()).not.toThrow();
    });
  });

  describe('AuthSessionManager — Initial State & Initialization', () => {
    it('starts unauthenticated with isLoading: false when storage has no token', async () => {
      const storage = createMockStorage(null);
      const getCurrentUserFn = vi.fn();

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      const initialSnapshot = manager.getSnapshot();

      expect(initialSnapshot.token).toBeNull();
      expect(initialSnapshot.user).toBeNull();
      expect(initialSnapshot.isAuthenticated).toBe(false);
      expect(initialSnapshot.isLoading).toBe(false);
      expect(initialSnapshot.isInitializing).toBe(false);

      await manager.initialize();
      expect(getCurrentUserFn).not.toHaveBeenCalled();

      const postInitSnapshot = manager.getSnapshot();
      expect(postInitSnapshot.isAuthenticated).toBe(false);
      expect(postInitSnapshot.isLoading).toBe(false);
      expect(postInitSnapshot.isInitializing).toBe(false);
    });

    it('restores stored token and validates it with getCurrentUser', async () => {
      const storage = createMockStorage('stored-valid-token');
      const getCurrentUserFn = vi.fn().mockResolvedValue(mockUser);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      expect(manager.getSnapshot().token).toBe('stored-valid-token');
      expect(manager.getSnapshot().isInitializing).toBe(true);

      await manager.initialize();

      expect(getCurrentUserFn).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'stored-valid-token' })
      );

      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(true);
      expect(snapshot.user).toEqual(mockUser);
      expect(snapshot.token).toBe('stored-valid-token');
      expect(snapshot.isLoading).toBe(false);
      expect(snapshot.isInitializing).toBe(false);
      expect(snapshot.error).toBeNull();
    });

    it('does not re-run validation if already initialized', async () => {
      const storage = createMockStorage('stored-token');
      const getCurrentUserFn = vi.fn().mockResolvedValue(mockUser);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      await manager.initialize();
      expect(getCurrentUserFn).toHaveBeenCalledTimes(1);

      await manager.initialize();
      expect(getCurrentUserFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('AuthSessionManager — Expired & Invalid Token Handling (401)', () => {
    it('purges session and clears storage when token validation returns 401', async () => {
      const storage = createMockStorage('expired-jwt-token');
      const apiErr = new FlowForgeApiError(401, 'JWT token has expired');
      const getCurrentUserFn = vi.fn().mockRejectedValue(apiErr);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      await manager.initialize();

      expect(storage.clearToken).toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.token).toBeNull();
      expect(snapshot.user).toBeNull();
      expect(snapshot.isLoading).toBe(false);
      expect(snapshot.isInitializing).toBe(false);
    });
  });

  describe('AuthSessionManager — Network Failure on Initialization', () => {
    it('does NOT clear stored token when backend is temporarily unreachable', async () => {
      const storage = createMockStorage('valid-token-offline');
      const networkErr = new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
      const getCurrentUserFn = vi.fn().mockRejectedValue(networkErr);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      await manager.initialize();

      // Token must NOT be deleted from storage during network outage
      expect(storage.clearToken).not.toHaveBeenCalled();

      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.token).toBe('valid-token-offline');
      expect(snapshot.user).toBeNull();
      expect(snapshot.isLoading).toBe(false);
      expect(snapshot.isInitializing).toBe(false);
      expect(snapshot.error).toBe('Network failure: Unable to connect to FlowForge server');
    });

    it('does NOT clear stored token when backend returns 500 server error', async () => {
      const storage = createMockStorage('valid-token-server-down');
      const serverErr = new FlowForgeApiError(500, 'Internal Server Error');
      const getCurrentUserFn = vi.fn().mockRejectedValue(serverErr);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      await manager.initialize();

      expect(storage.clearToken).not.toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.token).toBe('valid-token-server-down');
      expect(snapshot.error).toBe('Internal Server Error');
    });
  });

  describe('AuthSessionManager — Login & Registration', () => {
    it('successfully logs in, saves token, and sets authenticated user state', async () => {
      const storage = createMockStorage(null);
      const loginFn = vi.fn().mockResolvedValue(mockAuthResponse);

      const manager = new AuthSessionManager({ storage, loginFn });
      const credentials: LoginRequest = { email: 'alice@flowforge.dev', password: 'Password123!' };

      const result = await manager.login(credentials);

      expect(result).toEqual(mockAuthResponse);
      expect(storage.setToken).toHaveBeenCalledWith('jwt-token-alpha-123');

      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(true);
      expect(snapshot.token).toBe('jwt-token-alpha-123');
      expect(snapshot.user).toEqual(mockUser);
      expect(snapshot.isLoading).toBe(false);
      expect(snapshot.error).toBeNull();
    });

    it('handles login failure (401), sets sanitized error, and preserves unauthenticated state', async () => {
      const storage = createMockStorage(null);
      const loginErr = new FlowForgeApiError(401, 'Invalid email or password');
      const loginFn = vi.fn().mockRejectedValue(loginErr);

      const manager = new AuthSessionManager({ storage, loginFn });
      const credentials: LoginRequest = { email: 'alice@flowforge.dev', password: 'WrongPassword' };

      await expect(manager.login(credentials)).rejects.toThrow('Invalid email or password');

      expect(storage.setToken).not.toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.token).toBeNull();
      expect(snapshot.user).toBeNull();
      expect(snapshot.isLoading).toBe(false);
      expect(snapshot.error).toBe('Invalid email or password');
    });

    it('successfully registers, saves token, and sets authenticated state', async () => {
      const storage = createMockStorage(null);
      const registerFn = vi.fn().mockResolvedValue(mockAuthResponse);

      const manager = new AuthSessionManager({ storage, registerFn });
      const payload: RegisterRequest = {
        email: 'alice@flowforge.dev',
        password: 'Password123!',
        fullName: 'Alice Engineer',
      };

      const result = await manager.register(payload);

      expect(result).toEqual(mockAuthResponse);
      expect(storage.setToken).toHaveBeenCalledWith('jwt-token-alpha-123');

      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(true);
      expect(snapshot.token).toBe('jwt-token-alpha-123');
      expect(snapshot.user).toEqual(mockUser);
      expect(snapshot.isLoading).toBe(false);
    });

    it('handles registration conflict (409) and exposes error', async () => {
      const storage = createMockStorage(null);
      const conflictErr = new FlowForgeApiError(409, 'User with email alice@flowforge.dev already exists');
      const registerFn = vi.fn().mockRejectedValue(conflictErr);

      const manager = new AuthSessionManager({ storage, registerFn });
      const payload: RegisterRequest = {
        email: 'alice@flowforge.dev',
        password: 'Password123!',
        fullName: 'Alice Engineer',
      };

      await expect(manager.register(payload)).rejects.toThrow('already exists');

      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.error).toBe('User with email alice@flowforge.dev already exists');
    });
  });

  describe('AuthSessionManager — Logout', () => {
    it('clears storage, user, token, and authentication status', async () => {
      const storage = createMockStorage('active-token');
      const getCurrentUserFn = vi.fn().mockResolvedValue(mockUser);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      await manager.initialize();
      expect(manager.getSnapshot().isAuthenticated).toBe(true);

      manager.logout();

      expect(storage.clearToken).toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.token).toBeNull();
      expect(snapshot.user).toBeNull();
      expect(snapshot.isLoading).toBe(false);
      expect(snapshot.error).toBeNull();
    });
  });

  describe('AuthSessionManager — Race Condition Prevention', () => {
    it('discards delayed validation response if user logs out before it completes', async () => {
      const storage = createMockStorage('initial-token');
      let resolveValidation!: (user: UserResponseDto) => void;
      const delayedPromise = new Promise<UserResponseDto>((resolve) => {
        resolveValidation = resolve;
      });

      const getCurrentUserFn = vi.fn().mockReturnValue(delayedPromise);
      const manager = new AuthSessionManager({ storage, getCurrentUserFn });

      const initPromise = manager.initialize();

      // User clicks logout while initialization validation is in flight
      manager.logout();

      // Validation finally finishes
      resolveValidation(mockUser);
      await initPromise;

      // User must remain logged out!
      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.user).toBeNull();
      expect(snapshot.token).toBeNull();
    });

    it('discards delayed login response if user logs out before login returns', async () => {
      const storage = createMockStorage(null);
      let resolveLogin!: (res: AuthResponseDto) => void;
      const delayedLoginPromise = new Promise<AuthResponseDto>((resolve) => {
        resolveLogin = resolve;
      });

      const loginFn = vi.fn().mockReturnValue(delayedLoginPromise);
      const manager = new AuthSessionManager({ storage, loginFn });

      const loginPromise = manager.login({ email: 'a@b.com', password: 'pw' });

      // User clicks logout before login resolves
      manager.logout();

      resolveLogin(mockAuthResponse);
      await loginPromise;

      const snapshot = manager.getSnapshot();
      expect(snapshot.isAuthenticated).toBe(false);
      expect(snapshot.token).toBeNull();
      expect(snapshot.user).toBeNull();
    });

    it('supersedes slow initial validation with a fast new login', async () => {
      const storage = createMockStorage('old-token');
      let resolveSlowValidation!: (user: UserResponseDto) => void;
      const slowPromise = new Promise<UserResponseDto>((resolve) => {
        resolveSlowValidation = resolve;
      });

      const getCurrentUserFn = vi.fn().mockReturnValue(slowPromise);
      const newAuthResponse: AuthResponseDto = {
        token: 'brand-new-token',
        user: { ...mockUser, id: 'brand-new-user' },
      };
      const loginFn = vi.fn().mockResolvedValue(newAuthResponse);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn, loginFn });

      const initPromise = manager.initialize();

      // User immediately performs a login
      await manager.login({ email: 'new@b.com', password: 'pw' });
      expect(manager.getSnapshot().token).toBe('brand-new-token');
      expect(manager.getSnapshot().user?.id).toBe('brand-new-user');

      // Slow validation for old-token finally resolves
      resolveSlowValidation({ ...mockUser, id: 'old-user-profile' });
      await initPromise;

      // Old validation result must NOT overwrite the new login!
      expect(manager.getSnapshot().token).toBe('brand-new-token');
      expect(manager.getSnapshot().user?.id).toBe('brand-new-user');
    });
  });

  describe('AuthSessionManager — setAuthTokenGetter Integration', () => {
    it('connects active session token to the API client token getter', async () => {
      const storage = createMockStorage(null);
      const loginFn = vi.fn().mockResolvedValue(mockAuthResponse);

      const manager = new AuthSessionManager({ storage, loginFn });
      expect(getAuthToken()).toBeNull();

      await manager.login({ email: 'alice@flowforge.dev', password: 'Password123!' });
      expect(getAuthToken()).toBe('jwt-token-alpha-123');

      manager.logout();
      expect(getAuthToken()).toBeNull();

      manager.dispose();
      expect(getAuthToken()).toBeNull();
    });
  });

  describe('Security — Credential & Token Protection', () => {
    it('does not leak passwords or raw tokens into error state', async () => {
      const storage = createMockStorage(null);
      const errorWithCredential = new FlowForgeApiError(400, 'Bad Request: invalid syntax');
      const loginFn = vi.fn().mockRejectedValue(errorWithCredential);

      const manager = new AuthSessionManager({ storage, loginFn });

      try {
        await manager.login({ email: 'alice@flowforge.dev', password: 'SuperSecretPassword999!' });
      } catch {
        // Expected
      }

      const snapshot = manager.getSnapshot();
      expect(snapshot.error).toBe('Bad Request: invalid syntax');
      expect(snapshot.error).not.toContain('SuperSecretPassword999!');
    });
  });

  describe('useAuth Hook behavior', () => {
    it('throws when useAuth is invoked outside of an AuthProvider (null context)', () => {
      // @ts-expect-error accessing React internals to simulate hook dispatcher in Node test runner
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const prevH = internals?.H;
      if (internals) {
        internals.H = { useContext: () => null };
      }

      try {
        expect(() => useAuth()).toThrow('useAuth must be used within an AuthProvider');
      } finally {
        if (internals) {
          internals.H = prevH;
        }
      }
    });

    it('returns context value when invoked within an AuthProvider', () => {
      const mockValue = {
        user: mockUser,
        token: 'token-123',
        isAuthenticated: true,
        isLoading: false,
        isInitializing: false,
        error: null,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
      };

      // @ts-expect-error accessing React internals to simulate hook dispatcher in Node test runner
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const prevH = internals?.H;
      if (internals) {
        internals.H = { useContext: () => mockValue };
      }

      try {
        expect(useAuth()).toEqual(mockValue);
      } finally {
        if (internals) {
          internals.H = prevH;
        }
      }
    });

    it('exports AuthProvider as a valid React component', () => {
      expect(AuthProvider).toBeDefined();
      expect(typeof AuthProvider).toBe('function');
    });

    it('reproduces and resolves StrictMode double-mount lifecycle: in-flight initialize resolves and isInitializing settles to false', async () => {
      const storage = createMockStorage('jwt-existing-session');
      let resolveUser: (val: UserResponseDto) => void;
      const delayedUser = new Promise<UserResponseDto>((resolve) => {
        resolveUser = resolve;
      });
      const getCurrentUserFn = vi.fn().mockReturnValue(delayedUser);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });

      // Mount 1 starts initialize
      const initPromise1 = manager.initialize();

      // StrictMode simulates unmount: cleanup runs dispose()
      manager.dispose();

      // StrictMode simulates remount: reconnects and calls initialize()
      manager.connectTokenGetter();
      const initPromise2 = manager.initialize();

      // Repeated initialize() calls return the cached in-flight promise
      expect(initPromise2).toBe(initPromise1);

      // Delayed network response returns HTTP 200
      resolveUser!(mockUser);
      await Promise.all([initPromise1, initPromise2]);

      const snapshot = manager.getSnapshot();
      expect(snapshot.isInitializing).toBe(false);
      expect(snapshot.isAuthenticated).toBe(true);
      expect(snapshot.user).toEqual(mockUser);
    });

    it('settles isInitializing to false when in-flight initialize rejects under StrictMode double-mount lifecycle (401 & 500)', async () => {
      // Case 1: 401 Unauthorized
      const storage401 = createMockStorage('jwt-expired-session');
      let reject401!: (err: unknown) => void;
      const delayed401 = new Promise<UserResponseDto>((_, reject) => {
        reject401 = reject;
      });
      const getCurrentUserFn401 = vi.fn().mockReturnValue(delayed401);

      const manager401 = new AuthSessionManager({ storage: storage401, getCurrentUserFn: getCurrentUserFn401 });
      const init1 = manager401.initialize();
      manager401.dispose();
      manager401.connectTokenGetter();
      const init2 = manager401.initialize();

      reject401(new FlowForgeApiError(401, 'Unauthorized token'));
      await Promise.all([init1, init2]);

      const snapshot401 = manager401.getSnapshot();
      expect(snapshot401.isInitializing).toBe(false);
      expect(snapshot401.isAuthenticated).toBe(false);
      expect(snapshot401.token).toBeNull();
      expect(storage401.clearToken).toHaveBeenCalled();

      // Case 2: 500 Server / Network Error
      const storage500 = createMockStorage('jwt-server-down');
      let reject500!: (err: unknown) => void;
      const delayed500 = new Promise<UserResponseDto>((_, reject) => {
        reject500 = reject;
      });
      const getCurrentUserFn500 = vi.fn().mockReturnValue(delayed500);

      const manager500 = new AuthSessionManager({ storage: storage500, getCurrentUserFn: getCurrentUserFn500 });
      const init500_1 = manager500.initialize();
      manager500.dispose();
      manager500.connectTokenGetter();
      const init500_2 = manager500.initialize();

      reject500(new FlowForgeApiError(500, 'Server offline'));
      await Promise.all([init500_1, init500_2]);

      const snapshot500 = manager500.getSnapshot();
      expect(snapshot500.isInitializing).toBe(false);
      expect(snapshot500.isAuthenticated).toBe(false);
      expect(snapshot500.token).toBe('jwt-server-down'); // Stored token preserved
      expect(snapshot500.error).toBe('Server offline');
    });

    it('safely deduplicates parallel initialize calls and handles retry after network failure', async () => {
      const storage = createMockStorage('jwt-retry-token');
      let callCount = 0;
      const getCurrentUserFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new FlowForgeApiError(0, 'Network down'));
        }
        return Promise.resolve(mockUser);
      });

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });

      // First run: 2 parallel calls share the same promise
      const p1 = manager.initialize();
      const p2 = manager.initialize();
      expect(p1).toBe(p2);

      await Promise.all([p1, p2]);
      expect(manager.getSnapshot().isInitializing).toBe(false);
      expect(manager.getSnapshot().isAuthenticated).toBe(false);
      expect(getCurrentUserFn).toHaveBeenCalledTimes(1);

      // Retry run: network recovered -> calling initialize again succeeds
      await manager.initialize();
      expect(manager.getSnapshot().isInitializing).toBe(false);
      expect(manager.getSnapshot().isAuthenticated).toBe(true);
      expect(manager.getSnapshot().user).toEqual(mockUser);
      expect(getCurrentUserFn).toHaveBeenCalledTimes(2);
    });

    it('after dispose(), in-flight initialization does not update state or notify obsolete subscribers', async () => {
      const storage = createMockStorage('jwt-in-flight-token');
      let resolveUser!: (val: UserResponseDto) => void;
      const delayedUser = new Promise<UserResponseDto>((resolve) => {
        resolveUser = resolve;
      });
      const getCurrentUserFn = vi.fn().mockReturnValue(delayedUser);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      const listener = vi.fn();
      manager.subscribe(listener);

      // Start initialization (listener fires once on loading state change)
      const initPromise = manager.initialize();
      expect(listener).toHaveBeenCalledTimes(1);
      listener.mockClear();

      // Dispose manager while initialization is in flight
      manager.dispose();

      // State immediately after dispose
      const snapshotBeforeResolve = manager.getSnapshot();

      // Resolve delayed response
      resolveUser(mockUser);
      await initPromise;

      // Obsolete listener was not notified after dispose
      expect(listener).not.toHaveBeenCalled();

      // State was not mutated on disposed instance
      const snapshotAfterResolve = manager.getSnapshot();
      expect(snapshotAfterResolve).toEqual(snapshotBeforeResolve);
      expect(snapshotAfterResolve.isAuthenticated).toBe(false);
      expect(snapshotAfterResolve.user).toBeNull();
    });

    it('stale in-flight /me response cannot overwrite newer login, logout, or session-expiry state', async () => {
      // Scenario A: Logout supersedes in-flight initialize
      const storage = createMockStorage('jwt-stale-token');
      let resolveUser!: (val: UserResponseDto) => void;
      const delayedUser = new Promise<UserResponseDto>((resolve) => {
        resolveUser = resolve;
      });
      const getCurrentUserFn = vi.fn().mockReturnValue(delayedUser);

      const manager = new AuthSessionManager({ storage, getCurrentUserFn });
      const initPromise = manager.initialize();

      // User explicitly logs out while initialize is in flight
      manager.logout();
      expect(manager.getSnapshot().token).toBeNull();
      expect(manager.getSnapshot().isAuthenticated).toBe(false);

      // Stale /me resolves after logout
      resolveUser(mockUser);
      await initPromise;

      // Stale response must not overwrite the logged-out state
      expect(manager.getSnapshot().isAuthenticated).toBe(false);
      expect(manager.getSnapshot().user).toBeNull();
      expect(manager.getSnapshot().token).toBeNull();

      // Scenario B: Newer login supersedes in-flight initialize
      const storage2 = createMockStorage('jwt-old-token');
      let resolveOldUser!: (val: UserResponseDto) => void;
      const delayedOldUser = new Promise<UserResponseDto>((resolve) => {
        resolveOldUser = resolve;
      });
      const getCurrentUserFn2 = vi.fn().mockReturnValue(delayedOldUser);
      const loginFn = vi.fn().mockResolvedValue({
        token: 'jwt-new-user-token',
        user: { ...mockUser, id: 'user-new-999', email: 'new@flowforge.dev' },
      });

      const manager2 = new AuthSessionManager({ storage: storage2, getCurrentUserFn: getCurrentUserFn2, loginFn });
      const initPromise2 = manager2.initialize();

      // Newer login completes while initialize is in flight
      await manager2.login({ email: 'new@flowforge.dev', password: 'Password123!' });
      expect(manager2.getSnapshot().token).toBe('jwt-new-user-token');
      expect(manager2.getSnapshot().user?.email).toBe('new@flowforge.dev');

      // Stale old /me resolves
      resolveOldUser(mockUser);
      await initPromise2;

      // New login state must be preserved
      expect(manager2.getSnapshot().token).toBe('jwt-new-user-token');
      expect(manager2.getSnapshot().user?.email).toBe('new@flowforge.dev');
    });
  });

  describe('AuthProvider React.StrictMode Integration (DOM Regression)', () => {
    function setupDomMock() {
      const originalDocument = global.document;
      const originalWindow = global.window;
      const originalElement = global.Element;
      const originalHTMLElement = global.HTMLElement;
      const originalHTMLIFrameElement = global.HTMLIFrameElement;
      const originalActEnvironment = (global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT;

      (global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

      class MockElement {
        nodeType = 1;
        nodeName: string;
        tagName: string;
        childNodes: unknown[] = [];
        children: unknown[] = [];
        style = {};
        attributes: Record<string, string> = {};
        textContent = '';

        constructor(tag: string) {
          this.nodeName = tag.toUpperCase();
          this.tagName = tag.toUpperCase();
        }
        addEventListener() {}
        removeEventListener() {}
        appendChild(child: unknown) {
          this.childNodes.push(child);
          this.children.push(child);
          return child;
        }
        removeChild(child: unknown) {
          this.childNodes = this.childNodes.filter((c) => c !== child);
          this.children = this.children.filter((c) => c !== child);
          return child;
        }
        insertBefore(child: unknown) {
          this.childNodes.push(child);
          this.children.push(child);
          return child;
        }
        setAttribute(k: string, v: string) {
          this.attributes[k] = v;
        }
        getAttribute(k: string) {
          return this.attributes[k];
        }
      }

      const doc = {
        nodeType: 9,
        nodeName: '#document',
        createElement: (tag: string) => new MockElement(tag),
        createTextNode: (text: string) => ({ nodeType: 3, nodeName: '#text', textContent: text }),
        createComment: (text: string) => ({ nodeType: 8, nodeName: '#comment', textContent: text }),
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as Document;

      const win = {
        document: doc,
        addEventListener: () => {},
        removeEventListener: () => {},
        HTMLIFrameElement: function HTMLIFrameElement() {},
        Element: MockElement,
        HTMLElement: MockElement,
      } as unknown as Window & typeof globalThis;

      (doc as unknown as { defaultView: unknown }).defaultView = win;
      const body = new MockElement('BODY');
      (doc as unknown as { body: unknown; activeElement: unknown }).body = body;
      (doc as unknown as { body: unknown; activeElement: unknown }).activeElement = body;

      global.window = win;
      global.document = doc;
      global.Element = MockElement as unknown as typeof Element;
      global.HTMLElement = MockElement as unknown as typeof HTMLElement;
      global.HTMLIFrameElement = win.HTMLIFrameElement as unknown as typeof HTMLIFrameElement;

      const container = new MockElement('DIV');
      (container as unknown as { ownerDocument: unknown }).ownerDocument = doc;

      return {
        container,
        cleanup: () => {
          global.document = originalDocument;
          global.window = originalWindow;
          global.Element = originalElement;
          global.HTMLElement = originalHTMLElement;
          global.HTMLIFrameElement = originalHTMLIFrameElement;
          (global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
        },
      };
    }

    it('mounts AuthProvider under React.StrictMode with token and delayed /me: resolves loading screen and exposes authenticated state', async () => {
      const { container, cleanup } = setupDomMock();
      let root: ReactDOM.Root | null = null;

      try {
        const storage = createMockStorage('valid-stored-jwt-token');
        let resolveMe!: (val: UserResponseDto) => void;
        const delayedMe = new Promise<UserResponseDto>((resolve) => {
          resolveMe = resolve;
        });
        const getCurrentUserFn = vi.fn().mockReturnValue(delayedMe);

        const observedStates: { isInitializing: boolean; isAuthenticated: boolean; user: UserResponseDto | null }[] = [];

        function TestConsumer() {
          const auth = useAuth();
          observedStates.push({
            isInitializing: auth.isInitializing,
            isAuthenticated: auth.isAuthenticated,
            user: auth.user,
          });

          if (auth.isInitializing) {
            return React.createElement('div', { id: 'loading' }, 'Initializing FlowForge session...');
          }
          return React.createElement(
            'div',
            { id: 'app' },
            auth.isAuthenticated ? `Authenticated: ${auth.user?.fullName}` : 'Guest'
          );
        }

        root = ReactDOM.createRoot(container as unknown as Element);

        await act(async () => {
          root!.render(
            React.createElement(
              React.StrictMode,
              null,
              React.createElement(
                AuthProvider,
                { storage, getCurrentUserFn, autoConnectTokenGetter: false },
                React.createElement(TestConsumer, null)
              )
            )
          );
        });

        // StrictMode has mounted and double-rendered: initial pending state observed
        const pendingState = observedStates[observedStates.length - 1];
        expect(pendingState.isInitializing).toBe(true);
        expect(pendingState.isAuthenticated).toBe(false);

        // Resolve the delayed /me response
        await act(async () => {
          resolveMe(mockUser);
          await delayedMe;
        });

        // Loading screen must resolve and authenticated state must be present
        const resolvedState = observedStates[observedStates.length - 1];
        expect(resolvedState.isInitializing).toBe(false);
        expect(resolvedState.isAuthenticated).toBe(true);
        expect(resolvedState.user).toEqual(mockUser);
      } finally {
        if (root) {
          try {
            await act(async () => {
              root!.unmount();
            });
          } catch {
            // Ignore unmount error during test cleanup
          }
        }
        cleanup();
      }
    });

    it('mounts AuthProvider under React.StrictMode with rejected /me: resolves loading screen without hanging indefinitely', async () => {
      const { container, cleanup } = setupDomMock();
      let root: ReactDOM.Root | null = null;

      try {
        const storage = createMockStorage('rejected-stored-token');
        let rejectMe!: (err: unknown) => void;
        const delayedMe = new Promise<UserResponseDto>((_, reject) => {
          rejectMe = reject;
        });
        const getCurrentUserFn = vi.fn().mockReturnValue(delayedMe);

        const observedStates: { isInitializing: boolean; isAuthenticated: boolean; error: string | null }[] = [];

        function TestConsumer() {
          const auth = useAuth();
          observedStates.push({
            isInitializing: auth.isInitializing,
            isAuthenticated: auth.isAuthenticated,
            error: auth.error,
          });

          if (auth.isInitializing) {
            return React.createElement('div', { id: 'loading' }, 'Initializing FlowForge session...');
          }
          return React.createElement('div', { id: 'app' }, 'Login Screen');
        }

        root = ReactDOM.createRoot(container as unknown as Element);

        await act(async () => {
          root!.render(
            React.createElement(
              React.StrictMode,
              null,
              React.createElement(
                AuthProvider,
                { storage, getCurrentUserFn, autoConnectTokenGetter: false },
                React.createElement(TestConsumer, null)
              )
            )
          );
        });

        expect(observedStates[observedStates.length - 1].isInitializing).toBe(true);

        // Reject the /me call with 401 Unauthorized
        await act(async () => {
          rejectMe(new FlowForgeApiError(401, 'Invalid or expired token'));
          await delayedMe.catch(() => {});
        });

        // The loading screen must resolve to false (unauthenticated login screen)
        const terminalState = observedStates[observedStates.length - 1];
        expect(terminalState.isInitializing).toBe(false);
        expect(terminalState.isAuthenticated).toBe(false);
        expect(storage.clearToken).toHaveBeenCalled();
      } finally {
        if (root) {
          try {
            await act(async () => {
              root!.unmount();
            });
          } catch {
            // Ignore unmount error during test cleanup
          }
        }
        cleanup();
      }
    });

    it('mounts AuthProvider under React.StrictMode with rejected network error (500): resolves loading screen, sets error, and preserves stored token', async () => {
      const { container, cleanup } = setupDomMock();
      let root: ReactDOM.Root | null = null;

      try {
        const storage = createMockStorage('preserved-stored-token');
        let rejectMe!: (err: unknown) => void;
        const delayedMe = new Promise<UserResponseDto>((_, reject) => {
          rejectMe = reject;
        });
        const getCurrentUserFn = vi.fn().mockReturnValue(delayedMe);

        const observedStates: { isInitializing: boolean; isAuthenticated: boolean; error: string | null }[] = [];

        function TestConsumer() {
          const auth = useAuth();
          observedStates.push({
            isInitializing: auth.isInitializing,
            isAuthenticated: auth.isAuthenticated,
            error: auth.error,
          });

          if (auth.isInitializing) {
            return React.createElement('div', { id: 'loading' }, 'Initializing FlowForge session...');
          }
          return React.createElement(
            'div',
            { id: 'app' },
            auth.error ? `Error: ${auth.error}` : 'Ready'
          );
        }

        root = ReactDOM.createRoot(container as unknown as Element);

        await act(async () => {
          root!.render(
            React.createElement(
              React.StrictMode,
              null,
              React.createElement(
                AuthProvider,
                { storage, getCurrentUserFn, autoConnectTokenGetter: false },
                React.createElement(TestConsumer, null)
              )
            )
          );
        });

        expect(observedStates[observedStates.length - 1].isInitializing).toBe(true);

        // Reject the /me call with 500 Server Error
        await act(async () => {
          rejectMe(new FlowForgeApiError(500, 'Internal Server Error'));
          await delayedMe.catch(() => {});
        });

        // The loading screen must resolve to false, error exposed, token preserved
        const terminalState = observedStates[observedStates.length - 1];
        expect(terminalState.isInitializing).toBe(false);
        expect(terminalState.isAuthenticated).toBe(false);
        expect(terminalState.error).toBe('Internal Server Error');
        expect(storage.clearToken).not.toHaveBeenCalled();
        expect(storage.getToken()).toBe('preserved-stored-token');
      } finally {
        if (root) {
          try {
            await act(async () => {
              root!.unmount();
            });
          } catch {
            // Ignore unmount error during test cleanup
          }
        }
        cleanup();
      }
    });
  });
});
