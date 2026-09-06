
import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Compact telemetry tile. The value animates on change so timeline scrubbing
 * reads as a live instrument rather than a static number.
 */
export function MetricCard({
  label,
  value,
  unit,
  icon,
  color,
  hint,
  trend,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  color?: string;
  hint?: string;
  trend?: number;
}) {
  return (
    <div className="group relative overflow-hidden p-2.5">
      <div className="flex items-center justify-between">
        <span className="hud-label">{label}</span>
        <span className="text-faint transition-colors group-hover:text-accent">{icon}</span>
      </div>

      <motion.div
        key={String(value)}
        initial={{ opacity: 0.35, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="mt-1 flex items-baseline gap-1"
      >
        <span
          className="font-mono text-xl font-semibold tabular-nums tracking-tight"
          style={{ color: color ?? 'rgb(var(--as-ink))' }}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-2xs text-faint">{unit}</span>}
      </motion.div>

      {(hint || trend !== undefined) && (
        <div className="mt-0.5 flex items-center gap-1 font-mono text-2xs text-faint">
          {trend !== undefined && (
            <span className={cn(trend > 0 ? 'text-emergency' : trend < 0 ? 'text-good' : 'text-faint')}>
              {trend > 0 ? '▲' : trend < 0 ? '▼' : '■'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}
