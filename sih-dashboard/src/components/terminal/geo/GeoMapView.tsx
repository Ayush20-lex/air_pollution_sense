import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crosshair, Radio } from 'lucide-react';
import { GeoMapPanel } from './GeoMapPanel';
import { GeoRail } from './GeoRail';
import { GeoSections } from './GeoSections';
import { buildFrames, type TerminalFrame } from '@/lib/terminal/field';
import { STATIONS, stationById } from '@/lib/terminal/stations';
import { useTerminalStore } from '@/store/useTerminalStore';

export function GeoMapView() {
  // Frames are built once on mount. Building them during render would give the
  // server and the client different wall clocks and break hydration.
  const [frames, setFrames] = React.useState<TerminalFrame[] | null>(null);
  React.useEffect(() => setFrames(buildFrames()), []);

  const frameIndex = useTerminalStore((s) => s.frameIndex);
  const select = useTerminalStore((s) => s.select);

  // `?station=` deep link, used by the overview's "Locate on map" buttons.
  const [params] = useSearchParams();
  const requested = params.get('station');
  React.useEffect(() => {
    if (requested && stationById(requested)) select(requested);
  }, [requested, select]);

  return (
    <>
      <div className="flex flex-col justify-between gap-4 border-b border-term-outline-variant/40 pb-1 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white lg:text-3xl">
              Geospatial Plume Map
            </h1>
            <span className="rounded border border-orange-500/40 bg-orange-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-orange-400">
              DELHI NCR MESH • {STATIONS.length} NODES ONLINE
            </span>
          </div>
          <p className="mt-1 font-body text-sm text-slate-400">
            Regional plume tracking, topographic trapping analysis &amp; pollution source attribution
            across the National Capital Region
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-lg border border-term-outline-variant/60 bg-term-surface-c px-3 py-1.5 font-mono text-xs text-slate-300">
            <Radio className="size-4 text-term-primary" />
            Interpolation: <strong className="text-white">IDW 250m</strong>
          </span>
          <span className="flex items-center gap-2 rounded-lg border border-term-outline-variant/60 bg-term-surface-c px-3 py-1.5 font-mono text-xs text-slate-300">
            <Crosshair className="size-4 text-term-secondary" />
            WGS-84 / <strong className="text-white">EPSG:4326</strong>
          </span>
        </div>
      </div>

      {frames ? (
        <MapBody frame={frames[Math.min(frameIndex, frames.length - 1)]} />
      ) : (
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="size-10 animate-spin rounded-full border-2 border-term-outline-variant border-t-term-primary" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-term-primary">
              Interpolating sensor mesh
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function MapBody({ frame }: { frame: TerminalFrame }) {
  return (
    <>
      {/* Columns stretch, and the map frame inside the left card is flex-1, so
          the height the taller rail forces becomes more map rather than dead
          space under a short card. */}
      <div id="map" className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <GeoMapPanel frame={frame} />
        <GeoRail frame={frame} />
      </div>
      <GeoSections frame={frame} />
    </>
  );
}
