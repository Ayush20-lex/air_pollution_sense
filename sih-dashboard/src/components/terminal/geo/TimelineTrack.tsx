import * as React from 'react';
import { Pause, Play } from 'lucide-react';
import { Label } from '@/components/terminal/TerminalPrimitives';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import type { TerminalFrame } from '@/lib/terminal/field';
import { cn } from '@/lib/utils';
import { useTerminalStore, type PlaybackRate } from '@/store/useTerminalStore';

/**
 * The 24-hour scrub for the plume map.
 *
 * It replaced a video transport: play, skip-back, skip-forward and an empty
 * grey rail. The rail was the problem — twenty-four hours of readings sat
 * behind it and it drew none of them, so finding the overnight peak meant
 * scrubbing until the map went red. A media player is the right shape for
 * media, where the content is only legible in motion; this content is a
 * series, and a series can be shown all at once.
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

  // Playback stops at the present rather than looping — the last frame is now.
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
        <button
          type="button"
          onClick={() => {
            if (!playing && current >= last) setFrameIndex(0);
            togglePlay();
          }}
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-term-primary/40 bg-term-primary/15 text-term-primary transition-colors hover:bg-term-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
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
            aria-label="Hour of the 24-hour window"
            aria-valuetext={`${pad2(shownFrame.localHour)}:00 IST, mesh mean AQI ${shownAqi}, ${shownBand.label}`}
            className="peer absolute inset-0 size-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
          <div className="pointer-events-none absolute -inset-1 rounded-md opacity-0 ring-2 ring-term-primary/70 peer-focus-visible:opacity-100" />
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-[11px] font-bold tabular-nums text-white">
            {frames[current].offset === 0 ? 'NOW' : `T${frames[current].offset}h`}
          </div>
          <Label>
            hour {current + 1} / {count}
          </Label>
        </div>

        <div className="flex shrink-0 gap-1">
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
                  : 'border-term-outline-variant/60 bg-term-surface-high text-slate-400 hover:text-white',
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
      <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[9px] text-slate-500">
        <span>T-{last}h</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: shownBand.color }}
          />
          <span className="tabular-nums text-slate-300">
            {pad2(shownFrame.localHour)}:00 IST
          </span>
          <span className="text-slate-600">·</span>
          <span className="tabular-nums text-slate-300">mesh mean {shownAqi}</span>
          <span className="text-slate-600">·</span>
          <span style={{ color: shownBand.color }}>{shownBand.label}</span>
          {hover !== null && <span className="text-slate-600">(hover)</span>}
        </span>
        <span className="font-bold text-term-primary">NOW</span>
      </div>
    </div>
  );
}
