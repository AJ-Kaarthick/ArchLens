import React, { forwardRef } from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: 'sm' | 'md' | 'lg';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', selectSize = 'md', children, disabled, ...props }, ref) => {
    const sizeStyles = {
      sm: 'py-1.5 text-xs px-2.5',
      md: 'py-2 text-xs px-3',
      lg: 'py-2.5 text-sm px-3.5',
    };

    return (
      <select
        ref={ref}
        disabled={disabled}
        className={`bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${sizeStyles[selectSize]} ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';
