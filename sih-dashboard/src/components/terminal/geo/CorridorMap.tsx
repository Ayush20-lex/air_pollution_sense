/**
 * The upwind corridor, with every fire NASA reports on it.
 *
 * Deliberately a second map rather than a mode on the first one. Everything in
 * `NcrPlumeMap` is built on the NCR rectangle - the heat field is an image
 * overlay pinned to it, the contours are computed over it, the pin density
 * collapses to dots the moment you zoom out past its fitted view. Zoomed out
 * to hold Punjab, that map would show a bright patch in one corner and clean
 * white space over the fires, which is not an ugly drawing of the truth but a
 * false claim: nothing here measures the air over Punjab, and an empty field
 * there would say it is clean.
 *
 * So this map draws only what is measured over that ground - fire pixels, the
 * clusters they form, and the geometry of the transport - and says what it
 * cannot draw.
 */
import * as React from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Rectangle,
  TileLayer,
  Tooltip as LTooltip,
  useMap,
} from 'react-leaflet';
import { NCR_BOUNDS, NCR_CENTER } from '@/lib/terminal/stations';
import { deviceTier } from '@/lib/device-tier';
import { useTermPalette, TERM } from '@/lib/terminal/palette';
import type { FireCluster, FireCorridor } from '@/lib/terminal/firesApi';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; OpenStreetMap contributors &middot; NASA FIRMS VIIRS';

/** The box FIRMS is queried over, which is also the story's extent. */
const CORRIDOR_BOUNDS = L.latLngBounds([27.0, 74.0], [32.5, 78.5]);

const CHEAP = deviceTier() === 'low';

/**
 * Cross-wind spread of the plume at the receptor, in kilometres.
 *
 * Not a drawing decision: 45 km is `SIGMA_CROSS_KM` in backend/firms_fire.py,
 * the standard deviation of the Gaussian the forecast actually convolves each
 * fire with. The envelope below is that kernel's own geometry, which is why it
 * is drawn as an outline and never as a shaded concentration - there is no
 * receptor grid over the corridor to shade.
 */
const SIGMA_CROSS_KM = 45;
const KM_LAT = 111.0;
const KM_LON = 97.5;

/** Fire colour by radiative power. Hotter is whiter, the way a flame reads. */
function frpColor(frp: number): string {
  if (frp >= 40) return '#FFF3B0';
  if (frp >= 20) return '#FFC24A';
  if (frp >= 8) return '#FF8A3D';
  return '#F2552C';
}

function CorridorFitter({ resetKey }: { resetKey: string }) {
  const map = useMap();
  React.useEffect(() => {
    map.fitBounds(CORRIDOR_BOUNDS, { padding: [10, 10] });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, resetKey]);
  return null;
}

/**
 * Every returned detection, drawn into one shared canvas.
 *
 * Canvas and not markers, without a device check: 1,200 divIcons is 1,200 DOM
 * nodes that Leaflet repositions on each zoom, and that is a freeze on a
 * mid-range phone rather than a slow frame. Non-interactive, because the
 * tooltip belongs on the cluster - a single VIIRS pixel is 375 m of ground and
 * has nothing to say on its own.
 */
function FirePixels({ data }: { data: FireCorridor }) {
  const renderer = React.useMemo(() => L.canvas({ padding: 0.2 }), []);
  return (
    <>
      {data.pixels.rows.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lon]}
          renderer={renderer}
          radius={Math.max(1.6, Math.min(5, Math.sqrt(p.frp) * 0.8))}
          interactive={false}
          pathOptions={{
            color: frpColor(p.frp),
            weight: 0,
            fillColor: frpColor(p.frp),
            fillOpacity: 0.55,
          }}
        />
      ))}
    </>
  );
}

/** The quadrilateral the forecast's own kernel sweeps from a cluster to Delhi. */
function envelope(c: FireCluster): [number, number][] {
  const dLat = NCR_CENTER[0] - c.lat;
  const dLon = NCR_CENTER[1] - c.lon;
  const yKm = dLat * KM_LAT;
  const xKm = dLon * KM_LON;
  const len = Math.hypot(xKm, yKm) || 1;
  // Unit normal to the transport axis, in kilometres, converted back per axis.
  const nLat = (-xKm / len) / KM_LAT;
  const nLon = (yKm / len) / KM_LON;
  // Narrow at the source - a cluster is ~25 km across - opening to the
  // kernel's sigma by the time it reaches the receptor.
  const near = 12;
  const far = SIGMA_CROSS_KM;
  return [
    [c.lat + nLat * near, c.lon + nLon * near],
    [NCR_CENTER[0] + nLat * far, NCR_CENTER[1] + nLon * far],
    [NCR_CENTER[0] - nLat * far, NCR_CENTER[1] - nLon * far],
    [c.lat - nLat * near, c.lon - nLon * near],
  ];
}

