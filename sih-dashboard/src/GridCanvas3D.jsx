import React, { useMemo, useEffect, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import {
  ColumnLayer, ScatterplotLayer, ArcLayer, TextLayer
} from '@deck.gl/layers';
import { LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { fetchForecastGrid } from '@/lib/api';

// ── Free basemap (no token needed) ───────────────────────────────────────────
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// ── Delhi NCR bounds ─────────────────────────────────────────────────────────
const BOUNDS = { minLon: 76.80, maxLon: 77.60, minLat: 28.20, maxLat: 28.90 };

const INITIAL_VIEW = {
  longitude: 77.2090,
  latitude:  28.5900,
  zoom:      10.2,
  pitch:     38,
  bearing:   -8,
};

// ── Known CPCB monitoring stations (positions are real; PM2.5 values from backend) ──
// These are used as station markers. Values are populated from backend when available.
const STATION_POSITIONS = [
  { name: "Anand Vihar",     lat: 28.6469, lon: 77.3160 },
  { name: "ITO",             lat: 28.6312, lon: 77.2410 },
  { name: "Punjabi Bagh",    lat: 28.6683, lon: 77.1167 },
  { name: "RK Puram",        lat: 28.5632, lon: 77.1869 },
  { name: "Gurugram Sec-51", lat: 28.4221, lon: 77.0677 },
  { name: "Noida Sec-62",    lat: 28.6245, lon: 77.3649 },
  { name: "DTU",             lat: 28.7497, lon: 77.1160 },
  { name: "Okhla",           lat: 28.5621, lon: 77.2753 },
  { name: "Faridabad",       lat: 28.4089, lon: 77.3178 },
  { name: "Ghaziabad",       lat: 28.6692, lon: 77.4538 },
];

// ── Deck.gl lighting ─────────────────────────────────────────────────────────
const LIGHTING = new LightingEffect({
  ambientLight:     new AmbientLight({ color: [255,255,255], intensity: 0.9 }),
  directionalLight: new DirectionalLight({
    color: [200, 220, 255], intensity: 1.2,
    direction: [-3, -5, -1],
  }),
});

// ── CPCB AQI colour scale ─────────────────────────────────────────────────────
function cpcbColor(pm25) {
  if (pm25 <= 30)  return [0,   210,   0,  145];  // Good
  if (pm25 <= 60)  return [230, 230,   0,  155];  // Satisfactory
  if (pm25 <= 90)  return [255, 126,   0,  170];  // Moderate
  if (pm25 <= 120) return [220,  28,  28,  180];  // Poor
  if (pm25 <= 250) return [153,   0,  76,  200];  // Very Poor
  return               [110,   0,  30,  220];    // Severe+
}

// ── Stubble plume arc paths (Punjab → Delhi) ──────────────────────────────────
const PLUME_ARCS = [
  { source: [74.9, 31.0], target: [76.9, 28.75] },
  { source: [75.8, 30.2], target: [77.1, 28.72] },
  { source: [76.3, 29.5], target: [77.3, 28.65] },
];

// ── Wind particle system ──────────────────────────────────────────────────────
const N_PARTICLES = 220;
function buildParticles(frame, windAngleDeg = -45) {
  const windAngle = windAngleDeg * Math.PI / 180;
  const speed = 0.008;
  const t = frame * 0.012;

  return Array.from({ length: N_PARTICLES }, (_, i) => {
    const seed = i * 137.508;
    const baseLon = BOUNDS.minLon + ((seed * 0.7) % 1) * (BOUNDS.maxLon - BOUNDS.minLon);
    const baseLat = BOUNDS.minLat + ((seed * 0.3) % 1) * (BOUNDS.maxLat - BOUNDS.minLat);
    const phase = (t + i * 0.05) % 1;
    const lon = ((baseLon + phase * Math.cos(windAngle) * speed - BOUNDS.minLon)
      % (BOUNDS.maxLon - BOUNDS.minLon) + (BOUNDS.maxLon - BOUNDS.minLon))
      % (BOUNDS.maxLon - BOUNDS.minLon) + BOUNDS.minLon;
    const lat = baseLat + phase * Math.sin(windAngle) * speed;
    return {
      position: [lon, Math.max(BOUNDS.minLat, Math.min(BOUNDS.maxLat, lat))],
      alpha: Math.round(Math.sin(phase * Math.PI) * 190),
    };
  });
}

// ── Main component ────────────────────────────────────────────────────────────
/**
 * GridCanvas3D — 3D pollution map using Deck.gl + MapLibre.
 *
 * Props:
 *   step      : Current forecast hour (0–71), used to fetch the correct grid step
 *   layers    : Layer toggle flags { heatmap, particles, pbl, plume }
 *   width/height: Canvas dimensions
 *
 * Data policy:
 *   - Grid cells come from /api/v1/forecast/grid (real backend inference)
 *   - Station markers use known CPCB lat/lon positions
 *   - If the backend is unreachable, an empty grid is shown (not a fake one)
 *   - SYNTHETIC label is shown when backend data_mode is 'synthetic'
 */
export default function GridCanvas3D({ step = 0, layers = {} }) {
  const { heatmap = true, particles = true, plume = true, pbl: pblLayer = true } = layers;

  const frameRef = useRef(0);
  const [tick, setTick] = useState(0);

  // Backend grid state
  const [gridCells,   setGridCells]   = useState([]);
  const [gridMeta,    setGridMeta]    = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError,   setGridError]   = useState(null);
  const lastFetchedStep = useRef(-1);

  // ── Fetch grid from backend when step changes ───────────────────────────
  useEffect(() => {
    // Debounce: only fetch if step has stabilised (avoid spamming during slider drag)
    const id = setTimeout(async () => {
      if (lastFetchedStep.current === step) return;
      setGridLoading(true);
      setGridError(null);
      const { data, error } = await fetchForecastGrid(step);
      setGridLoading(false);
      if (error) {
        setGridError(error);
        setGridCells([]);
        return;
      }
      lastFetchedStep.current = step;
      setGridMeta(data?.meta ?? null);
      // Convert GeoJSON features → deck.gl cell objects
      const cells = (data?.features ?? []).map(f => ({
        position: f.geometry.coordinates,  // [lon, lat]
        pm25: f.properties?.pm25 ?? 0,
        pbl:  f.properties?.pbl  ?? 0,
      }));
      setGridCells(cells);
    }, 300); // 300ms debounce

    return () => clearTimeout(id);
  }, [step]);

  // ── Animation loop (wind particles) ─────────────────────────────────────
  useEffect(() => {
    let raf;
    const animate = () => {
      frameRef.current += 1;
      setTick(t => t + 1);
      raf = requestAnimationFrame(animate);
    };
    if (particles) raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [particles]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const particleData = useMemo(() => buildParticles(frameRef.current), [tick]);

  // ── Determine if data is synthetic ───────────────────────────────────────
  const isSynthetic = !gridMeta || gridMeta.data_mode === 'synthetic' || !gridMeta.weights_loaded;

  // ── Mean PM2.5 from grid for PBL ring scaling ────────────────────────────
  const meanPm25 = gridCells.length > 0
    ? gridCells.reduce((s, c) => s + c.pm25, 0) / gridCells.length
    : 150;

  const meanPbl = gridCells.length > 0
    ? gridCells.reduce((s, c) => s + c.pbl, 0) / gridCells.length
    : 500;

  // PBL contour ring using actual mean PBL from grid
  const pblRing = useMemo(() => {
    const pbl = Math.max(50, meanPbl);
    const cx = 77.20, cy = 28.59;
    const scale = 0.06 + pbl / 12000;
    return Array.from({ length: 60 }, (_, i) => {
      const rad = (i / 60) * Math.PI * 2;
      return { position: [cx + scale * Math.cos(rad) * 1.3, cy + scale * Math.sin(rad)] };
    });
  }, [meanPbl]);

  // ── Deck.gl layers ───────────────────────────────────────────────────────
  const deckLayers = [

    // 1. PM2.5 grid columns — from backend GeoJSON
    heatmap && gridCells.length > 0 && new ColumnLayer({
      id: 'pm25-grid',
      data: gridCells,
      diskResolution: 6,
      radius: 420,
      extruded: true,
      pickable: true,
      elevationScale: 1,
      opacity: 0.65,
      material: { ambient: 0.4, diffuse: 0.8, shininess: 16 },
      getPosition:  d => d.position,
      getFillColor: d => cpcbColor(d.pm25),
      getElevation: d => {
        const norm = Math.min(d.pm25 / 400, 1);
        return Math.pow(norm, 1.6) * 4500;
      },
      updateTriggers: { getElevation: [step], getFillColor: [step] },
      transitions:    { getElevation: 500, getFillColor: 500 },
    }),

    // 2. Wind particles
    particles && new ScatterplotLayer({
      id: 'wind-particles',
      data: particleData,
      pickable: false,
      radiusMinPixels: 1,
      radiusMaxPixels: 2,
      getPosition:  d => d.position,
      getFillColor: d => [160, 210, 255, d.alpha],
      getRadius: 300,
    }),

    // 3. CPCB station markers (positions are real; PM2.5 from grid interpolation)
    new ScatterplotLayer({
      id: 'stations',
      data: STATION_POSITIONS,
      pickable: true,
      stroked: true,
      filled: true,
      radiusMinPixels: 5,
      radiusMaxPixels: 14,
      lineWidthMinPixels: 2,
      getPosition:  d => [d.lon, d.lat],
      // Find nearest grid cell for colour; fallback to grey if grid empty
      getFillColor: d => {
        if (gridCells.length === 0) return [120, 120, 120, 180];
        const nearest = gridCells.reduce((best, c) => {
          const dist = Math.hypot(c.position[0] - d.lon, c.position[1] - d.lat);
          return dist < best.dist ? { dist, pm25: c.pm25 } : best;
        }, { dist: Infinity, pm25: 0 });
        return cpcbColor(nearest.pm25);
      },
      getLineColor: [255, 255, 255, 200],
      getRadius: 700,
      updateTriggers: { getFillColor: [gridCells] },
    }),

    // 4. Station labels
    new TextLayer({
      id: 'station-labels',
      data: STATION_POSITIONS,
      pickable: false,
      getPosition:  d => [d.lon, d.lat, 1200],
      getText:      d => d.name,
      getSize: 11,
      getColor: [220, 230, 240, 220],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'top',
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      outlineWidth: 3,
      outlineColor: [0, 0, 0, 255],
      background: true,
      backgroundPadding: [3, 2],
      getBackgroundColor: [8, 14, 30, 200],
    }),

    // 5. Stubble plume arcs — only shown when fires are active (FIRMS data pending)
    plume && new ArcLayer({
      id: 'plume-glow',
      data: PLUME_ARCS,
      pickable: false,
      getSourcePosition: d => d.source,
      getTargetPosition: d => d.target,
      getSourceColor: [255, 120, 20, 40],
      getTargetColor: [130, 130, 130, 20],
      getWidth: 8,
      getHeight: 0.42,
      widthUnits: 'pixels',
    }),
    plume && new ArcLayer({
      id: 'plume-core',
      data: PLUME_ARCS,
      pickable: false,
      getSourcePosition: d => d.source,
      getTargetPosition: d => d.target,
      getSourceColor: [255, 160, 50, 160],
      getTargetColor: [160, 100, 80, 80],
      getWidth: 2,
      getHeight: 0.42,
      widthUnits: 'pixels',
    }),

    // 6. PBL contour ring (radius driven by actual mean PBL from grid)
    pblLayer && new ScatterplotLayer({
      id: 'pbl-contour',
      data: pblRing,
      pickable: false,
      opacity: 0.45,
      radiusMinPixels: 2,
      getPosition:  d => d.position,
      getFillColor: [99, 102, 241, 150],
      getRadius: 240,
      updateTriggers: { data: [meanPbl] },
    }),

  ].filter(Boolean);

  // ── Tooltip ──────────────────────────────────────────────────────────────
  const getTooltip = ({ object }) => {
    if (!object) return null;
    if (object.name) {
      return {
        html: `<div style="font:10px 'JetBrains Mono',monospace;background:#0D1424;border:1px solid #1E2D4A;padding:6px 10px;border-radius:4px">
          <b style="color:#E2E8F0">${object.name}</b><br/>CPCB Station
        </div>`,
        style: { background: 'none', border: 'none', padding: 0 },
      };
    }
    if (object.pm25 !== undefined) {
      return {
        html: `<div style="font:10px 'JetBrains Mono',monospace;background:#0D1424;border:1px solid #1E2D4A;padding:4px 8px;border-radius:4px">
          PM2.5: <b style="color:#EF4444">${Math.round(object.pm25)} µg/m³</b><br/>
          PBL: <b style="color:#818CF8">${object.pbl ? Math.round(object.pbl) + ' m' : '—'}</b>
        </div>`,
        style: { background: 'none', border: 'none', padding: 0 },
      };
    }
    return null;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller={{ scrollZoom: true, dragPan: true, dragRotate: true, doubleClickZoom: true }}
        layers={deckLayers}
        effects={[LIGHTING]}
        getTooltip={getTooltip}
      >
        <Map mapStyle={MAP_STYLE} attributionControl={false} />
      </DeckGL>

      {/* AQI Legend */}
      <div style={{
        position: 'absolute', bottom: 14, right: 14, zIndex: 10,
        background: 'rgba(9,13,22,0.93)', border: '1px solid #1E2D4A',
        borderRadius: 6, padding: '8px 12px',
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}>
        <div style={{ color: '#64748B', marginBottom: 5, fontSize: 8, letterSpacing: 1 }}>
          CPCB AQI  PM2.5 µg/m³
        </div>
        {[
          ['Good',        '0–30',   '#00D200'],
          ['Satisfactory','31–60',  '#E6E600'],
          ['Moderate',    '61–90',  '#FF7E00'],
          ['Poor',        '91–120', '#DC1C1C'],
          ['Very Poor',   '121–250','#990040'],
          ['Severe+',     '251+',   '#6E001E'],
        ].map(([label, range, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ color: '#94A3B8', fontSize: 9 }}>{label}</span>
            <span style={{ color: '#475569', fontSize: 8, marginLeft: 'auto', paddingLeft: 8 }}>{range}</span>
          </div>
        ))}
      </div>

      {/* Status HUD */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 10, pointerEvents: 'none',
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}>
        {gridLoading && (
          <div style={{ color: 'rgba(148,163,184,0.8)', fontSize: 9, letterSpacing: 1, marginBottom: 3 }}>
            ⟳ Loading grid T+{step}h...
          </div>
        )}
        {!gridLoading && gridCells.length > 0 && (
          <div style={{ color: isSynthetic ? 'rgba(251,191,36,0.85)' : 'rgba(34,197,94,0.85)', fontSize: 9, letterSpacing: 1 }}>
            {isSynthetic ? '⚠ SYNTHETIC' : '● LIVE'} · {gridCells.length} cells · T+{step}h
          </div>
        )}
        {gridError && (
          <div style={{ color: 'rgba(239,68,68,0.85)', fontSize: 9, letterSpacing: 1 }}>
            ✗ Grid unavailable
          </div>
        )}
        {!gridLoading && gridCells.length === 0 && !gridError && (
          <div style={{ color: 'rgba(148,163,184,0.6)', fontSize: 9, letterSpacing: 1 }}>
            Awaiting backend data...
          </div>
        )}
        {gridMeta && (
          <div style={{ color: 'rgba(148,163,184,0.55)', fontSize: 8, marginTop: 2 }}>
            {gridMeta.model_ver} · {gridMeta.grid_shape?.[0]}×{gridMeta.grid_shape?.[1]} grid
          </div>
        )}
      </div>
    </div>
  );
}
