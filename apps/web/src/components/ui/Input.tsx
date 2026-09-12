import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  inputSize?: 'sm' | 'md' | 'lg';
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = '',
      icon,
      inputSize = 'md',
      error = false,
      disabled,
      ...props
    },
    ref
  ) => {
    const sizeStyles = {
      sm: 'py-1.5 text-xs',
      md: 'py-2 text-xs',
      lg: 'py-2.5 text-sm',
    };

    const paddingStyles = icon ? (inputSize === 'lg' ? 'pl-10 pr-4' : 'pl-9 pr-3') : 'px-3';

    return (
      <div className="relative flex-1 flex items-center">
        {icon && (
          <div className="absolute left-3 text-slate-500 pointer-events-none flex items-center justify-center">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          disabled={disabled}
          className={`w-full bg-slate-950 text-slate-200 placeholder-slate-500 border rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
            error ? 'border-red-700 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-800 hover:border-slate-700'
          } ${sizeStyles[inputSize]} ${paddingStyles} ${className}`}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = 'Input';
