import React from 'react';
import { motion } from 'motion/react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'glass';
  hoverable?: boolean;
}

export const Card = ({ className = '', variant = 'default', hoverable = false, children, ...props }: CardProps) => {
  const baseStyles = 'rounded-3xl overflow-hidden transition-all duration-300';
  
  const variants = {
    default: 'bg-white dark:bg-neutral-900 shadow-sm border border-gray-100 dark:border-neutral-800/50',
    outline: 'border border-gray-200 dark:border-neutral-800 bg-transparent',
    ghost: 'bg-gray-50 dark:bg-neutral-900/50 border border-transparent',
    glass: 'bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border border-white/20 dark:border-neutral-800/50 shadow-lg',
  };

  const hoverStyles = hoverable ? 'hover:shadow-md hover:border-gray-200 dark:hover:border-neutral-700' : '';

  return (
    <motion.div
      className={`${baseStyles} ${variants[variant]} ${hoverStyles} ${className}`}
      whileHover={hoverable ? { y: -2 } : undefined}
      {...props as any}
    >
      {children}
    </motion.div>
  );
};

export const CardHeader = ({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`px-6 py-4 border-b border-gray-100 dark:border-neutral-800 ${className}`} {...props}>
    {children}
  </div>
);

export const CardContent = ({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`px-6 py-4 ${className}`} {...props}>
    {children}
  </div>
);

export const CardFooter = ({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`px-6 py-4 border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50 ${className}`} {...props}>
    {children}
  </div>
);
