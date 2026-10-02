import * as React from 'react';
import { aqiColor } from '@/lib/aqi';
import { cn } from '@/lib/utils';

/**
 * Computes a smooth cubic spline curve (Catmull-Rom / monotone style)
 * across sequential data points instead of a rigid, stepped linear line.
 */
function getSplinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i > 0 ? i - 1 : 0];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/**
 * Fluid, responsive sparkline with smooth spline path, supporting both light and dark mode.
 */
export function MiniSparkline({
  values,
  width = 220,
  height = 46,
  stroke,
  showPeak = true,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  showPeak?: boolean;
  className?: string;
}) {
  const id = React.useId();
  if (!values.length) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const points = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = getSplinePath(points);
  const area = `${line} L ${x(values.length - 1).toFixed(2)},${height} L ${x(0).toFixed(2)},${height} Z`;

  const peakIdx = values.indexOf(max);
  const color = stroke ?? aqiColor(max);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('w-full h-auto max-h-[96px] overflow-visible', className)}
      role="img"
      aria-label={`Trend, peak ${max.toFixed(0)}`}
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {showPeak && (
        <>
          <circle cx={x(peakIdx)} cy={y(max)} r="2.5" fill={color} />
          <circle cx={x(peakIdx)} cy={y(max)} r="5" fill={color} opacity="0.25" />
        </>
      )}
    </svg>
  );
}
