import React from 'react';
import { motion } from 'motion/react';
import { LucideIcon, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  variant?: 'full' | 'compact';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Sparkles,
  title,
  description,
  actionLabel,
  onAction,
  className,
  variant = 'full'
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-col items-center justify-center text-center p-8",
        variant === 'full' ? "flex-1" : "py-12",
        className
      )}
    >
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-violet-200 dark:bg-violet-900/20 blur-3xl rounded-full opacity-50 scale-150" />
        <div className="relative w-24 h-24 bg-white dark:bg-neutral-900 rounded-[2rem] flex items-center justify-center shadow-[0_20px_50px_rgba(139,92,246,0.15)] border border-violet-50 dark:border-violet-900/20 active:scale-95 transition-transform">
          <Icon className="w-10 h-10 text-violet-600 dark:text-violet-400" />
        </div>
        
        {/* Animated Orbs */}
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.5, 0.8, 0.5],
            x: [0, 5, 0],
            y: [0, -5, 0]
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-4 -right-4 w-8 h-8 bg-pink-100 dark:bg-pink-900/20 rounded-full flex items-center justify-center border border-pink-50 dark:border-pink-900/20"
        >
          <div className="w-2 h-2 bg-pink-500 rounded-full blur-[1px]" />
        </motion.div>
        
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.4, 0.7, 0.4],
            x: [0, -4, 0],
            y: [0, 6, 0]
          }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -bottom-2 -left-4 w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center border border-blue-50 dark:border-blue-900/20"
        >
          <div className="w-2 h-2 bg-blue-500 rounded-full blur-[1px]" />
        </motion.div>
      </div>
      
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">
        {title}
      </h3>
      <p className="text-gray-500 dark:text-neutral-400 max-w-sm leading-relaxed mb-10 text-lg">
        {description}
      </p>
      
      {actionLabel && onAction && (
        <Button 
          onClick={onAction}
          className="rounded-2xl h-14 px-10 text-lg shadow-2xl shadow-violet-500/20 active:scale-95 transition-all"
        >
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
};
