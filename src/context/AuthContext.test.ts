import React from 'react';
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
  });
});