function Transport({ clusters }: { clusters: FireCluster[] }) {
  const carrying = clusters
    .filter((c) => c.transit.carrying === true)
    .slice(0, CHEAP ? 2 : 4);
  if (!carrying.length) return null;
  return (
    <>
      {carrying.map((c) => (
        <React.Fragment key={`t-${c.id}`}>
          <Polygon
            positions={envelope(c)}
            interactive={false}
            pathOptions={{
              color: TERM.secondary,
              weight: 1,
              opacity: 0.35,
              fillColor: TERM.secondary,
              fillOpacity: 0.07,
              dashArray: '4 6',
            }}
          />
          <Polyline
            positions={[[c.lat, c.lon], [NCR_CENTER[0], NCR_CENTER[1]]]}
            interactive={false}
            pathOptions={{ color: TERM.secondary, weight: 1.4, opacity: 0.75 }}
          />
        </React.Fragment>
      ))}
    </>
  );
}

function ClusterMarkers({ clusters }: { clusters: FireCluster[] }) {
  const renderer = React.useMemo(() => L.canvas({ padding: 0.2, tolerance: 8 }), []);
  const max = clusters.reduce((m, c) => Math.max(m, c.frpTotalMw), 1);
  return (
    <>
      {clusters.map((c) => (
        <CircleMarker
          key={c.id}
          center={[c.lat, c.lon]}
          renderer={renderer}
          radius={6 + Math.sqrt(c.frpTotalMw / max) * 10}
          pathOptions={{
            color: frpColor(c.frpMaxMw),
            weight: 1.5,
            opacity: 0.9,
            fillColor: frpColor(c.frpMaxMw),
            fillOpacity: 0.18,
          }}
        >
          <LTooltip direction="top" offset={[0, -6]} opacity={1} className="as-tip">
            <div style={{ minWidth: 190 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#fff' }}>
                {c.stateApprox} <span style={{ opacity: 0.6 }}>approx.</span>
              </div>
              <div>
                {c.pixels} detection{c.pixels === 1 ? '' : 's'} · {c.frpTotalMw} MW
              </div>
              <div>
                {Math.round(c.distKm)} km {c.fromDelhiCompass} of Delhi
              </div>
              {c.ageH != null && <div>newest {c.ageH < 1 ? '<1' : Math.round(c.ageH)} h ago</div>}
              <div style={{ opacity: 0.75, marginTop: 4 }}>
                {c.transit.carrying === true
                  ? `flow carries this in ~${Math.round(c.transit.hours ?? 0)} h`
                  : c.transit.reason ?? 'transport unknown'}
              </div>
            </div>
          </LTooltip>
        </CircleMarker>
      ))}
    </>
  );
}

/** Where the other map is looking, so the two read as one story. */
function DelhiMarker() {
  return (
    <>
      <Rectangle
        bounds={[
          [NCR_BOUNDS.south, NCR_BOUNDS.west],
          [NCR_BOUNDS.north, NCR_BOUNDS.east],
        ]}
        interactive={false}
        pathOptions={{ color: TERM.primary, weight: 1, opacity: 0.8, fillOpacity: 0.06 }}
      />
      <CircleMarker
        center={NCR_CENTER}
        radius={5}
        pathOptions={{
          color: TERM.primary,
          weight: 2,
          fillColor: TERM.primary,
          fillOpacity: 0.9,
        }}
      >
        <LTooltip direction="right" offset={[6, 0]} opacity={1} className="as-tip">
          Delhi NCR — the domain the rest of this page measures
        </LTooltip>
      </CircleMarker>
    </>
  );
}

export function CorridorMap({ data }: { data: FireCorridor }) {
  useTermPalette();
  return (
    <MapContainer
      bounds={CORRIDOR_BOUNDS}
      minZoom={5}
      maxZoom={10}
      maxBounds={CORRIDOR_BOUNDS.pad(0.35)}
      maxBoundsViscosity={0.7}
      zoomControl={false}
      attributionControl
      className="size-full"
      style={{ background: 'transparent' }}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIB} maxZoom={19} updateWhenZooming={false} />
      <CorridorFitter resetKey={data.window.start || 'live'} />
      <Transport clusters={data.clusters} />
      <FirePixels data={data} />
      <ClusterMarkers clusters={data.clusters} />
      <DelhiMarker />
    </MapContainer>
  );
}

export default CorridorMap;
