import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useEffect,
  useSyncExternalStore,
} from 'react';
import {
  getCurrentUser as defaultGetCurrentUser,
  loginUser as defaultLoginUser,
  registerUser as defaultRegisterUser,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  FlowForgeApiError,
  type ApiClientOptions,
} from '../api/flowForgeApi';
import type {
  UserResponseDto,
  LoginRequest,
  RegisterRequest,
  AuthResponseDto,
} from '../types';

/**
 * Storage abstraction for persisting and retrieving JWT session tokens.
 * Uses sessionStorage by default to isolate the token to the browser tab lifecycle.
 */
export interface AuthTokenStorage {
  getToken: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

const STORAGE_KEY = 'flowforge_session_token';

/**
 * Default sessionStorage implementation.
 * Wraps browser access in try-catch to safeguard restricted or private browsing environments.
 */
export const sessionStorageAuthStorage: AuthTokenStorage = {
  getToken: (): string | null => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(STORAGE_KEY);
      }
    } catch {
      // Gracefully handle restricted storage environments
    }
    return null;
  },
  setToken: (token: string): void => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(STORAGE_KEY, token);
      }
    } catch {
      // Gracefully handle restricted storage environments or quota limits
    }
  },
  clearToken: (): void => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Gracefully handle restricted storage environments
    }
  },
};

/**
 * Immutable state snapshot representing the user's authentication session.
 */
export interface AuthState {
  readonly user: UserResponseDto | null;
  readonly token: string | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly isInitializing: boolean;
  readonly error: string | null;
}

/**
 * Full value exposed by useAuth and the AuthContext provider.
 */
