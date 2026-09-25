import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Shared atoms for the public terminal. Every panel on this surface is one of
 * these, so the glass treatment and the label voice stay in one place.
 */

/**
 * The way out of a preview.
 *
 * Live Telemetry shows the first few of several sections and each has a page
 * of its own. Without this the preview is a dead end that looks like the whole
 * thing - a reader counting four pollutant cards has no way to know there are
 * eight.
 */
export function SeeAll({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider text-term-primary transition-colors hover:text-term-ink"
    >
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

/** Frosted panel — the core surface of the terminal. */
export function TelemetryCard({
  className,
  focus,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { focus?: boolean }) {
  return (
    <div
      className={cn('telemetry-card rounded-2xl', focus && 'telemetry-card-focus', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 10px uppercase mono caption — the terminal's label voice. */
export function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'font-mono text-[10px] font-semibold uppercase tracking-wider text-term-ink-variant',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Section heading used above each block of the overview. */
export function SectionHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-term-ink">{title}</h2>
        {sub ? <p className="font-body text-xs text-term-ink-variant">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Signed 24-hour delta. Up is bad on this surface, so it reads orange. */
export function Delta({ value, className }: { value: number; className?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        'font-mono font-bold tabular-nums',
        up ? 'text-orange-700 dark:text-orange-400' : 'text-term-primary',
        className,
      )}
    >
      {up ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/** Small status pill — colour carried by an explicit token, never by text alone. */
export function Pill({
  color,
  children,
  className,
}: {
  color: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
        className,
      )}
      style={{
        color,
        borderColor: `${color}66`,
        background: `${color}1f`,
      }}
    >
      {children}
    </span>
  );
}

/** Thin severity meter used by the KPI tiles and the pollutant grid. */
export function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-term-surface-high">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

/**
 * Dependency-free sparkline. The intro has `MiniSparkline`, but that one
 * colours itself from PM2.5 concentration; this surface passes its own colour
 * and needs a flat-series fallback for constants like spatial resolution.
 */
export function Spark({
  values,
  color,
  width = 120,
  height = 40,
  fill = false,
  className,
}: {
  values: readonly number[];
  color: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
}) {
  const id = React.useId();
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={`url(#sp-${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
