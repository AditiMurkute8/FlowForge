import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={14} className="text-[var(--status-green-text)] shrink-0" />,
  warning: <AlertTriangle size={14} className="text-[var(--status-yellow-text)] shrink-0" />,
  error: <AlertCircle size={14} className="text-[var(--status-red-text)] shrink-0" />,
  info: <Info size={14} className="text-[var(--accent-blue)] shrink-0" />,
};

const borderColors: Record<ToastType, string> = {
  success: 'border-[var(--status-green-border)]',
  warning: 'border-[var(--status-yellow-border)]',
  error: 'border-[var(--status-red-border)]',
  info: 'border-[var(--status-blue-border)]',
};

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (!toast) return;
    const duration = toast.duration ?? 3500;
    const timer = setTimeout(() => {
      onDismiss();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2.5 rounded-[6px] border bg-[var(--bg-surface)] p-3 text-[var(--text-primary)] shadow-xl ${borderColors[toast.type]}`}
    >
      <div className="mt-0.5">{icons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{toast.title}</h4>
        {toast.message && (
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] break-words">
            {toast.message}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5 rounded transition-colors cursor-pointer"
      >
        <X size={13} />
      </button>
    </div>
  );
};
