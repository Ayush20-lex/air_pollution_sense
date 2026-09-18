import * as React from 'react';
import { Flag, RotateCw, Square } from 'lucide-react';
import { Label } from '@/components/terminal/TerminalPrimitives';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { HORIZON_HOURS, type TerminalFrame } from '@/lib/terminal/field';
import { cn } from '@/lib/utils';
import { useTerminalStore, type PlaybackRate } from '@/store/useTerminalStore';

/**
 * The 72-hour forecast scrub for the plume map.
 *
 * It replaced a video transport: play, skip-back, skip-forward and an empty
 * grey rail. The rail was the problem — the readings sat behind it and it drew
 * none of them, so finding the overnight peak meant scrubbing until the map
 * went red. A media player is the right shape for media, where the content is
 * only legible in motion; this content is a series, and a series can be shown
 * all at once.
 *
 * So the rail carries the data: one column per frame, height proportional to
 * that hour's mesh mean AQI, filled with its CPCB band colour. The shape of
 * the night — build-up after the PBL collapses, decay once it lifts — is
 * readable without pressing anything, and a click lands on the hour you want
 * instead of stepping toward it. That retires the skip buttons.
 *
 * Columns are drawn from zero, not from the lowest reading. A truncated
 * baseline exaggerates differences, and the whole point of the strip is that
 * the relative heights can be trusted at a glance.
 *
 * Interaction stays on a native range input, kept transparent above the SVG:
 * it brings click-to-position, drag, arrow keys, Home/End and the correct
 * ARIA semantics with it. Re-implementing those on a div is how sliders end
 * up unreachable by keyboard.
 *
 * The controls beside it are the two questions a forecast is actually asked —
 * when is it worst, and take me back to now — rather than a play triangle. A
 * transport answers neither; PEAK answers the first in one press and names the
 * hour on its face, so the answer is legible before the press. Auto-advance
 * survives as SWEEP because it drives the map, not the strip: watching the
 * plume cross the basin is the one thing 73 columns cannot show.
 *
 * Midnight divisions are marked, because three days of hourly columns read as
 * an undifferentiated comb without them.
 */

const RATES: PlaybackRate[] = [1, 4, 12];

/** Tallest column, as a share of the strip. Leaves headroom for the cap line. */
const PEAK = 92;

