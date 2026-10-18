import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  className = '',
  showCloseButton = true,
  closeOnBackdrop = true,
}: ModalProps) => {
  const titleId = useId();
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] h-[90vh]',
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnBackdrop ? onClose : undefined}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}
            style={{ maxHeight: 'calc(100vh - 2rem)' }}
            className={`relative w-full bg-bg-primary text-text-primary rounded-2xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col border border-border-primary/40 ${sizes[size]} ${className}`}
          >
            {(title || showCloseButton) && (
              <div className="shrink-0 px-6 py-4 border-b border-border-soft/20 flex items-center justify-between bg-bg-primary sticky top-0 z-10">
                {title && <h3 id={titleId} className="text-lg font-bold text-text-primary tracking-tight">{title}</h3>}
                {showCloseButton && (
                  <button
                    aria-label="关闭弹窗"
                    onClick={onClose}
                    className="p-1.5 rounded-xl hover:bg-bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
            
            <div className="min-h-0 flex-1 overflow-y-auto p-6 text-text-primary">
              {children}
            </div>
            
            {footer && (
              <div className="shrink-0 px-6 py-4 border-t border-border-soft/20 bg-bg-primary flex items-center justify-end gap-3 sticky bottom-0 z-10">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};
