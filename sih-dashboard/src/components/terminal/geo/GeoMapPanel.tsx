import * as React from 'react';
import dynamic from '@/lib/dynamic';
import {
  Cloudy,
  Layers,
  MapPin,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Spline,
  Waves,
  Wind,
} from 'lucide-react';
import { Label, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { TERMINAL_FIELDS, dispersionGradientCss, type TerminalField } from '@/lib/terminal/bands';
import { FRAME_COUNT, type TerminalFrame } from '@/lib/terminal/field';
import { cn } from '@/lib/utils';
import { useTerminalStore, type PlaybackRate, type TerminalLayer } from '@/store/useTerminalStore';

const NcrPlumeMap = dynamic(() => import('./NcrPlumeMap').then((m) => m.NcrPlumeMap), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center bg-term-surface-c/40">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
        Loading spatial grid…
      </span>
    </div>
  ),
});

const LAYER_META: { id: TerminalLayer; label: string; icon: React.ReactNode }[] = [
  { id: 'heatmap', label: 'Concentration', icon: <Cloudy className="size-3.5" /> },
  { id: 'contours', label: 'Contours', icon: <Waves className="size-3.5" /> },
  { id: 'tracks', label: 'Plume tracks', icon: <Spline className="size-3.5" /> },
  { id: 'wind', label: 'Wind flow', icon: <Wind className="size-3.5" /> },
  { id: 'pins', label: 'Stations', icon: <MapPin className="size-3.5" /> },
];

const RATES: PlaybackRate[] = [1, 4, 12];

/** Map surface, its floating chrome, and the playback transport beneath it. */
export function GeoMapPanel({ frame }: { frame: TerminalFrame }) {
  const layers = useTerminalStore((s) => s.layers);
  const toggleLayer = useTerminalStore((s) => s.toggleLayer);
  const field = useTerminalStore((s) => s.field);
  const setField = useTerminalStore((s) => s.setField);

  return (
    <TelemetryCard focus className="relative flex h-full flex-col overflow-hidden p-4 lg:col-span-8">
      <div className="pointer-events-none absolute -right-16 -top-16 size-96 rounded-full bg-orange-500/10 blur-3xl" />

      {/* `flex-1` rather than a fixed aspect ratio: the map grows into whatever
          height the rail sets, with a floor so it never collapses when the rail is
          short. */}
      <div className="term-map relative min-h-[320px] w-full flex-1 overflow-hidden rounded-xl border border-term-outline-variant/50">
        <NcrPlumeMap frame={frame} />

        {/* layer switcher */}
        <div className="absolute left-3 top-3 z-[500] flex flex-col gap-1 rounded-lg border border-term-outline-variant/70 bg-term-surface-lowest/80 p-1 backdrop-blur-xl">
          <span className="flex items-center gap-1 px-1.5 pb-0.5 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            <Layers className="size-3" />
            Layers
          </span>
          {LAYER_META.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => toggleLayer(l.id)}
              aria-pressed={layers[l.id]}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60',
                layers[l.id]
                  ? 'bg-term-primary/15 text-term-primary'
                  : 'text-slate-500 hover:bg-term-surface-c hover:text-slate-300',
              )}
            >
              {l.icon}
              <span className="hidden sm:inline">{l.label}</span>
              <span
                className={cn(
                  'ml-auto size-1.5 rounded-full transition-colors',
                  layers[l.id] ? 'bg-term-primary' : 'bg-term-outline-variant',
                )}
              />
            </button>
          ))}
        </div>

        {/* live pill */}
        <div className="absolute left-1/2 top-3 z-[500] hidden -translate-x-1/2 items-center gap-2 rounded-full border border-term-primary/40 bg-term-primary/10 px-3 py-1 backdrop-blur-sm sm:flex">
          <span className="pulse-live size-2 rounded-full bg-term-primary" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-term-primary">
            Live interpolation
          </span>
        </div>

        {/* domain readout */}
        <div className="pointer-events-none absolute right-3 top-3 z-[500] space-y-1 text-right">
          <div className="inline-flex items-center gap-2 rounded-md border border-term-outline-variant/70 bg-term-surface-lowest/80 px-2.5 py-1.5 backdrop-blur-xl">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Field</span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-term-primary">
              {field}
            </span>
          </div>
          <div className="rounded-md border border-term-outline-variant/70 bg-term-surface-lowest/80 px-2.5 py-1.5 text-left font-mono text-[10px] leading-relaxed text-slate-500 backdrop-blur-xl">
            <div>IDW interpolation · 250 m</div>
            <div>28.28–28.92°N · 76.82–77.62°E</div>
          </div>
        </div>

        {/* PM2.5 legend */}
        <div className="pointer-events-none absolute bottom-7 left-3 z-[500] rounded-lg border border-term-outline-variant/70 bg-term-surface-lowest/80 p-2 backdrop-blur-xl">
          <div className="mb-1 font-mono text-[10px] tracking-[0.18em] text-slate-500">
            {field === 'PBL' ? 'MIXING DEPTH' : field === 'WIND' ? 'VENTILATION' : `${field} DISPERSION`}
          </div>
          {/* One continuous bar, straight off the ramp the canvas samples. */}
          <div
            className="h-2.5 w-[216px] rounded-sm"
            style={{ background: dispersionGradientCss() }}
          />
          <div className="mt-1 flex w-[216px] justify-between font-mono text-[8px] uppercase tracking-wider text-slate-500">
            <span>Clean</span>
            <span>Moderate</span>
            <span>High</span>
            <span>Severe</span>
          </div>
        </div>

        {/* frame stamp */}
        <div className="pointer-events-none absolute bottom-7 right-3 z-[500] rounded-md border border-term-outline-variant/70 bg-term-surface-lowest/80 px-2.5 py-1.5 backdrop-blur-xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Valid </span>
          <span className="font-mono text-[10px] font-semibold tabular-nums text-term-primary">
            {frame.label} · {String(frame.localHour).padStart(2, '0')}:00 IST
          </span>
        </div>
      </div>

      {/* field selector */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Field</span>
        {TERMINAL_FIELDS.map((f) => (
          <FieldChip key={f} value={f} active={field === f} onSelect={setField} />
        ))}
      </div>

      <TimelineTransport frame={frame} />
    </TelemetryCard>
  );
}

