import React, { useState, useEffect } from 'react';
import { Mail, Lock, User, AlertCircle, LogIn, UserPlus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { FlowForgeApiError } from '../../api/flowForgeApi';
import type { LoginRequest, RegisterRequest, AuthResponseDto } from '../../types';

export type AuthMode = 'login' | 'register';

export interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
  defaultEmail?: string;
  onEmailChange?: (email: string) => void;
  loginFn?: (request: LoginRequest) => Promise<AuthResponseDto>;
}

export interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
  defaultEmail?: string;
  onEmailChange?: (email: string) => void;
  registerFn?: (request: RegisterRequest) => Promise<AuthResponseDto>;
}

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: AuthMode;
  onSuccess?: () => void;
}

/**
 * Validates email according to RFC 5322 format and size bounds.
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return 'Email is required';
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return 'Please enter a valid email address';
  }
  if (trimmed.length > 255) {
    return 'Email cannot exceed 255 characters';
  }
  return null;
}

/**
 * Validates password for login (required).
 */
export function validateLoginPassword(password: string): string | null {
  if (!password) {
    return 'Password is required';
  }
  return null;
}

/**
 * Validates password for registration (minimum 8 characters, maximum 100 characters).
 */
export function validateRegisterPassword(password: string): string | null {
  if (!password) {
    return 'Password is required';
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (password.length > 100) {
    return 'Password cannot exceed 100 characters';
  }
  return null;
}

/**
 * Validates full name for registration.
 */
export function validateFullName(fullName: string): string | null {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return 'Full name is required';
  }
  if (trimmed.length > 100) {
    return 'Full name cannot exceed 100 characters';
  }
  return null;
}

/**
 * Maps raw API errors or unexpected exceptions into safe, user-friendly messages.
 * Never outputs credentials, tokens, or raw technical stack traces.
 */
export function formatAuthError(err: unknown, mode: AuthMode): string {
  if (err instanceof FlowForgeApiError) {
    if (err.isUnauthorized || err.status === 401) {
      return 'Invalid email or password. Please verify your credentials.';
    }
    if (err.isConflict || err.status === 409) {
      return 'An account with this email already exists. Please sign in instead.';
    }
    if (err.status === 0) {
      return 'Unable to connect to FlowForge server. Please verify your network connection.';
    }
    if (err.status >= 500) {
      return 'FlowForge server encountered an error. Please try again later.';
    }
    if (err.details && err.details.length > 0) {
      return err.details.join('. ');
    }
    if (err.message && err.message.trim()) {
      return err.message.trim();
    }
  }

  if (err instanceof Error && err.message && err.message.trim()) {
    return err.message.trim();
  }

  return mode === 'login'
    ? 'Unable to sign in. Please try again.'
    : 'Unable to create account. Please try again.';
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSuccess,
  onSwitchToRegister,
  defaultEmail = '',
  onEmailChange,
  loginFn,
}) => {
  const authContext = useAuth();
  const doLogin = loginFn ?? authContext.login;

  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setEmail(defaultEmail);
  }, [defaultEmail]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    onEmailChange?.(val);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (formError) setFormError(null);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (formError) setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const emailErr = validateEmail(email);
    const passwordErr = validateLoginPassword(password);

    if (emailErr || passwordErr) {
      setFieldErrors({
        email: emailErr ?? undefined,
        password: passwordErr ?? undefined,
      });
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      await doLogin({
        email: email.trim(),
        password,
      });
      onSuccess?.();
    } catch (err) {
      setFormError(formatAuthError(err, 'login'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      role="form"
      aria-label="Sign in to FlowForge"
      onSubmit={handleSubmit}
      className="space-y-4"
      noValidate
    >
      {formError && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="login-error-alert"
          className="p-2.5 rounded-[5px] bg-[var(--status-red-bg)] text-[var(--status-red-text)] border border-[var(--status-red-border)] text-xs flex items-start gap-2"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-tight">{formError}</span>
        </div>
      )}

      <Input
        label="Email address"
        id="login-email"
        type="email"
        name="email"
        value={email}
        onChange={handleEmailChange}
        error={fieldErrors.email}
        icon={<Mail size={13} />}
        placeholder="you@company.com"
        autoComplete="email"
        disabled={isSubmitting}
        required
        data-testid="login-email-input"
      />

      <Input
        label="Password"
        id="login-password"
        type="password"
        name="password"
        value={password}
        onChange={handlePasswordChange}
        error={fieldErrors.password}
        icon={<Lock size={13} />}
        placeholder="••••••••"
        autoComplete="current-password"
        disabled={isSubmitting}
        required
        data-testid="login-password-input"
      />

      <Button
        type="submit"
        variant="primary"
        size="md"
        isLoading={isSubmitting}
        disabled={isSubmitting}
        icon={<LogIn size={13} />}
        className="w-full mt-2 font-medium"
        data-testid="login-submit-button"
      >
        {isSubmitting ? 'Signing in...' : 'Sign In'}
      </Button>

      {onSwitchToRegister && (
        <div className="pt-2 text-center border-t border-[var(--border-default)]">
          <p className="text-[11px] text-[var(--text-secondary)]">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToRegister}
              disabled={isSubmitting}
              className="text-[var(--accent-blue)] hover:underline font-medium cursor-pointer"
              data-testid="switch-to-register-button"
            >
              Sign up
            </button>
          </p>
        </div>
      )}
    </form>
  );
};

