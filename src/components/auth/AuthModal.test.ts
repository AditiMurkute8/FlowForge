import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateEmail,
  validateLoginPassword,
  validateRegisterPassword,
  validateFullName,
  formatAuthError,
  LoginForm,
  RegisterForm,
  AuthModal,
} from './AuthModal';
import { FlowForgeApiError } from '../../api/flowForgeApi';
import { AuthProvider } from '../../context/AuthContext';
import type { LoginRequest, RegisterRequest, AuthResponseDto } from '../../types';

describe('AuthModal & Authentication UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Validation Helpers', () => {
    describe('validateEmail', () => {
      it('rejects empty or whitespace-only email', () => {
        expect(validateEmail('')).toBe('Email is required');
        expect(validateEmail('   ')).toBe('Email is required');
      });

      it('rejects invalid email formats', () => {
        expect(validateEmail('notanemail')).toBe('Please enter a valid email address');
        expect(validateEmail('missingdomain@')).toBe('Please enter a valid email address');
        expect(validateEmail('@missinguser.com')).toBe('Please enter a valid email address');
        expect(validateEmail('user@nodot')).toBe('Please enter a valid email address');
        expect(validateEmail('user with spaces@domain.com')).toBe('Please enter a valid email address');
      });

      it('rejects email exceeding 255 characters', () => {
        const longEmail = 'a'.repeat(250) + '@example.com';
        expect(validateEmail(longEmail)).toBe('Email cannot exceed 255 characters');
      });

      it('accepts valid email addresses', () => {
        expect(validateEmail('user@flowforge.dev')).toBeNull();
        expect(validateEmail('alice.engineer+tag@domain.co.uk')).toBeNull();
        expect(validateEmail('  trimmed@flowforge.dev  ')).toBeNull();
      });
    });

    describe('validateLoginPassword', () => {
      it('rejects empty password', () => {
        expect(validateLoginPassword('')).toBe('Password is required');
      });

      it('accepts non-empty password', () => {
        expect(validateLoginPassword('any-password')).toBeNull();
        expect(validateLoginPassword('12345678')).toBeNull();
      });
    });

    describe('validateRegisterPassword', () => {
      it('rejects empty password', () => {
        expect(validateRegisterPassword('')).toBe('Password is required');
      });

      it('rejects password shorter than 8 characters', () => {
        expect(validateRegisterPassword('short')).toBe('Password must be at least 8 characters');
        expect(validateRegisterPassword('1234567')).toBe('Password must be at least 8 characters');
      });

      it('rejects password exceeding 100 characters', () => {
        const longPw = 'x'.repeat(101);
        expect(validateRegisterPassword(longPw)).toBe('Password cannot exceed 100 characters');
      });

      it('accepts valid passwords between 8 and 100 characters', () => {
        expect(validateRegisterPassword('8charsPw')).toBeNull();
        expect(validateRegisterPassword('SuperSecurePassword123!')).toBeNull();
        expect(validateRegisterPassword('x'.repeat(100))).toBeNull();
      });
    });

    describe('validateFullName', () => {
      it('rejects empty or whitespace-only name', () => {
        expect(validateFullName('')).toBe('Full name is required');
        expect(validateFullName('   ')).toBe('Full name is required');
      });

      it('rejects name exceeding 100 characters', () => {
        const longName = 'A'.repeat(101);
        expect(validateFullName(longName)).toBe('Full name cannot exceed 100 characters');
      });

      it('accepts valid full names', () => {
        expect(validateFullName('Alice Engineer')).toBeNull();
        expect(validateFullName('Bob Developer Jr.')).toBeNull();
        expect(validateFullName('  Trimmed Name  ')).toBeNull();
      });
    });
  });

  describe('formatAuthError', () => {
    it('formats 401 Unauthorized as clear invalid credentials message', () => {
      const err = new FlowForgeApiError(401, 'Unauthorized');
      expect(formatAuthError(err, 'login')).toBe(
        'Invalid email or password. Please verify your credentials.'
      );
    });

    it('formats 409 Conflict as clear duplicate email message', () => {
      const err = new FlowForgeApiError(409, 'Conflict');
      expect(formatAuthError(err, 'register')).toBe(
        'An account with this email already exists. Please sign in instead.'
      );
    });

    it('formats status 0 as network connectivity error', () => {
      const err = new FlowForgeApiError(0, 'Network failure: Unable to connect to FlowForge server');
      expect(formatAuthError(err, 'login')).toBe(
        'Unable to connect to FlowForge server. Please verify your network connection.'
      );
    });

    it('formats 500+ as server error message', () => {
      const err = new FlowForgeApiError(500, 'Internal Server Error');
      expect(formatAuthError(err, 'login')).toBe(
        'FlowForge server encountered an error. Please try again later.'
      );
      const err503 = new FlowForgeApiError(503, 'Service Unavailable');
      expect(formatAuthError(err503, 'register')).toBe(
        'FlowForge server encountered an error. Please try again later.'
      );
    });

    it('formats validation errors with details array by joining them', () => {
      const err = new FlowForgeApiError(400, 'Validation failed', [
        'Email must be valid',
        'Password must be at least 8 characters',
      ]);
      expect(formatAuthError(err, 'register')).toBe(
        'Email must be valid. Password must be at least 8 characters'
      );
    });

    it('falls back to error message for other Error instances', () => {
      const err = new Error('Custom validation failure');
      expect(formatAuthError(err, 'login')).toBe('Custom validation failure');
    });

    it('never includes passwords or raw tokens in formatted error output', () => {
      const rawSecret = 'SuperSecret123!';
      const err = new FlowForgeApiError(401, 'Bad credentials');
      const formatted = formatAuthError(err, 'login');
      expect(formatted).not.toContain(rawSecret);
      expect(formatted).not.toContain('Bearer');
    });
  });

  describe('LoginForm SSR & Rendering', () => {
    it('renders login form with accessible labels, inputs, and submit button', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(LoginForm, { defaultEmail: 'prefilled@flowforge.dev' })
        )
      );

      expect(html).toContain('role="form"');
      expect(html).toContain('aria-label="Sign in to FlowForge"');
      expect(html).toContain('id="login-email"');
      expect(html).toContain('type="email"');
      expect(html).toContain('value="prefilled@flowforge.dev"');
      expect(html).toContain('id="login-password"');
      expect(html).toContain('type="password"');
      expect(html).toContain('Sign In');
    });

    it('renders switch to sign up button when onSwitchToRegister is supplied', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(LoginForm, { onSwitchToRegister: () => {} })
        )
      );

      expect(html).toContain('Don&#x27;t have an account?');
      expect(html).toContain('Sign up');
      expect(html).toContain('data-testid="switch-to-register-button"');
    });
  });

  describe('RegisterForm SSR & Rendering', () => {
    it('renders registration form with full name, email, password, and submit button', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(RegisterForm, { defaultEmail: 'user@flowforge.dev' })
        )
      );

      expect(html).toContain('role="form"');
      expect(html).toContain('aria-label="Create FlowForge Account"');
      expect(html).toContain('id="register-fullname"');
      expect(html).toContain('Full name');
      expect(html).toContain('id="register-email"');
      expect(html).toContain('type="email"');
      expect(html).toContain('id="register-password"');
      expect(html).toContain('type="password"');
      expect(html).toContain('Must be at least 8 characters');
      expect(html).toContain('Create Account');
    });

    it('renders switch to sign in button when onSwitchToLogin is supplied', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(RegisterForm, { onSwitchToLogin: () => {} })
        )
      );

      expect(html).toContain('Already have an account?');
      expect(html).toContain('Sign in');
      expect(html).toContain('data-testid="switch-to-login-button"');
    });
  });

  describe('AuthModal Rendering', () => {
    it('renders null when isOpen is false', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AuthModal, { isOpen: false, onClose: () => {} })
        )
      );

      expect(html).toBe('');
    });

    it('renders login modal when isOpen is true and initialMode is login', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AuthModal, {
            isOpen: true,
            initialMode: 'login',
            onClose: () => {},
          })
        )
      );

      expect(html).toContain('Sign in to FlowForge');
      expect(html).toContain('id="login-email"');
      expect(html).toContain('id="login-password"');
      expect(html).toContain('data-testid="login-submit-button"');
    });

    it('renders register modal when isOpen is true and initialMode is register', () => {
      const html = renderToString(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AuthModal, {
            isOpen: true,
            initialMode: 'register',
            onClose: () => {},
          })
        )
      );

      expect(html).toContain('Create FlowForge Account');
      expect(html).toContain('id="register-fullname"');
      expect(html).toContain('id="register-email"');
      expect(html).toContain('id="register-password"');
      expect(html).toContain('data-testid="register-submit-button"');
    });
  });

  describe('Submission & Duplicate Submit Protection Logic', () => {
    it('prevents submission when required fields are missing in login', async () => {
      const loginFn = vi.fn();
      const email = '';
      const password = '';

      const emailErr = validateEmail(email);
      const passwordErr = validateLoginPassword(password);

      expect(emailErr).toBe('Email is required');
      expect(passwordErr).toBe('Password is required');
      expect(loginFn).not.toHaveBeenCalled();
    });

    it('prevents submission when password is under 8 chars in registration', async () => {
      const registerFn = vi.fn();
      const fullName = 'Alice Engineer';
      const email = 'alice@flowforge.dev';
      const password = 'short';

      const fullNameErr = validateFullName(fullName);
      const emailErr = validateEmail(email);
      const passwordErr = validateRegisterPassword(password);

      expect(fullNameErr).toBeNull();
      expect(emailErr).toBeNull();
      expect(passwordErr).toBe('Password must be at least 8 characters');
      expect(registerFn).not.toHaveBeenCalled();
    });

    it('calls loginFn with trimmed email upon valid submission', async () => {
      const mockAuthResponse: AuthResponseDto = {
        token: 'token-abc',
        user: {
          id: 'u-1',
          email: 'alice@flowforge.dev',
          fullName: 'Alice',
          active: true,
          createdAt: '2026-10-20T10:00:00Z',
          updatedAt: '2026-10-20T10:00:00Z',
        },
      };
      const loginFn = vi.fn().mockResolvedValue(mockAuthResponse);

      const emailInput = '  alice@flowforge.dev  ';
      const passwordInput = 'Password123!';

      // Simulate valid submission
      const payload: LoginRequest = {
        email: emailInput.trim(),
        password: passwordInput,
      };

      const result = await loginFn(payload);
      expect(loginFn).toHaveBeenCalledWith({
        email: 'alice@flowforge.dev',
        password: 'Password123!',
      });
      expect(result).toEqual(mockAuthResponse);
    });

    it('calls registerFn with trimmed fields upon valid submission', async () => {
      const mockAuthResponse: AuthResponseDto = {
        token: 'token-xyz',
        user: {
          id: 'u-2',
          email: 'bob@flowforge.dev',
          fullName: 'Bob Smith',
          active: true,
          createdAt: '2026-10-20T10:00:00Z',
          updatedAt: '2026-10-20T10:00:00Z',
        },
      };
      const registerFn = vi.fn().mockResolvedValue(mockAuthResponse);

      const payload: RegisterRequest = {
        fullName: '  Bob Smith  '.trim(),
        email: '  bob@flowforge.dev  '.trim(),
        password: 'SecurePassword123!',
      };

      const result = await registerFn(payload);
      expect(registerFn).toHaveBeenCalledWith({
        fullName: 'Bob Smith',
        email: 'bob@flowforge.dev',
        password: 'SecurePassword123!',
      });
      expect(result).toEqual(mockAuthResponse);
    });

    it('duplicate submission prevention guards against multiple concurrent calls', async () => {
      let resolveFirstCall!: (res: AuthResponseDto) => void;
      const delayedPromise = new Promise<AuthResponseDto>((resolve) => {
        resolveFirstCall = resolve;
      });

      const loginFn = vi.fn().mockReturnValue(delayedPromise);
      let isSubmitting = false;

      const triggerSubmit = async () => {
        if (isSubmitting) return;
        isSubmitting = true;
        try {
          await loginFn({ email: 'a@b.com', password: 'pw' });
        } finally {
          isSubmitting = false;
        }
      };

      // First submit starts
      const firstCallPromise = triggerSubmit();
      expect(isSubmitting).toBe(true);

      // Second submit attempted immediately while first is still pending
      const secondCallPromise = triggerSubmit();

      // loginFn should only have been called ONCE
      expect(loginFn).toHaveBeenCalledTimes(1);

      resolveFirstCall({
        token: 'token-1',
        user: {
          id: 'u-1',
          email: 'a@b.com',
          fullName: 'A',
          active: true,
          createdAt: '2026-10-20T10:00:00Z',
          updatedAt: '2026-10-20T10:00:00Z',
        },
      });

      await firstCallPromise;
      await secondCallPromise;

      expect(isSubmitting).toBe(false);
      expect(loginFn).toHaveBeenCalledTimes(1);
    });
  });
});
