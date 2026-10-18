import React from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'violet';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-full font-bold transition-all focus:outline-none focus:ring-4 focus:ring-offset-0 disabled:opacity-50 disabled:pointer-events-none active:scale-95 tracking-tight';
    
    const variants = {
      primary: 'bg-gray-900 text-white hover:bg-black dark:bg-white dark:text-black dark:hover:bg-gray-200 shadow-lg shadow-gray-900/5 focus:ring-gray-900/10',
      secondary: 'bg-white text-gray-900 border border-gray-100 hover:bg-gray-50 dark:bg-neutral-900 dark:text-white dark:border-neutral-800 dark:hover:bg-neutral-800 shadow-sm focus:ring-gray-100',
      outline: 'border border-gray-100 bg-transparent hover:bg-gray-50 text-gray-500 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 focus:ring-gray-100',
      ghost: 'bg-transparent hover:bg-gray-50 text-gray-500 dark:text-neutral-500 dark:hover:bg-neutral-800 focus:ring-gray-100',
      danger: 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 focus:ring-red-500/10',
      success: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30 focus:ring-emerald-500/10',
      violet: 'bg-violet-600 text-white hover:bg-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500 shadow-lg shadow-violet-600/10 focus:ring-violet-500/10',
    };

    const sizes = {
      sm: 'h-9 px-4 text-xs',
      md: 'h-11 px-6 text-sm',
      lg: 'h-14 px-8 text-base',
      icon: 'h-11 w-11 p-0 rounded-full',
    };

    return (
      <motion.button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        {...(props as any)}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {!isLoading && leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {!isLoading && rightIcon && <span className="ml-2">{rightIcon}</span>}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
