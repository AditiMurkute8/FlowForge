import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: string;
  icon?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtext,
  trend,
  icon,
}) => {
  return (
    <div className="flex flex-col justify-between rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-3 hover:border-[var(--border-emphasis)] transition-colors shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
          {label}
        </span>
        {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight text-[var(--text-primary)] font-mono">
          {value}
        </span>
        {trend && (
          <span className="text-[11px] font-mono font-medium text-[var(--status-green-text)]">
            {trend}
          </span>
        )}
      </div>
      {subtext && (
        <span className="mt-1 text-[11px] text-[var(--text-muted)] truncate">{subtext}</span>
      )}
    </div>
  );
};