export interface AuthContextValue extends AuthState {
  login: (request: LoginRequest) => Promise<AuthResponseDto>;
  register: (request: RegisterRequest) => Promise<AuthResponseDto>;
  logout: () => void;
  clearError: () => void;
  onSessionExpired: (listener: (error?: FlowForgeApiError) => void) => () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthSessionManagerConfig {
  storage?: AuthTokenStorage;
  loginFn?: typeof defaultLoginUser;
  registerFn?: typeof defaultRegisterUser;
  getCurrentUserFn?: typeof defaultGetCurrentUser;
  clientOptions?: ApiClientOptions;
  autoConnectTokenGetter?: boolean;
}

function extractSafeErrorMessage(err: unknown): string {
  if (err instanceof FlowForgeApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Authentication request failed';
}

/**
 * Core authentication session state manager.
 * Encapsulates state transitions, token persistence, race condition prevention,
 * and integration with the API client's setAuthTokenGetter mechanism.
 */
export class AuthSessionManager {
  private state: AuthState;
  private readonly storage: AuthTokenStorage;
  private readonly loginFn: typeof defaultLoginUser;
  private readonly registerFn: typeof defaultRegisterUser;
  private readonly getCurrentUserFn: typeof defaultGetCurrentUser;
  private readonly clientOptions?: ApiClientOptions;
  private readonly listeners: Set<() => void> = new Set();
  private readonly sessionExpiredListeners: Set<(error?: FlowForgeApiError) => void> = new Set();
  private currentActionId: number = 0;
  private isInitialized: boolean = false;
  private readonly autoConnectTokenGetter: boolean;

  constructor(config: AuthSessionManagerConfig = {}) {
    this.storage = config.storage ?? sessionStorageAuthStorage;
    this.loginFn = config.loginFn ?? defaultLoginUser;
    this.registerFn = config.registerFn ?? defaultRegisterUser;
    this.getCurrentUserFn = config.getCurrentUserFn ?? defaultGetCurrentUser;
    this.clientOptions = config.clientOptions;
    this.autoConnectTokenGetter = config.autoConnectTokenGetter ?? true;

    const initialToken = this.storage.getToken();
    const hasToken = Boolean(initialToken && initialToken.trim());

    this.state = {
      user: null,
      token: hasToken ? initialToken!.trim() : null,
      isAuthenticated: false,
      isLoading: hasToken,
      isInitializing: hasToken,
      error: null,
    };

    this.connectTokenGetter();
  }

  connectTokenGetter(): void {
    if (this.autoConnectTokenGetter) {
      setAuthTokenGetter(() => this.state.token);
      setUnauthorizedHandler((error) => {
        // Only trigger session expiration if we currently have an active token or session
        if (this.state.token || this.state.isAuthenticated) {
          this.handleSessionExpired(error);
        }
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AuthState => {
    return this.state;
  };

  private setState(partial: Partial<AuthState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Initializes the session on startup.
   * If a stored token is present, validates it against /api/v1/auth/me before declaring the session authenticated.
   * On 401, clears the invalid token. On network/server errors, leaves the token stored.
   */
  async initialize(): Promise<void> {
    this.connectTokenGetter();
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    const storedToken = this.storage.getToken();
    if (!storedToken || !storedToken.trim()) {
      this.setState({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        isInitializing: false,
        error: null,
      });
      return;
    }

    const trimmedToken = storedToken.trim();
    const actionId = ++this.currentActionId;

    this.setState({
      token: trimmedToken,
      isLoading: true,
      isInitializing: true,
      error: null,
    });

    try {
      const userProfile = await this.getCurrentUserFn({
        ...this.clientOptions,
        token: trimmedToken,
      });

      if (actionId !== this.currentActionId) {
        // Discard result if superseded by a newer action (e.g. logout)
        return;
      }

      this.setState({
        user: userProfile,
        token: trimmedToken,
        isAuthenticated: true,
        isLoading: false,
        isInitializing: false,
        error: null,
      });
    } catch (err) {
      if (actionId !== this.currentActionId) {
        return;
      }

      if (err instanceof FlowForgeApiError && (err.isUnauthorized || err.status === 401)) {
        // Explicit 401 Unauthorized: token is invalid or expired -> purge session
        this.storage.clearToken();
        this.setState({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitializing: false,
          error: null,
        });
      } else {
        // Network failure, 5xx server error, or offline server
        // Preserve stored token so user does not lose session due to temporary outage
        this.setState({
          isAuthenticated: false,
          isLoading: false,
          isInitializing: false,
          error: extractSafeErrorMessage(err),
        });
      }
    }
  }

  /**
   * Authenticates user via email and password, updating state and persisting the token upon success.
   */
  async login(request: LoginRequest): Promise<AuthResponseDto> {
    const actionId = ++this.currentActionId;
    this.setState({ isLoading: true, error: null });

    try {
      const response = await this.loginFn(request, this.clientOptions);

      if (actionId !== this.currentActionId) {
        return response;
      }

      this.storage.setToken(response.token);
      this.setState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return response;
    } catch (err) {
      if (actionId === this.currentActionId) {
        this.setState({
          isLoading: false,
          error: extractSafeErrorMessage(err),
        });
      }
      throw err;
    }
  }

  /**
   * Registers a new account, updating state and persisting the token upon success.
   */
  async register(request: RegisterRequest): Promise<AuthResponseDto> {
    const actionId = ++this.currentActionId;
    this.setState({ isLoading: true, error: null });

    try {
      const response = await this.registerFn(request, this.clientOptions);

      if (actionId !== this.currentActionId) {
        return response;
      }

      this.storage.setToken(response.token);
      this.setState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return response;
    } catch (err) {
      if (actionId === this.currentActionId) {
        this.setState({
          isLoading: false,
          error: extractSafeErrorMessage(err),
        });
      }
      throw err;
    }
  }

  /**
   * Clears the current session and token from memory and storage.
   * Cancels any in-flight asynchronous operations.
   */
  logout(): void {
    this.currentActionId++;
    this.storage.clearToken();
    this.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  }

  /**
   * Registers a callback invoked whenever the user session expires or is terminated via 401.
   */
  onSessionExpired = (listener: (error?: FlowForgeApiError) => void): (() => void) => {
    this.sessionExpiredListeners.add(listener);
    return () => {
      this.sessionExpiredListeners.delete(listener);
    };
  };

  /**
   * Clears the current session and token due to an expired or rejected authentication token.
   * Notifies all registered session expiration listeners without triggering recursion.
   */
  handleSessionExpired(error?: FlowForgeApiError): void {
    if (!this.state.token && !this.state.isAuthenticated) {
      return;
    }
    this.currentActionId++;
    this.storage.clearToken();
    this.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      isInitializing: false,
      error: error?.message || 'Your session has expired. Please sign in again.',
    });
    this.sessionExpiredListeners.forEach((listener) => {
      try {
        listener(error);
      } catch {
        // Safe guard against listener errors
      }
    });
  }

  clearError(): void {
    this.setState({ error: null });
  }

  dispose(): void {
    this.currentActionId++;
    this.listeners.clear();
    this.sessionExpiredListeners.clear();
    if (this.autoConnectTokenGetter) {
      setAuthTokenGetter(null);
      setUnauthorizedHandler(null);
    }
  }
}

export interface AuthProviderProps extends AuthSessionManagerConfig {
  children: React.ReactNode;
}

/**
 * Top-level React authentication provider managing session restoration,
 * login, registration, and logout across the application.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  storage,
  loginFn,
  registerFn,
  getCurrentUserFn,
  clientOptions,
  autoConnectTokenGetter,
}) => {
  const managerRef = useRef<AuthSessionManager | null>(null);

  if (!managerRef.current) {
    managerRef.current = new AuthSessionManager({
      storage,
      loginFn,
      registerFn,
      getCurrentUserFn,
      clientOptions,
      autoConnectTokenGetter,
    });
  }

  const manager = managerRef.current;
  manager.connectTokenGetter();

  const state = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot
  );

  useEffect(() => {
    void manager.initialize();
    return () => {
      manager.dispose();
    };
  }, [manager]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: (req) => manager.login(req),
      register: (req) => manager.register(req),
      logout: () => manager.logout(),
      clearError: () => manager.clearError(),
      onSessionExpired: (listener) => manager.onSessionExpired(listener),
    }),
    [state, manager]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook to access authentication session state and methods.
 * @throws Error if called outside of an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
