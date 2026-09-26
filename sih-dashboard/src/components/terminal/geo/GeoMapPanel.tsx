import * as React from 'react';
import dynamic from '@/lib/dynamic';
import { Cloudy, Landmark, Layers, MapPin, Spline, Waves, Wind } from 'lucide-react';
import { TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { TERMINAL_FIELDS, dispersionGradientCss, type TerminalField } from '@/lib/terminal/bands';
import type { TerminalFrame } from '@/lib/terminal/field';
import { fetchModelGrid } from '@/lib/terminal/gridApi';
import { TimelineTrack } from './TimelineTrack';
import { cn } from '@/lib/utils';
import { useTerminalStore, type TerminalLayer } from '@/store/useTerminalStore';

const NcrPlumeMap = dynamic(() => import('./NcrPlumeMap').then((m) => m.NcrPlumeMap), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center bg-term-surface-c/40">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-term-outline">
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
  { id: 'landmarks', label: 'Landmarks', icon: <Landmark className="size-3.5" /> },
];


/** Map surface, its floating chrome, and the playback transport beneath it. */
export function GeoMapPanel({
  frame,
  frames,
}: {
  frame: TerminalFrame;
  frames: TerminalFrame[];
}) {
  const layers = useTerminalStore((s) => s.layers);
  const toggleLayer = useTerminalStore((s) => s.toggleLayer);
  const field = useTerminalStore((s) => s.field);
  // Only to caption the model field with the run it came from; the overlay
  // fetches and draws it independently and gridApi caches the request.
  const [modelRun, setModelRun] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (field !== 'MODEL') return;
    let alive = true;
    void fetchModelGrid(frame.offset).then((g) => {
      if (alive) setModelRun(g?.issuedAt ?? null);
    });
    return () => {
      alive = false;
    };
  }, [field, frame.offset]);
  const setField = useTerminalStore((s) => s.setField);

  return (
    <TelemetryCard focus className="relative flex h-full flex-col overflow-hidden p-4 lg:col-span-8">
      <div className="pointer-events-none absolute -right-16 -top-16 size-96 rounded-full bg-orange-500/10 blur-3xl" />

      {/* `flex-1` so a tall rail still stretches the map rather than leaving dead
          space beside it - but the floor, not the rail, is what sets the size.

          It used to be 320px, which made the map's height depend on whether a
          station happened to be selected: the rail carries a Selected Node card,
          nothing is selected on a fresh load, so the rail came up short and the
          map collapsed onto the floor. Pick a station and it grew; refresh and it
          shrank again. The map is the point of this page and it was being sized
          by an incidental sibling.

          `clamp` keeps it a stable fraction of the viewport instead - large
          enough that the NCR mesh is readable, capped so it does not run off a
          tall monitor, with a floor for short ones. */}
      <div className="term-map relative min-h-[clamp(360px,74vh,880px)] w-full flex-1 overflow-hidden rounded-xl border border-term-outline-variant/50">
        <NcrPlumeMap frame={frame} />

        {/* layer switcher */}
        <div className="absolute left-3 top-3 z-[500] flex flex-col gap-1 rounded-lg border border-term-outline-variant/70 bg-term-surface-lowest/80 p-1 backdrop-blur-xl">
          <span className="flex items-center gap-1 px-1.5 pb-0.5 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-term-outline">
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
                  : 'text-term-outline hover:bg-term-surface-c hover:text-term-ink-variant',
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-term-outline">Field</span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-term-primary">
              {field}
            </span>
          </div>
          <div className="rounded-md border border-term-outline-variant/70 bg-term-surface-lowest/80 px-2.5 py-1.5 text-left font-mono text-[10px] leading-relaxed text-term-outline backdrop-blur-xl">
            {/* The grid is 70x80 over a 78 km domain, so a cell is about a
                kilometre. "250 m" was neither the grid nor the canvas (which
                draws at roughly 100 m a pixel and adds no information). */}
            {/* The model field is not an interpolation of anything and does
                not describe now, so it says neither. Its run origin matters:
                on an archive-replay deployment the run can be days behind the
                clock, which is why its values will not match the live pins. */}
            {field === 'MODEL' ? (
              <>
                <div>Forecast tensor · 70×80 · ~1.1 km cells</div>
                <div>
                  {modelRun
                    ? `run issued ${new Date(modelRun).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} IST`
                    : 'loading the run…'}
                </div>
              </>
            ) : (
              <div>IDW interpolation · ~1 km grid</div>
            )}
            <div>28.28–28.92°N · 76.82–77.62°E</div>
          </div>
        </div>

        {/* PM2.5 legend */}
        <div className="pointer-events-none absolute bottom-7 left-3 z-[500] rounded-lg border border-term-outline-variant/70 bg-term-surface-lowest/80 p-2 backdrop-blur-xl">
          <div className="mb-1 font-mono text-[10px] tracking-[0.18em] text-term-outline">
            {field === 'PBL' ? 'MIXING DEPTH' : field === 'WIND' ? 'VENTILATION' : `${field} DISPERSION`}
          </div>
          {/* One continuous bar, straight off the ramp the canvas samples. */}
          <div
            className="h-2.5 w-[216px] rounded-sm"
            style={{ background: dispersionGradientCss() }}
          />
          <div className="mt-1 flex w-[216px] justify-between font-mono text-[8px] uppercase tracking-wider text-term-outline">
            <span>Clean</span>
            <span>Moderate</span>
            <span>High</span>
            <span>Severe</span>
          </div>
        </div>

        {/* frame stamp */}
        <div className="pointer-events-none absolute bottom-7 right-3 z-[500] rounded-md border border-term-outline-variant/70 bg-term-surface-lowest/80 px-2.5 py-1.5 backdrop-blur-xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-term-outline">Valid </span>
          <span className="font-mono text-[10px] font-semibold tabular-nums text-term-primary">
            {frame.label} · {String(frame.localHour).padStart(2, '0')}:00 IST
          </span>
        </div>
      </div>

      {/* field selector */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-term-outline">Field</span>
        {TERMINAL_FIELDS.map((f) => (
          <FieldChip key={f} value={f} active={field === f} onSelect={setField} />
        ))}
      </div>

      <TimelineTrack frames={frames} />
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
          ? 'border-orange-500/50 bg-orange-500/20 text-orange-700 dark:text-orange-300'
          : 'border-term-outline-variant/60 bg-term-surface-c/80 text-term-ink-variant hover:text-term-ink',
      )}
    >
      {value}
    </button>
  );
}