function FieldChip({
  value,
  active,
  onSelect,
}: {
  value: TerminalField;
  active: boolean;
  onSelect: (f: TerminalField) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
        active
          ? 'border-orange-500/50 bg-orange-500/20 text-orange-300'
          : 'border-term-outline-variant/60 bg-term-surface-c/80 text-slate-400 hover:text-white',
      )}
    >
      {value}
    </button>
  );
}

/** Scrubbable 24-hour playback transport. */
function TimelineTransport({ frame }: { frame: TerminalFrame }) {
  const frameIndex = useTerminalStore((s) => s.frameIndex);
  const setFrameIndex = useTerminalStore((s) => s.setFrameIndex);
  const stepFrame = useTerminalStore((s) => s.stepFrame);
  const playing = useTerminalStore((s) => s.playing);
  const togglePlay = useTerminalStore((s) => s.togglePlay);
  const setPlaying = useTerminalStore((s) => s.setPlaying);
  const rate = useTerminalStore((s) => s.rate);
  const setRate = useTerminalStore((s) => s.setRate);

  // Playback stops at the present rather than looping — the last frame is now.
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { frameIndex: i, setFrameIndex: set, setPlaying: stop } = useTerminalStore.getState();
      if (i >= FRAME_COUNT - 1) {
        stop(false);
        return;
      }
      set(i + 1);
    }, 900 / rate);
    return () => clearInterval(id);
  }, [playing, rate]);

  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-term-outline-variant/60 bg-term-surface-low px-3 py-2">
      <button
        type="button"
        onClick={() => {
          if (!playing && frameIndex >= FRAME_COUNT - 1) setFrameIndex(0);
          togglePlay();
        }}
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-term-primary/40 bg-term-primary/15 text-term-primary transition-colors hover:bg-term-primary/25"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <button
        type="button"
        onClick={() => stepFrame(-1)}
        aria-label="Previous frame"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-term-outline-variant/60 bg-term-surface-high text-slate-300 transition-colors hover:text-white"
      >
        <SkipBack className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => stepFrame(1)}
        aria-label="Next frame"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-term-outline-variant/60 bg-term-surface-high text-slate-300 transition-colors hover:text-white"
      >
        <SkipForward className="size-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={FRAME_COUNT - 1}
          step={1}
          value={frameIndex}
          onChange={(e) => setFrameIndex(Number(e.target.value))}
          aria-label="Forecast frame"
          className="tele-range w-full"
        />
        <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-500">
          <span>T-23h</span>
          <span className="hidden sm:inline">T-18h</span>
          <span className="hidden sm:inline">T-12h</span>
          <span className="hidden sm:inline">T-6h</span>
          <span className="font-bold text-term-primary">NOW</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-[11px] font-bold tabular-nums text-white">
          {frame.offset === 0 ? 'NOW' : `T${frame.offset}h`}
        </div>
        <Label>
          frame {frameIndex + 1} / {FRAME_COUNT}
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
  );
}
