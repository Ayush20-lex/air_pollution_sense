'use client';

import * as React from 'react';
import { aqiColor } from '@/lib/aqi';

/**
 * Dependency-free sparkline used in the intro HUD and compact panels.
 * Draws an area + line and marks the peak.
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

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z`;

  const peakIdx = values.indexOf(max);
  const color = stroke ?? aqiColor(max);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Trend, peak ${max.toFixed(0)}`}
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {showPeak && (
        <>
          <circle cx={x(peakIdx)} cy={y(max)} r="2.6" fill={color} />
          <circle cx={x(peakIdx)} cy={y(max)} r="5.5" fill={color} opacity="0.22" />
        </>
      )}
    </svg>
  );
}
