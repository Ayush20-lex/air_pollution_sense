import * as React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip as LTooltip, useMap } from 'react-leaflet';
import {
  DISPERSION_STOPS,
  TERMINAL_ALERT_COLOR,
  aqiColor,
  bandForAqi,
  bandForPm25,
  fieldIntensity,
  pm25Color,
  type TerminalField,
} from '@/lib/terminal/bands';
import {
  CONTOUR_LEVELS,
  gridToLatLng,
  pm25Grid,
  type TerminalFrame,
} from '@/lib/terminal/field';
import { isoContours, smoothPath } from '@/lib/terminal/contours';
import { buildWindContext, streamlines } from '@/lib/terminal/wind';
import {
  NCR_BOUNDS,
  NCR_CENTER,
  PLUME_SOURCES,
  type Station,
} from '@/lib/terminal/stations';
import { useMesh } from '@/lib/terminal/useMesh';
import { useTerminalStore } from '@/store/useTerminalStore';
import { TERM } from '@/lib/terminal/palette';

/**
 * Delhi NCR plume map.
 *
 * Keyless OSM raster tiles; the dark treatment is a CSS filter on the tile
 * pane (see `app/terminal/terminal.css`) rather than a second, API-keyed
 * provider. It is the only Leaflet map left in the app: the console's NCRMap
 * was the other one, and it went with the console.
 */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; OpenStreetMap contributors &middot; interpolated CPCB mesh';

export function NcrPlumeMap({ frame }: { frame: TerminalFrame }) {
  const layers = useTerminalStore((s) => s.layers);
  const field = useTerminalStore((s) => s.field);
  const selectedId = useTerminalStore((s) => s.selectedId);
  const select = useTerminalStore((s) => s.select);

  // No preferCanvas. It bought nothing here - the heat field builds its own
  // canvas overlay rather than being a Leaflet vector - while forcing the canvas
  // renderer on every Polyline that did not name one. Every vector layer below
  // already passes renderer: L.svg(), because the dashes have to animate and CSS
  // cannot animate a canvas draw. With preferCanvas set the SVG overlay pane came
  // up empty in a production build; dev only looked right because StrictMode
  // remounts each layer a second time.
  return (
    <MapContainer
      center={NCR_CENTER}
      zoom={10}
      minZoom={8}
      maxZoom={13}
      zoomControl={false}
      attributionControl
      className="size-full"
      style={{ background: 'transparent' }}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIB} maxZoom={19} />
      <Fitter />
      {layers.heatmap && <HeatOverlay frame={frame} field={field} />}
      {layers.contours && <IsoContours frame={frame} />}
      {layers.tracks && <SourceRibbons />}
      {layers.wind && <WindStreamlines frame={frame} />}
      {layers.pins && <StationPins frame={frame} selectedId={selectedId} select={select} />}
    </MapContainer>
  );
}

/**
 * The station mesh. Split out of the map body because usePinDensity calls
 * useMap, which only resolves inside a MapContainer child.
 */
function StationPins({
  frame,
  selectedId,
  select,
}: {
  frame: TerminalFrame;
  selectedId: string | null;
  select: (id: string) => void;
}) {
  const density = usePinDensity(selectedId);
  const { stations } = useMesh();

  return (
    <>
      {stations.map((s) => {
          // The frame can lag the mesh by one render; see field.ts's `sampled`.
          const n = frame.nodes[s.id];
          if (!n) return null;
          const d = density[s.id] ?? 'full';
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={buildPin(s, n.pm25, n.aqi, n.alert, selectedId === s.id, d)}
              eventHandlers={{ click: () => select(s.id) }}
            >
              <LTooltip direction="top" offset={[0, d === 'dot' ? -10 : d === 'compact' ? -36 : -50]} opacity={1} className="as-tip">
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: '#fff' }}>{s.name}</div>
                  <div>
                    AQI {n.aqi} · {bandForAqi(n.aqi).label}
                  </div>
                  <div>PM2.5 {n.pm25.toFixed(1)} µg/m³ · {bandForPm25(n.pm25).label}</div>
                  <div>
                    PBL {n.pbl} m · {n.windSpeed.toFixed(1)} m/s
                  </div>
                  <div>
                    O₃ {n.o3.toFixed(0)} · NOx {n.nox.toFixed(0)} ppb
                  </div>
                  <div style={{ opacity: 0.7 }}>
                    {s.zone} zone · {s.agency}
                  </div>
                </div>
              </LTooltip>
            </Marker>
          );
        })}
    </>
  );
}

