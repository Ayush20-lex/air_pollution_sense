'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** Glassmorphic panel used everywhere in the console. */
export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('glass relative', className)} {...props} />
  ),
);
Panel.displayName = 'Panel';

export function PanelHeader({
  title,
  icon,
  action,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-hairline/60 px-3 py-2',
        className,
      )}
    >
      <span className="panel-title">
        {icon}
        {title}
      </span>
      {action}
    </div>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-3', className)} {...props} />;
}
