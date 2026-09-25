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
import { TERM, useTermPalette, useSeverityInk } from '@/lib/terminal/palette';

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

/**
 * The same instants as `hourLabels`, written out for the tooltip.
 *
 * The axis carries clock times only, because four of them across 240px is all
 * that fits. A reader hovering a point is asking which hour it is, and on a
 * 72-hour window the hour alone is ambiguous three times over - the date has
 * to be there.
 */
function hourStamps(endsAt: string | null, count: number): string[] {
  if (!endsAt || count === 0) return [];
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return [];
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return Array.from({ length: count }, (_, i) =>
    fmt.format(new Date(end.getTime() - (count - 1 - i) * 3_600_000)),
  );
}

/**
 * Fallback plot width, used only until the element has been measured.
 *
 * The svg used to carry a fixed `viewBox="0 0 240 h"` with a fixed height, and
 * `preserveAspectRatio` defaults to `xMidYMid meet`: the height pinned the
 * scale at 1, so a 240-unit chart sat centred in however wide the card was,
 * with dead space either side. In a 536px card the line occupied the middle
 * 240px and the crosshair missed the cursor by up to 148px at the ends.
 *
 * `preserveAspectRatio="none"` would stretch it, and distort every dot into an
 * ellipse and every stroke with it. Measuring instead keeps the scale at 1:1,
 * so nothing is deformed and a pixel in the box is a pixel on screen.
 */
const W_FALLBACK = 240;
const PAD = 8;

export function MeasuredTrend({
  values,
  color,
  height = 72,
  showAxis = false,
  endsAt = null,
  emptyNote,
  caption = null,
  valueLabel,
}: {
  values: (number | null)[];
  color: string;
  height?: number;
  showAxis?: boolean;
  /** ISO timestamp of the final sample, for the hour axis. */
  endsAt?: string | null;
  /**
   * What to say when there is nothing to draw.
   *
   * The default is right for the archive, where an empty window means the
   * instrument did not report. It is wrong for a live station, where no window
   * exists yet at all - saying "no readings" there would blame the sensor for
   * an absence that is ours. The caller knows which case it is in.
   */
  emptyNote?: string;
  /** Printed under the line when the series is not hourly readings. */
  caption?: string | null;
  /**
   * What one value is, for the hover readout - "CPCB sub-index" or a unit.
   * The series is whichever of the two the feed gave, and only the caller
   * knows which, so a bare number in the tooltip would be unlabelled.
   */
  valueLabel?: string;
}) {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  const id = React.useId();
  const [hover, setHover] = React.useState<number | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = React.useState(W_FALLBACK);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setPlotW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Nearest reported point to the pointer.
  //
  // Converted through the svg's own matrix, and then past `PAD`.
  //
  // The old mapping spread the pointer across the container's full width while
  // the series is inset by PAD at each end and the viewBox was a fixed 240
  // inside an element that was not - `xMidYMid meet` letterboxed the
  // difference rather than stretching. On a 262.4px card that put the first
  // point 19.2px in with the run spanning 224px, so the crosshair led the
  // cursor by up to a fifth of the track, worst at the ends.
  //
  // The viewBox now tracks the measured width, so the letterbox is gone and
  // the matrix is 1:1 - but going through it anyway costs nothing and stays
  // right under a page zoom or any transform on an ancestor, neither of which
  // a bounding-box subtraction survives.
  //
  // Nulls are skipped, so hovering a gap snaps to the nearest hour that
  // actually reported instead of reading out a hole.
  const svgRef = React.useRef<SVGSVGElement>(null);
  const onMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!ctm) return;
      const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const target = ((at.x - PAD) / (plotW - PAD * 2)) * (values.length - 1);
      let best = -1;
      let bestD = Infinity;
      values.forEach((v, i) => {
        if (v == null) return;
        const d = Math.abs(i - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setHover(best >= 0 ? best : null);
    },
    [values, plotW],
  );

  const w = plotW;
  const h = height;
  const pad = PAD;

  const present = values.filter((v): v is number => v != null);
  if (values.length === 0 || present.length === 0) {
    return (
      <div
        className="flex items-center justify-center font-mono text-[10px] text-term-outline"
        style={{ height: h }}
      >
        {emptyNote ?? 'No readings in this window'}
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

  const stamps = hourStamps(endsAt, values.length);

  const labels = hourLabels(endsAt, values.length);
  const TICKS = 4;
  const ticks = labels.length
    ? Array.from({ length: TICKS }, (_, k) =>
        labels[Math.round((k / (TICKS - 1)) * (labels.length - 1))],
      )
    : [];

  const hoverV = hover != null ? values[hover] : null;

  return (
    <div
      ref={boxRef}
      className="relative w-full"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        ref={svgRef}
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

        {/* The hovered hour. `pointer-events: none` on the whole overlay - the
            move handler is on the container, and a shape under the cursor that
            captured events would make the readout flicker as it chased itself. */}
        {hover != null && hoverV != null ? (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad / 2}
              y2={h - pad / 2}
              stroke={TERM.outline}
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <circle cx={x(hover)} cy={y(hoverV)} r="4" fill={color} stroke={TERM.ink} strokeWidth="1.5" />
          </g>
        ) : null}
      </svg>

      {/* Readout, inside the plot rather than above it.
          `-translate-y-full` put it over the chart's top edge, and the card
          around it is `overflow-hidden` - measured at 320 against a card
          starting at 327, so the first seven pixels were sliced off. Sitting
          it at the top of the track keeps it inside every ancestor that clips.

          Horizontally it follows the crosshair, clamped to 12-88% so a point
          at either end does not hang past the track. */}
      {hover != null && hoverV != null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-term-outline-variant/70 bg-term-surface-lowest/95 px-2 py-1 font-mono text-[10px] shadow-lg backdrop-blur-sm"
          style={{
            left: `${Math.min(88, Math.max(12, ((PAD + (hover / Math.max(1, values.length - 1)) * (plotW - PAD * 2)) / plotW) * 100))}%`,
          }}
        >
          <div className="text-term-ink-variant">{stamps[hover] ?? `hour ${hover + 1}`}</div>
          <div className="font-bold" style={{ color: ink(color) }}>
            {Number.isInteger(hoverV) ? hoverV : hoverV.toFixed(1)}
            {valueLabel ? <span className="ml-1 font-normal text-term-outline">{valueLabel}</span> : null}
          </div>
        </div>
      ) : null}

      {caption ? (
        <div className="mt-0.5 font-mono text-[10px] text-term-outline">{caption}</div>
      ) : null}

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
          <span className="font-bold" style={{ color: ink(color) }}>
            {labels[labels.length - 1]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