/** Keeps the NCR domain framed when the container resizes. */
function Fitter() {
  const map = useMap();
  React.useEffect(() => {
    const bounds = L.latLngBounds(
      [NCR_BOUNDS.south, NCR_BOUNDS.west],
      [NCR_BOUNDS.north, NCR_BOUNDS.east],
    );
    map.fitBounds(bounds, { padding: [18, 18] });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

type PinDensity = 'full' | 'compact' | 'dot';

/**
 * Chooses a density per station so the mesh stays readable at every zoom.
 *
 * 26 stations sit inside one basin, so at the fitted zoom the full pins
 * overlapped into an unreadable stack of AQI cards.
 *
 * Rather than switch every pin at fixed zoom thresholds — which collapsed the
 * whole mesh to dots at z9, the zoom the map actually fits to — each station
 * degrades on its own: try the full card, fall back to the number alone, then
 * to a bare dot, taking the first that does not collide with a pin already
 * placed. The map self-adapts to any zoom and any container size, and zooming
 * in promotes pins back as space appears.
 *
 * The walk is worst-AQI-first, so when pins fight for the same pixels the more
 * severe reading keeps its label. A demoted station is never hidden: a dot
 * still carries its tooltip and click target.
 */
function usePinDensity(selectedId: string | null): Record<string, PinDensity> {
  const { stations } = useMesh();
  const map = useMap();
  // Zoom and pan both change which pins overlap, so both re-run the pass.
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    map.on('zoomend', bump);
    map.on('moveend', bump);
    return () => {
      map.off('zoomend', bump);
      map.off('moveend', bump);
    };
  }, [map, bump]);

  // Deliberately not memoised: the result depends on the map's current
  // projection, which useMemo cannot express as a dependency. 26 rectangle
  // tests per render is far cheaper than getting the cache key wrong.
  {
    const out: Record<string, PinDensity> = {};

    // Selected first so it always keeps the richest label it can — it is what
    // the rest of the page is pointing at. Then worst AQI first.
    const order = [...stations].sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return b.aqi - a.aqi;
    });

    type Rect = { x1: number; y1: number; x2: number; y2: number };
    const placed: Rect[] = [];
    const hits = (r: Rect) =>
      placed.some((q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1);

    const ladder: PinDensity[] = ['full', 'compact', 'dot'];

    for (const st of order) {
      const pt = map.latLngToContainerPoint([st.lat, st.lng]);

      for (const d of ladder) {
        const [w, h] = PIN_SIZE[d];
        // 3px of breathing room, or pins merely touch and still read as a clump.
        const pad = 3;
        // Labelled pins sit above their point; a dot is centred on it.
        const rect: Rect =
          d === 'dot'
            ? { x1: pt.x - w / 2 - pad, y1: pt.y - h / 2 - pad, x2: pt.x + w / 2 + pad, y2: pt.y + h / 2 + pad }
            : { x1: pt.x - w / 2 - pad, y1: pt.y - h - pad, x2: pt.x + w / 2 + pad, y2: pt.y + pad };

        // The dot is the floor: it is placed even when it overlaps, because a
        // station that renders nothing cannot be clicked or hovered.
        if (d === 'dot' || !hits(rect)) {
          out[st.id] = d;
          placed.push(rect);
          break;
        }
      }
    }
    return out;
  }
}

/** Recentres and zooms when a station is picked from a list elsewhere. */
export function MapFocus({ station }: { station?: Station }) {
  const map = useMap();
  React.useEffect(() => {
    if (!station) return;
    map.flyTo([station.lat, station.lng], Math.max(map.getZoom(), 11), { duration: 0.8 });
  }, [map, station]);
  return null;
}

/**
 * Atmospheric dispersion overlay.
 *
 * Drawn as one canvas rather than a grid of Leaflet rectangles. The grid
 * version banded the field into 324 visible squares with hard edges; this
 * accumulates a soft radial gradient per station with `lighter` compositing,
 * then maps the summed intensity through the dispersion ramp. Overlapping
 * plumes therefore blend into each other instead of tiling, and a hotspot
 * fades outward continuously with no circular edge of its own.
 */
