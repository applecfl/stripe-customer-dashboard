'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  allowOverflow?: boolean;
}

export function Card({ children, className, allowOverflow }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm',
        allowOverflow ? 'overflow-visible' : 'overflow-hidden',
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function CardHeader({ children, className, action }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-center justify-between gap-2',
        className
      )}
    >
      <div className="font-semibold text-gray-900 text-sm sm:text-base">{children}</div>
      {action && <div className="text-xs sm:text-sm">{action}</div>}
    </div>
  );
}

interface CardContentProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function CardContent({ children, className, noPadding }: CardContentProps) {
  return (
    <div className={cn(noPadding ? '' : 'p-4 sm:p-6', className)}>
      {children}
    </div>
  );
}
