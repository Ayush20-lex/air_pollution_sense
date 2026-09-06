
import * as React from 'react';
import dynamic from '@/lib/dynamic';
import { Cloudy, Flame, Layers, MapPin, Wind } from 'lucide-react';
import { TimelineBar } from '@/components/dashboard/TimelineBar';
import { AQI_BANDS } from '@/lib/aqi';
import { MODEL_META } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useAppStore, useCurrentFrame, type MapLayer } from '@/store/useAppStore';

const NCRMap = dynamic(() => import('./NCRMap').then((m) => m.NCRMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-elevated/40">
      <span className="font-mono text-2xs uppercase tracking-[0.2em] text-faint">
        Loading spatial grid…
      </span>
    </div>
  ),
});

const LAYER_META: { id: MapLayer; label: string; icon: React.ReactNode }[] = [
  { id: 'heatmap', label: 'Concentration', icon: <Cloudy className="size-3.5" /> },
  { id: 'plume', label: 'Plume', icon: <Flame className="size-3.5" /> },
  { id: 'wind', label: 'Wind vectors', icon: <Wind className="size-3.5" /> },
  { id: 'pins', label: 'Stations', icon: <MapPin className="size-3.5" /> },
];

export function MapPanel() {
  const frame = useCurrentFrame();
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const pollutant = useAppStore((s) => s.pollutant);

  return (
    <div className="glass relative flex h-full min-h-0 flex-col overflow-hidden p-0">
      {/* --- map surface ------------------------------------------------ */}
      <div className="relative min-h-0 flex-1">
        <NCRMap frame={frame} />

        {/* layer switcher */}
        <div className="absolute left-3 top-3 z-[500] flex flex-col gap-1 rounded-lg border border-hairline/70 bg-surface/80 p-1 backdrop-blur-xl">
          <span className="px-1.5 pb-0.5 pt-1 font-mono text-2xs uppercase tracking-[0.18em] text-faint">
            <Layers className="mr-1 inline size-3" />
            Layers
          </span>
          {LAYER_META.map((l) => (
            <button
              key={l.id}
              onClick={() => toggleLayer(l.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1 font-mono text-2xs uppercase tracking-wider transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                layers[l.id]
                  ? 'bg-accent/15 text-accent'
                  : 'text-faint hover:bg-elevated hover:text-muted',
              )}
            >
              {l.icon}
              <span className="hidden sm:inline">{l.label}</span>
              <span
                className={cn(
                  'ml-auto size-1.5 rounded-full transition-colors',
                  layers[l.id] ? 'bg-accent' : 'bg-hairline',
                )}
              />
            </button>
          ))}
        </div>

        {/* domain readout */}
        <div className="pointer-events-none absolute right-3 top-3 z-[500] space-y-1 text-right">
          <div className="inline-flex items-center gap-2 rounded-md border border-hairline/70 bg-surface/80 px-2.5 py-1.5 backdrop-blur-xl">
            <span className="font-mono text-2xs uppercase tracking-[0.18em] text-faint">Field</span>
            <span className="font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
              {pollutant}
            </span>
          </div>
          <div className="rounded-md border border-hairline/70 bg-surface/80 px-2.5 py-1.5 text-left font-mono text-2xs leading-relaxed text-faint backdrop-blur-xl">
            <div>{MODEL_META.resolution}</div>
            <div>28.28–28.92°N · 76.82–77.62°E</div>
          </div>
        </div>

        {/* AQI legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-hairline/70 bg-surface/80 p-2 backdrop-blur-xl">
          <div className="mb-1 font-mono text-2xs tracking-[0.18em] text-faint">
            PM2.5 µg/m³
          </div>
          <div className="flex items-end gap-0">
            {AQI_BANDS.map((b, i) => (
              <div key={b.label} className="flex w-9 flex-col items-center gap-1">
                <span className="h-2 w-full" style={{ background: b.color }} />
                <span className="font-mono text-[8px] tabular-nums text-faint">
                  {i === AQI_BANDS.length - 1 ? `${b.from}+` : b.to}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* frame stamp */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-[500] rounded-md border border-hairline/70 bg-surface/80 px-2.5 py-1.5 backdrop-blur-xl">
          <span className="font-mono text-2xs uppercase tracking-[0.18em] text-faint">Valid </span>
          <span className="font-mono text-2xs font-semibold tabular-nums text-accent">
            {frame.label} · {String(frame.localHour).padStart(2, '0')}:00 IST
          </span>
        </div>
      </div>

      {/* --- playback transport ------------------------------------------ */}
      <TimelineBar />
    </div>
  );
}
