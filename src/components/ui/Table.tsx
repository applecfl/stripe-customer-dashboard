'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
  allowOverflow?: boolean;
}

export function Table({ children, className, allowOverflow }: TableProps) {
  return (
    <div className={cn(allowOverflow ? 'overflow-visible' : 'overflow-x-auto', className)}>
      <table className={cn('w-full', !allowOverflow && 'min-w-[650px] sm:min-w-0')}>{children}</table>
    </div>
  );
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

export function TableHeader({ children, className }: TableHeaderProps) {
  return (
    <thead className={cn('bg-gray-50/80', className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

export function TableBody({ children, className }: TableBodyProps) {
  return <tbody className={cn('divide-y divide-gray-100', className)}>{children}</tbody>;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function TableRow({ children, className, onClick, hoverable = true }: TableRowProps) {
  return (
    <tr
      className={cn(
        'transition-colors',
        hoverable && 'hover:bg-gray-50/50',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableHeadProps {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableHead({ children, className, align = 'left' }: TableHeadProps) {
  const alignments = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <th
      className={cn(
        'px-3 sm:px-6 py-2.5 sm:py-3.5 text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider',
        alignments[align],
        className
      )}
    >
      {children}
    </th>
  );
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableCell({ children, className, align = 'left' }: TableCellProps) {
  const alignments = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <td
      className={cn(
        'px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-700 whitespace-nowrap',
        alignments[align],
        className
      )}
    >
      {children}
    </td>
  );
}

interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
}

export function TableEmptyState({ message, icon }: EmptyStateProps) {
  return (
    <tr>
      <td colSpan={100} className="px-6 py-12 text-center">
        <div className="flex flex-col items-center gap-3">
          {icon && <div className="text-gray-300">{icon}</div>}
          <p className="text-gray-500 text-sm">{message}</p>
        </div>
      </td>
    </tr>
  );
}
