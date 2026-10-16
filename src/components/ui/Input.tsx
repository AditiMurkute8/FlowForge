import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  icon,
  id,
  className = '',
  disabled,
  ...props
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[11px] font-medium text-[var(--text-secondary)] select-none"
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <span className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          disabled={disabled}
          className={`w-full rounded-[5px] border bg-[var(--bg-subsurface)] py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] disabled:opacity-50 disabled:cursor-not-allowed ${
            icon ? 'pl-7 pr-2.5' : 'px-2.5'
          } ${
            error
              ? 'border-[var(--status-red-text)] focus:ring-[var(--status-red-text)]'
              : 'border-[var(--border-default)] hover:border-[var(--border-emphasis)]'
          } ${className}`}
          {...props}
        />
      </div>
      {error ? (
        <span className="text-[10px] text-[var(--status-red-text)]">{error}</span>
      ) : helperText ? (
        <span className="text-[10px] text-[var(--text-muted)]">{helperText}</span>
      ) : null}
    </div>
  );
};
