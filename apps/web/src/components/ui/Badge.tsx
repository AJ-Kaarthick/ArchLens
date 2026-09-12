import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | 'default'
    | 'primary'
    | 'success'
    | 'warning'
    | 'danger'
    | 'purple'
    | 'cyan'
    | 'neutral';
  size?: 'xs' | 'sm';
  mono?: boolean;
  icon?: React.ReactNode;
}

export function Badge({
  className = '',
  variant = 'default',
  size = 'xs',
  mono = false,
  icon,
  children,
  ...props
}: BadgeProps) {
  const variantStyles = {
    default: 'bg-slate-800 text-slate-300 border-slate-700/80',
    neutral: 'bg-slate-900/80 text-slate-400 border-slate-800',
    primary: 'bg-blue-950/80 text-blue-300 border-blue-800/60',
    success: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    warning: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    danger: 'bg-red-950/80 text-red-300 border-red-800/60',
    purple: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
    cyan: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60',
  };

  const sizeStyles = {
    xs: 'text-[10px] px-2 py-0.5 gap-1',
    sm: 'text-xs px-2.5 py-1 gap-1.5',
  };

  return (
    <span
      className={`inline-flex items-center font-medium border rounded-md select-none transition-colors ${
        mono ? 'font-mono' : ''
      } ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
}