const HEAT_W = 760;
const HEAT_H = Math.round(
  (HEAT_W * (NCR_BOUNDS.north - NCR_BOUNDS.south)) / (NCR_BOUNDS.east - NCR_BOUNDS.west),
);

/** 256-entry colour lookup baked from the ramp, sampled per pixel. */
function buildRampLut(): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [stop, color] of DISPERSION_STOPS) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

function HeatOverlay({ frame, field }: { frame: TerminalFrame; field: TerminalField }) {
  const { stations } = useMesh();
  const map = useMap();
  const overlay = React.useRef<L.ImageOverlay | null>(null);
  const lut = React.useMemo(() => buildRampLut(), []);

  React.useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = HEAT_W;
    canvas.height = HEAT_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const lngSpan = NCR_BOUNDS.east - NCR_BOUNDS.west;
    const latSpan = NCR_BOUNDS.north - NCR_BOUNDS.south;

    // --- accumulate intensity as greyscale ---
    ctx.clearRect(0, 0, HEAT_W, HEAT_H);
    ctx.globalCompositeOperation = 'lighter';
    for (const st of stations) {
      // The frame can lag the mesh by one render; a node with no sample has
      // nothing to contribute to the heat field.
      const sample = frame.nodes[st.id];
      if (!sample) continue;
      const v = fieldIntensity(sample, field);
      if (v <= 0.01) continue;

      const x = ((st.lng - NCR_BOUNDS.west) / lngSpan) * HEAT_W;
      const y = ((NCR_BOUNDS.north - st.lat) / latSpan) * HEAT_H;
      // Loaded nodes reach further, so plumes visibly spread into neighbours.
      const radius = HEAT_W * (0.1 + v * 0.11);

      // A tight, hot core over a wide skirt: the core has to accumulate far
      // enough up the ramp to reach crimson, while the skirt keeps spreading
      // into neighbouring zones so plumes merge rather than sit side by side.
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(255,255,255,${(0.95 * v).toFixed(3)})`);
      g.addColorStop(0.16, `rgba(255,255,255,${(0.5 * v).toFixed(3)})`);
      g.addColorStop(0.42, `rgba(255,255,255,${(0.22 * v).toFixed(3)})`);
      g.addColorStop(0.74, `rgba(255,255,255,${(0.06 * v).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // --- map accumulated alpha through the dispersion ramp ---
    const img = ctx.getImageData(0, 0, HEAT_W, HEAT_H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      const o = a * 4;
      d[i] = lut[o];
      d[i + 1] = lut[o + 1];
      d[i + 2] = lut[o + 2];
      d[i + 3] = lut[o + 3];
    }
    ctx.putImageData(img, 0, 0);

    const bounds = L.latLngBounds(
      [NCR_BOUNDS.south, NCR_BOUNDS.west],
      [NCR_BOUNDS.north, NCR_BOUNDS.east],
    );
    const url = canvas.toDataURL('image/png');

    if (overlay.current) {
      overlay.current.setUrl(url);
    } else {
      overlay.current = L.imageOverlay(url, bounds, {
        opacity: 1,
        interactive: false,
        className: 'term-heat',
      }).addTo(map);
    }
  }, [frame, field, map, lut, stations]);

  // Strip the overlay when the layer is switched off or the map unmounts.
  React.useEffect(
    () => () => {
      overlay.current?.remove();
      overlay.current = null;
    },
    [],
  );

  return null;
}

/** Resolution of the lattice the contours are traced on. */
const CONTOUR_N = 52;

/**
 * PM2.5 iso-contours at CPCB breakpoints.
 *
 * The previous layer outlined every grid cell above a cutoff, which drew a
 * staircase of squares rather than a contour. This traces the real iso-line
 * with marching squares (`lib/terminal/contours`), smooths it, and projects it
 * onto the map — so 90 µg/m³ is a curve that means 90 µg/m³.
 */
function IsoContours({ frame }: { frame: TerminalFrame }) {
  const { stations } = useMesh();
  // SVG rather than the map's canvas renderer: contours need dash patterns and
  // their labels are DOM, and canvas paths cannot carry either.
  const renderer = React.useMemo(() => L.svg({ padding: 0.4 }), []);

  const levels = React.useMemo(() => {
    const grid = pm25Grid(frame, CONTOUR_N, stations);
    return CONTOUR_LEVELS.map((level) => ({
      ...level,
      paths: isoContours(grid, level.value)
        // Drop specks: a handful of vertices is noise, not a plume boundary.
        .filter((path) => path.length >= 8)
        .map((path) => smoothPath(path, 2).map((pt) => gridToLatLng(CONTOUR_N, pt))),
    }));
  }, [frame, stations]);

  return (
    <>
      {levels.map((level) =>
        level.paths.map((positions, i) => (
          <Polyline
            key={`${level.value}-${i}`}
            positions={positions}
            interactive={false}
            pathOptions={{
              renderer,
              color: level.color,
              weight: level.weight,
              opacity: 0.75,
              fill: false,
              dashArray: level.dash ?? undefined,
              lineCap: 'round',
              lineJoin: 'round',
              // className here is inert; see classOnAdd.
              className: 'term-contour',
            }}
            eventHandlers={classOnAdd('term-contour')}
          />
        )),
      )}
      {levels.map((level) => {
        // Label the longest ring of each level, at its northernmost vertex.
        const longest = level.paths.slice().sort((a, b) => b.length - a.length)[0];
        if (!longest) return null;
        const top = longest.reduce((best, p) => (p[0] > best[0] ? p : best), longest[0]);
        return (
          <Marker
            key={`label-${level.value}`}
            position={top}
            interactive={false}
            icon={L.divIcon({
              className: 'as-pin-wrap',
              iconSize: [34, 14],
              iconAnchor: [17, 7],
              html: `<span class="term-contour-label" style="--c:${level.color}">${level.label}</span>`,
            })}
          />
        );
      })}
    </>
  );
}

/**
 * Source-to-receptor transport ribbons.
 *
 * The rail already reports where the load comes from as percentages; this puts
 * those four inflows on the map as the paths they actually travel. Width tracks
 * the apportioned share, and the animated dash runs downwind so direction is
 * readable without an arrowhead.
 */
function SourceRibbons() {
  const renderer = React.useMemo(() => L.svg({ padding: 0.4 }), []);

  const ribbons = React.useMemo(
    () =>
      PLUME_SOURCES.map((src) => {
        const [aLat, aLng] = src.entry;
        const [bLat, bLng] = src.target;

        // Quadratic bezier, bowed perpendicular to the entry-target line so the
        // four ribbons curve into the basin instead of crossing it straight.
        const mLat = (aLat + bLat) / 2;
        const mLng = (aLng + bLng) / 2;
        const dLat = bLat - aLat;
        const dLng = bLng - aLng;
        const len = Math.hypot(dLat, dLng) || 1;
        const cLat = mLat + (-dLng / len) * src.curve;
        const cLng = mLng + (dLat / len) * src.curve;

        const positions: [number, number][] = [];
        const STEPS = 36;
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          const u = 1 - t;
          positions.push([
            u * u * aLat + 2 * u * t * cLat + t * t * bLat,
            u * u * aLng + 2 * u * t * cLng + t * t * bLng,
          ]);
        }
        return { ...src, positions };
      }),
    [],
  );

  return (
    <>
      {ribbons.map((r) => (
        <React.Fragment key={r.id}>
          {/* soft body of the plume */}
          <Polyline
            positions={r.positions}
            interactive={false}
            pathOptions={{
              renderer,
              color: r.color,
              weight: 9 + r.share * 0.42,
              opacity: 0.13,
              fill: false,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          {/* flowing core */}
          <Polyline
            positions={r.positions}
            interactive={false}
            pathOptions={{
              renderer,
              color: r.color,
              weight: 1.6 + r.share * 0.055,
              opacity: 0.7,
              fill: false,
              lineCap: 'round',
              className: 'term-ribbon',
            }}
            eventHandlers={classOnAdd('term-ribbon')}
          />
          <Marker
            position={r.positions[0]}
            interactive={false}
            icon={L.divIcon({
              className: 'as-pin-wrap',
              iconSize: [132, 16],
              iconAnchor: [66, 8],
              html:
                `<span class="term-ribbon-label" style="--c:${r.color}">` +
                `${r.label.toUpperCase()} · ${r.share}%</span>`,
            })}
          />
        </React.Fragment>
      ))}
    </>
  );
}

/** Cycled so neighbouring streamlines do not pulse in unison. */
/**
 * Puts a class on a vector's <path> once Leaflet has created it.
 *
 * `className` inside `pathOptions` does not survive react-leaflet: it applies
 * path options through Leaflet's `setStyle()`, which handles stroke, weight and
 * opacity but ignores `className` entirely. A development build hid this,
 * because StrictMode mounts every layer twice and the second pass happened to
 * leave the class attached; a production build mounts once and the class never
 * appeared. The strokes were all correct, so the map looked right - only the
 * CSS dash animations, which are keyed off these classes, were silently dead.
 *
 * Attaching on `add` is the one point where the element is guaranteed to exist.
 */
function classOnAdd(...names: string[]) {
  return {
    add(e: { target: { getElement?: () => Element | null } }) {
      const el = e.target.getElement?.();
      if (el) el.classList.add(...names);
    },
  };
}

const STREAM_PHASES = ['a', 'b', 'c'] as const;

/**
 * Wind as evenly-spaced, flowing streamlines.
 *
 * Replaces the 7x7 lattice of arrow markers: a regular grid of identical glyphs
 * shows direction at 49 points but never the *pattern* — where air channels
 * along a barrier, converges into the basin, or stalls.
 *
 * The dash animates downwind, which carries direction on its own, so each line
 * is a single stroke at uniform opacity rather than the earlier opacity taper.
 * Motion is pure CSS: no animation frame loop to pause, and `prefers-reduced-
 * motion` drops it to solid lines.
 */
function WindStreamlines({ frame }: { frame: TerminalFrame }) {
  const { stations } = useMesh();
  const renderer = React.useMemo(() => L.svg({ padding: 0.4 }), []);

  const lines = React.useMemo(() => {
    // Only the nodes this frame carries. buildWindContext averages over the
    // samples and a missing one would take the mean with it.
    const ctx = buildWindContext(
      stations.map((st) => frame.nodes[st.id]).filter(Boolean),
    );
    return streamlines(ctx);
  }, [frame, stations]);

  return (
    <>
      {lines.map((positions, i) => (
        <Polyline
          key={`stream-${i}`}
          positions={positions}
          interactive={false}
          pathOptions={{
            renderer,
            color: TERM.secondary,
            weight: 1.1,
            opacity: 0.46,
            fill: false,
            lineCap: 'round',
            lineJoin: 'round',
            className: `term-stream term-stream-${STREAM_PHASES[i % STREAM_PHASES.length]}`,
          }}
          eventHandlers={classOnAdd(
            'term-stream',
            `term-stream-${STREAM_PHASES[i % STREAM_PHASES.length]}`,
          )}
        />
      ))}
    </>
  );
}

/** Rendered footprint per density, used for both the icon and collision tests. */
const PIN_SIZE: Record<PinDensity, [number, number]> = {
  full: [86, 48],
  compact: [44, 34],
  dot: [16, 16],
};

function buildPin(
  station: Station,
  pm: number,
  aqi: number,
  alert: string,
  selected: boolean,
  density: PinDensity,
) {
  // The pin body is coloured by composite AQI so it agrees with every list on
  // the page; the tooltip carries the PM2.5 band separately.
  const color = aqiColor(aqi);
  const alertColor = TERMINAL_ALERT_COLOR[alert as keyof typeof TERMINAL_ALERT_COLOR] ?? color;
  const critical = alert === 'EMERGENCY';

  const html = `
    <div class="as-pin as-pin-${density}" style="--pin:${color};--alert:${alertColor};--pm:${pm25Color(pm)}">
      ${critical ? '<span class="as-pin-ring"></span>' : ''}
      <div class="as-pin-body${selected ? ' as-pin-selected' : ''}">
        ${density === 'dot' ? '' : `<span class="as-pin-aqi">${aqi}</span>`}
        ${density === 'full' ? `<span class="as-pin-name">${station.name}</span>` : ''}
      </div>
      <span class="as-pin-stem"></span>
    </div>`;

  const size = PIN_SIZE[density];
  return L.divIcon({
    className: 'as-pin-wrap',
    iconSize: size,
    // Anchored at the bottom of the stem for the labelled densities so the pin
    // points at its station; a dot has no stem and anchors at its centre.
    iconAnchor: density === 'dot' ? [size[0] / 2, size[1] / 2] : [size[0] / 2, size[1]],
    html,
  });
}
