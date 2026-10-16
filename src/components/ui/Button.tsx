import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] hover:opacity-90 active:scale-[0.99] text-[var(--accent-contrast)] border-transparent font-medium shadow-xs',
  secondary:
    'bg-[var(--bg-subsurface)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-default)] hover:border-[var(--border-emphasis)] shadow-xs',
  outline:
    'bg-transparent hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-default)] hover:border-[var(--border-emphasis)]',
  danger:
    'bg-[var(--status-red-bg)] hover:opacity-90 active:scale-[0.99] text-[var(--status-red-text)] border-[var(--status-red-border)] font-medium',
  ghost:
    'bg-transparent hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2 py-0.5 text-[11px] gap-1.5 min-h-[24px]',
  md: 'px-2.5 py-1 text-xs gap-1.5 min-h-[28px]',
  lg: 'px-3 py-1.5 text-xs gap-2 min-h-[32px]',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconPosition = 'left',
  isLoading = false,
  disabled,
  className = '',
  ...props
}) => {
  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center rounded-[5px] border font-sans transition-all duration-100 select-none focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon && iconPosition === 'left' && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
      {!isLoading && icon && iconPosition === 'right' && (
        <span className="shrink-0">{icon}</span>
      )}
    </button>
  );
};