/** Mean AQI across the 26 mesh nodes for one frame. */
function meanAqi(frame: TerminalFrame): number {
  const nodes = Object.values(frame.nodes);
  if (!nodes.length) return 0;
  return Math.round(nodes.reduce((sum, n) => sum + n.aqi, 0) / nodes.length);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function TimelineTrack({ frames }: { frames: TerminalFrame[] }) {
  const frameIndex = useTerminalStore((s) => s.frameIndex);
  const setFrameIndex = useTerminalStore((s) => s.setFrameIndex);
  const playing = useTerminalStore((s) => s.playing);
  const togglePlay = useTerminalStore((s) => s.togglePlay);
  const rate = useTerminalStore((s) => s.rate);
  const setRate = useTerminalStore((s) => s.setRate);

  const count = frames.length;
  const last = count - 1;
  const current = Math.min(frameIndex, last);

  // Recomputed only when the window is rebuilt, not on every scrub tick.
  const series = React.useMemo(() => frames.map(meanAqi), [frames]);
  const peak = React.useMemo(() => Math.max(...series, 1), [series]);

  // Stops at the horizon rather than looping: running off +72h back to NOW
  // would imply the window wraps, and it does not.
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { frameIndex: i, setFrameIndex: set, setPlaying: stop } = useTerminalStore.getState();
      if (i >= last) {
        stop(false);
        return;
      }
      set(i + 1);
    }, 900 / rate);
    return () => clearInterval(id);
  }, [playing, rate, last]);

  // Which column the pointer is over, or null when it has left the strip.
  // Hovering reads an hour without moving the map off the one being watched.
  const [hover, setHover] = React.useState<number | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);

  const readIndex = (clientX: number) => {
    const el = stripRef.current;
    if (!el) return null;
    const { left, width } = el.getBoundingClientRect();
    if (width <= 0) return null;
    const ratio = (clientX - left) / width;
    return Math.max(0, Math.min(last, Math.floor(ratio * count)));
  };

  // Worst hour in the window. Recomputed with the series, not per render.
  const peakIndex = React.useMemo(
    () => series.reduce((best, v, i) => (v > series[best] ? i : best), 0),
    [series],
  );

  // Local midnights, so three days of columns are readable as three days.
  const midnights = React.useMemo(
    () => frames.map((f, i) => (f.localHour === 0 ? i : -1)).filter((i) => i > 0),
    [frames],
  );

  const peakBand = bandForAqi(series[peakIndex]);
  const peakHour = `${pad2(frames[peakIndex].localHour)}:00`;

  const shown = hover ?? current;
  const shownFrame = frames[shown];
  const shownAqi = series[shown];
  const shownBand = bandForAqi(shownAqi);

  return (
    <div className="mt-2 rounded-xl border border-term-outline-variant/60 bg-term-surface-low px-3 py-2.5">
      {/* Wraps below sm. Sharing one row there leaves the strip 32px wide —
          1.3px an hour, which is not a chart of anything — so it drops to its
          own full-width line and the controls keep the row above. */}
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        {/* Names the hour and its reading on its face, so the worst point in
            the window is legible before anything is pressed. */}
        <button
          type="button"
          onClick={() => setFrameIndex(peakIndex)}
          aria-label={`Jump to the worst forecast hour, ${peakHour}, mesh mean AQI ${series[peakIndex]}`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60',
            current === peakIndex
              ? 'border-term-primary/50 bg-term-primary/15 text-term-primary'
              : 'border-term-outline-variant/60 bg-term-surface-high text-term-ink-variant hover:text-term-ink',
          )}
        >
          <Flag className="size-3" style={{ color: peakBand.color }} />
          <span className="tabular-nums">PEAK {peakHour}</span>
          <span className="tabular-nums" style={{ color: peakBand.color }}>
            {series[peakIndex]}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFrameIndex(0)}
          disabled={current === 0}
          aria-label="Return to the present hour"
          className="flex shrink-0 items-center rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-2.5 py-1.5 font-mono text-[10px] font-bold text-term-ink-variant transition-colors hover:text-term-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60 disabled:opacity-40 disabled:hover:text-term-ink-variant"
        >
          NOW
        </button>

        <div
          ref={stripRef}
          className="relative order-last h-11 w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"
          onPointerMove={(e) => setHover(readIndex(e.clientX))}
          onPointerLeave={() => setHover(null)}
        >
          {/* preserveAspectRatio="none" so the columns stretch to whatever
              width the row has. Nothing here is text or a curve, so the
              distortion has nothing to spoil — and it keeps the geometry in
              frame units instead of pixels. */}
          <svg
            aria-hidden
            viewBox={`0 0 ${count * 4} 100`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full"
          >
            {/* Day divisions first, so the columns sit over them. */}
            {midnights.map((i) => (
              <rect key={`mn-${i}`} x={i * 4 - 0.5} y={0} width={0.5} height={100} fill="#94a3b8" opacity={0.22} />
            ))}
            {series.map((aqi, i) => {
              const h = (aqi / peak) * PEAK;
              return (
                <rect
                  key={i}
                  x={i * 4 + 0.5}
                  y={100 - h}
                  width={3}
                  height={h}
                  fill={aqiColor(aqi)}
                  // Hours the playhead has not reached sit back, so the strip
                  // still reports playback position now the scrubber is gone.
                  opacity={i === hover ? 1 : i <= current ? 0.88 : 0.3}
                />
              );
            })}
          </svg>

          {/* Playhead in HTML rather than in the SVG: a 2px line stays 2px,
              where a rect in a non-uniformly scaled viewBox would not. */}
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-term-primary/90"
            style={{ left: `${((current + 0.5) / count) * 100}%` }}
          />

          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={current}
            onChange={(e) => setFrameIndex(Number(e.target.value))}
            aria-label="Hour of the 72-hour forecast"
            aria-valuetext={`${pad2(shownFrame.localHour)}:00 IST, mesh mean AQI ${shownAqi}, ${shownBand.label}`}
            className="peer absolute inset-0 size-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
          <div className="pointer-events-none absolute -inset-1 rounded-md opacity-0 ring-2 ring-term-primary/70 peer-focus-visible:opacity-100" />
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-[11px] font-bold tabular-nums text-term-ink">
            {frames[current].offset === 0 ? 'NOW' : `+${frames[current].offset}h`}
          </div>
          <Label>
            hour {current} / {HORIZON_HOURS}
          </Label>
        </div>

        {/* Demoted to a labelled toggle beside the speeds. It still drives the
            map — the plume crossing the basin is worth watching — but it is no
            longer the control the eye lands on first. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (!playing && current >= last) setFrameIndex(0);
              togglePlay();
            }}
            aria-pressed={playing}
            className={cn(
              'flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60',
              playing
                ? 'border-term-primary/50 bg-term-primary/15 text-term-primary'
                : 'border-term-outline-variant/60 bg-term-surface-high text-term-ink-variant hover:text-term-ink',
            )}
          >
            {playing ? (
              <Square className="size-2.5 fill-current" />
            ) : (
              <RotateCw className="size-2.5" />
            )}
            {playing ? 'STOP' : 'SWEEP'}
          </button>
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              aria-pressed={rate === r}
              className={cn(
                'rounded border px-2 py-1 font-mono text-[9px] font-bold transition-colors',
                rate === r
                  ? 'border-term-primary/40 bg-term-primary/15 text-term-primary'
                  : 'border-term-outline-variant/60 bg-term-surface-high text-term-ink-variant hover:text-term-ink',
              )}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      {/* One readout line, following the pointer when there is one and the
          playhead otherwise, so hovering can answer "what was 3am" without
          moving the map away from the hour being watched. */}
      <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[9px] text-term-outline">
        <span className="font-bold text-term-primary">NOW</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: shownBand.color }}
          />
          <span className="tabular-nums text-term-ink-variant">
            {pad2(shownFrame.localHour)}:00 IST
          </span>
          <span className="text-term-outline">·</span>
          <span className="tabular-nums text-term-ink-variant">mesh mean {shownAqi}</span>
          <span className="text-term-outline">·</span>
          <span style={{ color: shownBand.color }}>{shownBand.label}</span>
          {hover !== null && <span className="text-term-outline">(hover)</span>}
        </span>
        <span>+{HORIZON_HOURS}h</span>
      </div>
    </div>
  );
}
