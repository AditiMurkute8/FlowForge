import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  onClick,
  hoverable = false,
}) => {
  return (
    <div
      onClick={onClick}
      className={`rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 text-[var(--text-primary)] transition-colors duration-100 shadow-xs ${
        hoverable ? 'hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-hover)] cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};
