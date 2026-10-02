
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Small mono status chip. Pass an explicit `color` for AQI/alert semantics. */
export function Badge({
  children,
  color,
  className,
  dot = false,
  pulse = false,
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-sans text-xs font-medium tracking-normal',
        !color && 'border-hairline bg-elevated/60 text-muted',
        className,
      )}
      style={
        color
          ? { borderColor: `${color}55`, background: `${color}1A`, color }
          : undefined
      }
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: color ?? 'currentColor' }}
            />
          )}
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: color ?? 'currentColor' }}
          />
        </span>
      )}
      {children}
    </span>
  );
}
