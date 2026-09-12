import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'rectangular' | 'text' | 'circular';
}

export function Skeleton({
  className = '',
  variant = 'rectangular',
  ...props
}: SkeletonProps) {
  const variantStyles = {
    rectangular: 'rounded-lg',
    text: 'rounded h-4',
    circular: 'rounded-full',
  };

  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-slate-800/80 ${variantStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function CardSkeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3.5 ${className}`}>
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" className="w-8 h-8" />
        <Skeleton variant="text" className="w-1/3 h-4" />
      </div>
      <div className="space-y-2 pt-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            variant="text"
            className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
          />
        ))}
      </div>
    </div>
  );
}

export function CodeSnippetSkeleton() {
  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden space-y-3 p-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <Skeleton variant="text" className="w-1/4 h-4" />
        <Skeleton variant="text" className="w-16 h-4" />
      </div>
      <div className="space-y-2 pt-2">
        <Skeleton variant="text" className="w-4/5 h-3" />
        <Skeleton variant="text" className="w-full h-3" />
        <Skeleton variant="text" className="w-3/5 h-3" />
        <Skeleton variant="text" className="w-2/3 h-3" />
      </div>
    </div>
  );
}
