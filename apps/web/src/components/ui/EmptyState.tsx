import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`bg-slate-900/40 border border-slate-800/80 rounded-xl p-10 text-center flex flex-col items-center justify-center space-y-3 ${className}`}
    >
      {icon && (
        <div className="p-3 bg-slate-800/80 text-slate-400 rounded-xl border border-slate-700/60 mb-1">
          {icon}
        </div>
      )}
      <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
      {description && (
        <p className="text-xs text-slate-400 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
