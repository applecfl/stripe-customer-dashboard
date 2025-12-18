'use client';

import { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
  mobileOnly?: boolean;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  mobileOnly = true,
}: TooltipProps) {
  if (!content) {
    return <>{children}</>;
  }

  // mobileOnly: show tooltip only on mobile (hidden on sm: and above)
  // !mobileOnly: show tooltip on all screen sizes
  const visibilityClass = mobileOnly
    ? 'sm:hidden opacity-0 group-hover/tooltip:opacity-100'
    : 'opacity-0 group-hover/tooltip:opacity-100';

  return (
    <div className="relative group/tooltip inline-flex items-center">
      {children}
      <div
        className={`absolute z-[9999] px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded-md shadow-lg whitespace-nowrap pointer-events-none transition-opacity duration-150 ${visibilityClass} ${
          position === 'top'
            ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
            : 'top-full left-1/2 -translate-x-1/2 mt-1.5'
        }`}
      >
        {content}
        {/* Arrow */}
        <div
          className={`absolute w-2 h-2 bg-gray-900 rotate-45 left-1/2 -translate-x-1/2 ${
            position === 'top' ? '-bottom-1' : '-top-1'
          }`}
        />
      </div>
    </div>
  );
}
