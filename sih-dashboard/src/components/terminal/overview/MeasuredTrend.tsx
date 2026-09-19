/**
 * The measured 24-hour window for one pollutant.
 *
 * Unlike the demo sparkline this takes `(number | null)[]`, and the nulls are
 * the point: a gap is an hour the instrument did not report, or one the QC
 * rejected. Drawing a line across it would invent a reading for exactly the
 * hours we know nothing about — which is how Anand Vihar's dead sensor came to
 * publish sixteen hours of "clean air" in the first place.
 *
 * So the line breaks at gaps and the missing hours are marked underneath.
 */
import * as React from 'react';
import { TERM } from '@/lib/terminal/palette';

/**
 * Hour labels in IST.
 *
 * Real clock times rather than "T-24h ... Now": this window is replayed from
 * the archive, not streamed, so "Now" would be claiming a currency the data
 * does not have. `endsAt` is the hour the last sample describes.
 */
function hourLabels(endsAt: string | null, count: number): string[] {
  if (!endsAt || count === 0) return [];
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return [];
  return Array.from({ length: count }, (_, i) => {
    const t = new Date(end.getTime() - (count - 1 - i) * 3_600_000);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(t);
  });
}

export function MeasuredTrend({
  values,
  color,
  height = 72,
  showAxis = false,
  endsAt = null,
}: {
  values: (number | null)[];
  color: string;
  height?: number;
  showAxis?: boolean;
  /** ISO timestamp of the final sample, for the hour axis. */
  endsAt?: string | null;
}) {
  const id = React.useId();
  const w = 240;
  const h = height;
  const pad = 8;

  const present = values.filter((v): v is number => v != null);
  if (values.length === 0 || present.length === 0) {
    return (
      <div
        className="flex items-center justify-center font-mono text-[10px] text-term-outline"
        style={{ height: h }}
      >
        No readings in this window
      </div>
    );
  }

  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2.5);

  // One path per unbroken run, so a gap leaves a hole instead of a chord.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v });
    }
  });
  if (run.length) runs.push(run);

  const lastIdx = values.reduce((acc, v, i) => (v != null ? i : acc), -1);

  const labels = hourLabels(endsAt, values.length);
  const TICKS = 4;
  const ticks = labels.length
    ? Array.from({ length: TICKS }, (_, k) =>
        labels[Math.round((k / (TICKS - 1)) * (labels.length - 1))],
      )
    : [];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full overflow-visible"
        style={{ height: h }}
        role="img"
        aria-label={`24 hour trend, ${present.length} of ${values.length} hours reported`}
      >
        <defs>
          <linearGradient id={`mt-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* missing hours, marked on the baseline */}
        {values.map((v, i) =>
          v == null ? (
            <rect
              key={`gap-${i}`}
              x={x(i) - (w - pad * 2) / values.length / 2}
              y={h - 3}
              width={(w - pad * 2) / values.length}
              height={3}
              fill={TERM.outlineVariant}
            />
          ) : null,
        )}

        {runs.map((r, ri) => {
          const line = r
            .map((pt, k) => `${k === 0 ? 'M' : 'L'}${x(pt.i).toFixed(1)},${y(pt.v).toFixed(1)}`)
            .join(' ');
          // A single point has no line to draw; the dot below still shows it.
          const area =
            r.length > 1
              ? `${line} L${x(r[r.length - 1].i).toFixed(1)},${h - pad} L${x(r[0].i).toFixed(1)},${h - pad} Z`
              : '';
          return (
            <g key={ri}>
              {area ? <path d={area} fill={`url(#mt-${id})`} /> : null}
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {values.map((v, i) =>
          v == null ? null : (
            <circle
              key={`pt-${i}`}
              cx={x(i)}
              cy={y(v)}
              r={i === lastIdx ? 3.5 : 1.8}
              fill={color}
              stroke={i === lastIdx ? TERM.ink : 'none'}
              strokeWidth="1"
            />
          ),
        )}
      </svg>

      {showAxis ? (
        <div className="mt-1 space-y-0.5">
          {/* Four ticks across the window - every hour would not fit at this
              width, and the ends plus two interior marks are enough to read
              the shape against the clock. */}
          <div className="flex justify-between font-mono text-[10px] text-term-ink-variant">
            {ticks.length > 0 ? (
              ticks.map((t, i) => (
                <span key={i} className={i === ticks.length - 1 ? 'font-bold' : undefined}
                      style={i === ticks.length - 1 ? { color } : undefined}>
                  {t}
                </span>
              ))
            ) : (
              <>
                <span>{values.length - 1}h ago</span>
                <span>latest</span>
              </>
            )}
          </div>
          <div className="flex justify-between font-mono text-[10px] text-term-outline">
            <span>{labels.length ? `${values.length}h window · IST` : ''}</span>
            <span>
              {min.toFixed(0)}–{max.toFixed(0)} range
            </span>
          </div>
        </div>
      ) : labels.length ? (
        <div className="mt-0.5 flex justify-between font-mono text-[10px] text-term-ink-variant">
          <span>{labels[0]}</span>
          <span className="font-bold" style={{ color }}>
            {labels[labels.length - 1]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