export const RegisterForm: React.FC<RegisterFormProps> = ({
  onSuccess,
  onSwitchToLogin,
  defaultEmail = '',
  onEmailChange,
  registerFn,
}) => {
  const authContext = useAuth();
  const doRegister = registerFn ?? authContext.register;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setEmail(defaultEmail);
  }, [defaultEmail]);

  const handleFullNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFullName(e.target.value);
    if (fieldErrors.fullName) {
      setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
    }
    if (formError) setFormError(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    onEmailChange?.(val);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (formError) setFormError(null);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (formError) setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const fullNameErr = validateFullName(fullName);
    const emailErr = validateEmail(email);
    const passwordErr = validateRegisterPassword(password);

    if (fullNameErr || emailErr || passwordErr) {
      setFieldErrors({
        fullName: fullNameErr ?? undefined,
        email: emailErr ?? undefined,
        password: passwordErr ?? undefined,
      });
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      await doRegister({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
      });
      onSuccess?.();
    } catch (err) {
      setFormError(formatAuthError(err, 'register'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      role="form"
      aria-label="Create FlowForge Account"
      onSubmit={handleSubmit}
      className="space-y-4"
      noValidate
    >
      {formError && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="register-error-alert"
          className="p-2.5 rounded-[5px] bg-[var(--status-red-bg)] text-[var(--status-red-text)] border border-[var(--status-red-border)] text-xs flex items-start gap-2"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-tight">{formError}</span>
        </div>
      )}

      <Input
        label="Full name"
        id="register-fullname"
        type="text"
        name="fullName"
        value={fullName}
        onChange={handleFullNameChange}
        error={fieldErrors.fullName}
        icon={<User size={13} />}
        placeholder="Alice Engineer"
        autoComplete="name"
        disabled={isSubmitting}
        required
        data-testid="register-name-input"
      />

      <Input
        label="Email address"
        id="register-email"
        type="email"
        name="email"
        value={email}
        onChange={handleEmailChange}
        error={fieldErrors.email}
        icon={<Mail size={13} />}
        placeholder="you@company.com"
        autoComplete="email"
        disabled={isSubmitting}
        required
        data-testid="register-email-input"
      />

      <Input
        label="Password"
        id="register-password"
        type="password"
        name="password"
        value={password}
        onChange={handlePasswordChange}
        error={fieldErrors.password}
        helperText="Must be at least 8 characters"
        icon={<Lock size={13} />}
        placeholder="••••••••"
        autoComplete="new-password"
        disabled={isSubmitting}
        required
        data-testid="register-password-input"
      />

      <Button
        type="submit"
        variant="primary"
        size="md"
        isLoading={isSubmitting}
        disabled={isSubmitting}
        icon={<UserPlus size={13} />}
        className="w-full mt-2 font-medium"
        data-testid="register-submit-button"
      >
        {isSubmitting ? 'Creating account...' : 'Create Account'}
      </Button>

      {onSwitchToLogin && (
        <div className="pt-2 text-center border-t border-[var(--border-default)]">
          <p className="text-[11px] text-[var(--text-secondary)]">
            Already have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToLogin}
              disabled={isSubmitting}
              className="text-[var(--accent-blue)] hover:underline font-medium cursor-pointer"
              data-testid="switch-to-login-button"
            >
              Sign in
            </button>
          </p>
        </div>
      )}
    </form>
  );
};

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'login',
  onSuccess,
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [sharedEmail, setSharedEmail] = useState('');

  // Synchronize initialMode whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
    }
  }, [isOpen, initialMode]);

  const handleSuccess = () => {
    onSuccess?.();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'login' ? 'Sign in to FlowForge' : 'Create FlowForge Account'}
      description={
        mode === 'login'
          ? 'Enter your credentials to access your workflows and execution pipelines'
          : 'Set up an account to build, validate, and execute durable workflows'
      }
      maxWidth="sm"
    >
      <div className="space-y-4">
        {mode === 'login' ? (
          <LoginForm
            onSuccess={handleSuccess}
            onSwitchToRegister={() => setMode('register')}
            defaultEmail={sharedEmail}
            onEmailChange={setSharedEmail}
          />
        ) : (
          <RegisterForm
            onSuccess={handleSuccess}
            onSwitchToLogin={() => setMode('login')}
            defaultEmail={sharedEmail}
            onEmailChange={setSharedEmail}
          />
        )}
      </div>
    </Modal>
  );
};
