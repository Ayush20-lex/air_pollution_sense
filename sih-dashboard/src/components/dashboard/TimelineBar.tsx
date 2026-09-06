
import * as React from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { aqiColor } from '@/lib/aqi';
import { FORECAST_HOURS } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useAppStore, type PlaybackSpeed } from '@/store/useAppStore';

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2];

/** Scrubbable +0h → +72h playback transport for the spatial view. */
export function TimelineBar() {
  const hour = useAppStore((s) => s.hour);
  const setHour = useAppStore((s) => s.setHour);
  const stepHour = useAppStore((s) => s.stepHour);
  const playing = useAppStore((s) => s.playing);
  const togglePlay = useAppStore((s) => s.togglePlay);
  const speed = useAppStore((s) => s.speed);
  const setSpeed = useAppStore((s) => s.setSpeed);
  const frames = useAppStore((s) => s.frames);

  // Playback loop — 900ms per forecast hour at 1x.
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => stepHour(1), 900 / speed);
    return () => clearInterval(id);
  }, [playing, speed, stepHour]);

  // Keyboard transport.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === 'ArrowRight') stepHour(1);
      if (e.key === 'ArrowLeft') stepHour(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, stepHour]);

  const frame = frames[hour];

  return (
    <div className="flex flex-col gap-2 border-t border-hairline/70 bg-surface/70 px-3 py-2 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        {/* transport */}
        <div className="flex items-center gap-1">
          <Hint label="Step back 1h">
            <Button size="icon-sm" variant="ghost" onClick={() => stepHour(-1)} aria-label="Step back">
              <SkipBack />
            </Button>
          </Hint>
          <Hint label={playing ? 'Pause' : 'Play forecast'}>
            <Button
              size="icon"
              variant={playing ? 'danger' : 'default'}
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
          </Hint>
          <Hint label="Step forward 1h">
            <Button size="icon-sm" variant="ghost" onClick={() => stepHour(1)} aria-label="Step forward">
              <SkipForward />
            </Button>
          </Hint>
        </div>

        {/* current step readout */}
        <div className="hidden w-24 shrink-0 sm:block">
          <div className="hud-label">Valid</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-accent">
            {frame.label}
            <span className="ml-1 text-2xs text-faint">
              {String(frame.localHour).padStart(2, '0')}:00
            </span>
          </div>
        </div>

        {/* scrubber */}
        <div className="relative flex-1">
          <Slider
            value={[hour]}
            min={0}
            max={FORECAST_HOURS}
            step={1}
            onValueChange={([v]) => setHour(v)}
            accentColor={aqiColor(frame.avgPm25)}
            aria-label="Forecast hour"
          />
          {/* concentration strip under the track */}
          <div className="pointer-events-none absolute inset-x-0 -bottom-0.5 flex h-1 gap-px overflow-hidden rounded-full opacity-80">
            {frames.map((f) => (
              <span
                key={f.hour}
                className="flex-1"
                style={{
                  background: aqiColor(f.avgPm25),
                  opacity: f.hour <= hour ? 1 : 0.28,
                }}
              />
            ))}
          </div>
        </div>

        {/* speed */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline bg-elevated/60 p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={cn(
                'rounded px-1.5 py-1 font-mono text-2xs font-semibold tabular-nums transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                speed === s ? 'bg-accent/20 text-accent' : 'text-faint hover:text-ink',
              )}
            >
              {s.toFixed(1)}x
            </button>
          ))}
        </div>
      </div>

      {/* hour ruler */}
      <div className="hidden justify-between px-1 font-mono text-2xs text-faint sm:flex">
        {[0, 12, 24, 36, 48, 60, 72].map((h) => (
          <button
            key={h}
            onClick={() => setHour(h)}
            className={cn(
              'rounded transition-colors hover:text-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              hour === h && 'font-semibold text-accent',
            )}
          >
            {h === 0 ? 'NOW' : `+${h}h`}
          </button>
        ))}
      </div>
    </div>
  );
}
