import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crosshair, Radio } from 'lucide-react';
import { GeoMapPanel } from './GeoMapPanel';
import { GeoRail } from './GeoRail';
import { GeoSections } from './GeoSections';
import { buildFrames, type TerminalFrame } from '@/lib/terminal/field';
import { findById } from '@/lib/terminal/stations';
import { useMesh } from '@/lib/terminal/useMesh';
import { useTerminalStore } from '@/store/useTerminalStore';

export function GeoMapView() {
  // Built in an effect rather than during render: buildFrames reads the wall
  // clock, and a render-time read makes the value differ between the first
  // paint and any replay of that render.
  //
  // Rebuilt when the shell's refresh control bumps refreshedAt, which
  // re-anchors the 24-hour window on the current time — so the readings
  // actually move rather than the button merely spinning.
  const refreshedAt = useTerminalStore((s) => s.refreshedAt);

  // The measured mesh, or the curated one while the backend is unreachable.
  const mesh = useMesh();
  const stations = mesh.stations;

  // Hour 0 is the hour the readings were taken, not the hour the page was
  // opened. Anchoring the window to the wall clock put "VALID 18 Sept 17:00"
  // under measurements from 29 December, and drove the diurnal shape off a
  // local hour the data never saw. Offline there is nothing measured to
  // anchor to, so the clock stands in as it always did.
  const origin = React.useMemo(
    () => (mesh.asOf ? new Date(mesh.asOf) : new Date()),
    [mesh.asOf],
  );

  // Seeded from a lazy initialiser rather than null-then-effect: the first
  // window is available on the first render, so the map never paints an empty
  // frame and there is no state write during mount. The effect then covers
  // only the refresh, and skips the run that fires alongside mount.
  const [frames, setFrames] = React.useState<TerminalFrame[]>(() => buildFrames(origin, stations));
  const builtAt = React.useRef(refreshedAt);
  // Rebuilt on refresh, and again when the measurements land: the frames are
  // keyed by station id and carry each node's reading, so a mesh that changed
  // under them would leave the map drawing the hand-written values while the
  // table beside it showed the measured ones.
  React.useEffect(() => {
    if (builtAt.current === refreshedAt && !mesh.live) return;
    builtAt.current = refreshedAt;
    setFrames(buildFrames(origin, stations));
  }, [refreshedAt, stations, mesh.live, origin]);

  const frameIndex = useTerminalStore((s) => s.frameIndex);
  const select = useTerminalStore((s) => s.select);

  // `?station=` deep link, used by the overview's "Locate on map" buttons.
  const [params] = useSearchParams();
  const requested = params.get('station');
  React.useEffect(() => {
    if (requested && findById(stations, requested)) select(requested);
  }, [requested, select, stations]);

  return (
    <>
      <div className="flex flex-col justify-between gap-4 border-b border-term-outline-variant/40 pb-1 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white lg:text-3xl">
              Geospatial Plume Map
            </h1>
            <span className="rounded border border-orange-500/40 bg-orange-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-orange-400">
              DELHI NCR MESH • {stations.length} NODES{' '}
              {mesh.live ? 'REPORTING' : 'ONLINE'}
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

      {/* No loading branch: frames are seeded on the first render, so this can
          never be empty. The Leaflet chunk still streams in behind its own
          Suspense boundary in TerminalGeoMap. */}
      <MapBody frame={frames[Math.min(frameIndex, frames.length - 1)]} frames={frames} />
    </>
  );
}

function MapBody({ frame, frames }: { frame: TerminalFrame; frames: TerminalFrame[] }) {
  return (
    <>
      {/* Columns stretch, and the map frame inside the left card is flex-1, so
          the height the taller rail forces becomes more map rather than dead
          space under a short card. */}
      <div id="map" className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* The whole window, not just the current hour: the timeline strip
            under the map draws all 24 frames, and rebuilding them there would
            read the wall clock a second time and could disagree with the map. */}
        <GeoMapPanel frame={frame} frames={frames} />
        <GeoRail frame={frame} />
      </div>
      <GeoSections frame={frame} />
    </>
  );
}
