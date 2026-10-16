import React from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'cyan' | 'outline';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-subsurface)] text-[var(--text-secondary)] border-[var(--border-default)]',
  success: 'bg-[var(--status-green-bg)] text-[var(--status-green-text)] border-[var(--status-green-border)]',
  warning: 'bg-[var(--status-yellow-bg)] text-[var(--status-yellow-text)] border-[var(--status-yellow-border)]',
  danger: 'bg-[var(--status-red-bg)] text-[var(--status-red-text)] border-[var(--status-red-border)]',
  cyan: 'bg-[var(--status-blue-bg)] text-[var(--status-blue-text)] border-[var(--status-blue-border)]',
  outline: 'bg-transparent text-[var(--text-secondary)] border-[var(--border-default)]',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-[var(--text-muted)]',
  success: 'bg-[var(--status-green-text)]',
  warning: 'bg-[var(--status-yellow-text)]',
  danger: 'bg-[var(--status-red-text)]',
  cyan: 'bg-[var(--status-blue-text)]',
  outline: 'bg-[var(--border-emphasis)]',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  className = '',
  dot = false,
}) => {
  const sizeClasses =
    size === 'sm'
      ? 'px-1.5 py-0.5 text-[10px] font-mono'
      : 'px-2 py-0.5 text-[11px] font-mono';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border font-medium leading-none ${variantStyles[variant]} ${sizeClasses} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColors[variant]}`} />}
      {children}
    </span>
  );
};
