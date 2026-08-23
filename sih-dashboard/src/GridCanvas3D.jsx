import React, { useMemo, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import {
  ColumnLayer, ScatterplotLayer, ArcLayer, TextLayer
} from '@deck.gl/layers';
import { LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── Free basemap (no token needed) ───────────────────────────────────────────
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// ── Delhi NCR bounds ─────────────────────────────────────────────────────────
const BOUNDS = { minLon: 76.85, maxLon: 77.55, minLat: 28.35, maxLat: 28.85 };
const GRID_COLS = 36;
const GRID_ROWS = 30;

const INITIAL_VIEW = {
  longitude: 77.2090,
  latitude:  28.5900,
  zoom:      10.2,
  pitch:     38,
  bearing:   -8,
};

// ── CPCB AQI monitoring stations — PM2.5 values span full CPCB AQI range
// so the colour gradient is visible across the map
const STATIONS = [
  { name: "Anand Vihar",     lat: 28.6469, lon: 77.3160, pm25: 340 },  // Severe
  { name: "ITO",             lat: 28.6312, lon: 77.2410, pm25: 210 },  // Very Poor
  { name: "Punjabi Bagh",    lat: 28.6683, lon: 77.1167, pm25: 155 },  // Very Poor (low)
  { name: "RK Puram",        lat: 28.5632, lon: 77.1869, pm25: 110 },  // Poor
  { name: "Gurugram Sec-51", lat: 28.4221, lon: 77.0677, pm25:  72 },  // Moderate
  { name: "Noida Sec-62",    lat: 28.6245, lon: 77.3649, pm25: 240 },  // Very Poor
  { name: "DTU",             lat: 28.7497, lon: 77.1160, pm25:  45 },  // Satisfactory
  { name: "Okhla",           lat: 28.5621, lon: 77.2753, pm25: 185 },  // Very Poor
  { name: "Faridabad",       lat: 28.4089, lon: 77.3178, pm25:  88 },  // Moderate (hi)
  { name: "Ghaziabad",       lat: 28.6692, lon: 77.4538, pm25: 290 },  // Very Poor
  { name: "Sonipat",         lat: 28.9988, lon: 77.0151, pm25:  22 },  // Good
];

// ── Deck.gl lighting ─────────────────────────────────────────────────────────
const LIGHTING = new LightingEffect({
  ambientLight:     new AmbientLight({ color: [255,255,255], intensity: 0.9 }),
  directionalLight: new DirectionalLight({
    color: [200, 220, 255], intensity: 1.2,
    direction: [-3, -5, -1],
  }),
});

// ── CPCB AQI colour scale — softened saturation, per-band alpha ───────────────
function cpcbColor(pm25) {
  if (pm25 <= 50)  return [0,   210,   0,  145];   // Good        – near-floor, soft green
  if (pm25 <= 100) return [230, 230,   0,  155];   // Satisfactory – yellow
  if (pm25 <= 200) return [255, 126,   0,  170];   // Moderate/Poor – orange
  if (pm25 <= 300) return [220,  28,  28,  180];   // Poor/V.Poor   – red
  if (pm25 <= 400) return [153,   0,  76,  200];   // Very Poor     – dark rose
  return               [110,   0,  30,  220];     // Severe+       – deep crimson
}

// ── Simulate PBL height from step ────────────────────────────────────────────
function pblFromStep(step) {
  const diurnal = 1 + 0.28 * Math.sin((step % 24) / 24 * Math.PI * 2 - Math.PI / 2);
  const plumeBoost = step >= 14 ? Math.min((step - 14) / 8, 1) * 110 : 0;
  const pm25 = 380 * diurnal + plumeBoost;
  return Math.max(120, 320 - (pm25 - 380) * 0.42);
}

// ── IDW interpolation grid ──────────────────────────────────────────────────────
function buildGrid(step) {
  const diurnal  = 1 + 0.25 * Math.sin((step % 24) / 24 * Math.PI * 2 - Math.PI / 2);
  const plumeArr = step >= 14 ? Math.min((step - 14) / 8, 1) : 0;
  const cells = [];

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const lon = BOUNDS.minLon + (c / GRID_COLS) * (BOUNDS.maxLon - BOUNDS.minLon);
      const lat = BOUNDS.maxLat - (r / GRID_ROWS) * (BOUNDS.maxLat - BOUNDS.minLat);
      let wSum = 0, vSum = 0;

      for (const s of STATIONS) {
        const d = Math.hypot(lat - s.lat, lon - s.lon) + 0.008;
        const w = 1 / (d * d);
        const plumeBoost = plumeArr * 120
          * Math.max(0, (lat - 28.30) / 0.60)
          * Math.max(0, (77.40 - lon) / 0.60);
        wSum += w;
        vSum += w * (s.pm25 * diurnal + plumeBoost);
      }

      const pm25 = vSum / wSum;
      // Non-linear height: low AQI stays flat, severe pops up
      const normPm25 = Math.min(pm25 / 400, 1);
      const elevation = Math.pow(normPm25, 1.6) * 4500; // max ~4500m at severe
      cells.push({ position: [lon, lat], pm25, elevation });
    }
  }
  return { cells, plumeArr };
}

// ── Wind particle system ──────────────────────────────────────────────────────
const N_PARTICLES = 260;
function buildParticles(frame, plumeArr) {
  const windAngle = (-45 - plumeArr * 20) * Math.PI / 180;
  const speed = 0.008 + plumeArr * 0.006;
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

// ── PBL contour ring ─────────────────────────────────────────────────────────
function buildPBLRing(step) {
  const pbl = pblFromStep(step);
  const cx = 77.15, cy = 28.62;
  const scale = 0.12 + pbl / 8000;
  return Array.from({ length: 60 }, (_, i) => {
    const rad = (i / 60) * Math.PI * 2;
    return { position: [cx + scale * Math.cos(rad) * 1.3, cy + scale * Math.sin(rad)] };
  });
}

// ── Stubble plume arcs ────────────────────────────────────────────────────────
const PLUME_ARCS = [
  { source: [74.9, 31.0], target: [76.9, 28.75] },
  { source: [75.8, 30.2], target: [77.1, 28.72] },
  { source: [76.3, 29.5], target: [77.3, 28.65] },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function GridCanvas3D({ step = 0, layers = {} }) {
  const { heatmap = true, particles = true, plume = true, pbl: pblLayer = true } = layers;

  const frameRef   = useRef(0);
  const [tick, setTick] = React.useState(0);

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

  const { cells, plumeArr } = useMemo(() => buildGrid(step), [step]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const particleData        = useMemo(() => buildParticles(frameRef.current, plumeArr), [tick]);
  const pblRing             = useMemo(() => buildPBLRing(step), [step]);

  const deckLayers = [
    // ── 1. PM2.5 Column Grid — semi-transparent, non-linear height ──────────────
    heatmap && new ColumnLayer({
      id: 'pm25-grid',
      data: cells,
      diskResolution: 6,
      radius: 360,            // smaller radius = visible gaps between columns
      extruded: true,
      pickable: true,
      elevationScale: 1,
      opacity: 0.65,          // let basemap breathe through
      material: { ambient: 0.4, diffuse: 0.8, shininess: 16 },
      getPosition:  d => d.position,
      getFillColor: d => cpcbColor(d.pm25),
      getElevation: d => d.elevation,
      updateTriggers: { getElevation: [step], getFillColor: [step] },
      transitions:    { getElevation: 500, getFillColor: 500 },
    }),

    // ── 2. Wind particles ────────────────────────────────────────────────
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

    // ── 3. CPCB station dots ──────────────────────────────────────────────
    new ScatterplotLayer({
      id: 'stations',
      data: STATIONS,
      pickable: true,
      stroked: true,
      filled: true,
      radiusMinPixels: 5,
      radiusMaxPixels: 14,
      lineWidthMinPixels: 2,
      getPosition:  d => [d.lon, d.lat],
      getFillColor: d => cpcbColor(d.pm25),
      getLineColor: [255, 255, 255, 200],
      getRadius: 700,
    }),

    // ── 4. Station labels ────────────────────────────────────────────────
    new TextLayer({
      id: 'station-labels',
      data: STATIONS,
      pickable: false,
      getPosition:  d => [d.lon, d.lat, 1200],
      getText:      d => `${d.name}  ${Math.round(d.pm25)}`,
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

    // ── 5. Stubble plume arcs — smoky orange→grey, semi-transparent ────────
    // Two arc layers per plume path: outer glow (wider, dimmer) + core line
    plume && plumeArr > 0 && new ArcLayer({
      id: 'plume-glow',
      data: PLUME_ARCS,
      pickable: false,
      getSourcePosition: d => d.source,
      getTargetPosition: d => d.target,
      getSourceColor: [255, 120,  20, Math.round(60 * plumeArr)],  // orange, faint
      getTargetColor: [130, 130, 130, Math.round(30 * plumeArr)],  // grey, very faint
      getWidth: 12 * plumeArr,
      getHeight: 0.42,
      widthUnits: 'pixels',
    }),
    plume && plumeArr > 0 && new ArcLayer({
      id: 'plume-core',
      data: PLUME_ARCS,
      pickable: false,
      getSourcePosition: d => d.source,
      getTargetPosition: d => d.target,
      getSourceColor: [255, 160,  50, Math.round(200 * plumeArr)], // bright orange
      getTargetColor: [160, 100,  80, Math.round(100 * plumeArr)], // smoky brown
      getWidth: 3 * plumeArr,
      getHeight: 0.42,
      widthUnits: 'pixels',
    }),

    // ── 6. PBL contour ring ────────────────────────────────────────────────
    pblLayer && new ScatterplotLayer({
      id: 'pbl-contour',
      data: pblRing,
      pickable: false,
      opacity: 0.55,
      radiusMinPixels: 2,
      getPosition:  d => d.position,
      getFillColor: [99, 102, 241, 170],
      getRadius: 260,
    }),
  ].filter(Boolean);

  const getTooltip = ({ object }) => {
    if (!object) return null;
    if (object.name) {
      return {
        html: `<div style="font:10px 'JetBrains Mono',monospace;background:#0D1424;border:1px solid #1E2D4A;padding:6px 10px;border-radius:4px">
          <b style="color:#E2E8F0">${object.name}</b><br/>PM2.5: <b style="color:#EF4444">${Math.round(object.pm25)} µg/m³</b>
        </div>`,
        style: { background: 'none', border: 'none', padding: 0 },
      };
    }
    if (object.pm25) {
      return {
        html: `<div style="font:10px 'JetBrains Mono',monospace;background:#0D1424;border:1px solid #1E2D4A;padding:4px 8px;border-radius:4px">
          PM2.5: <b style="color:#EF4444">${Math.round(object.pm25)} µg/m³</b>
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
          ['Good',        '0–30',   '#00E400'],
          ['Satisfactory','31–60',  '#FFFF00'],
          ['Moderate',    '61–90',  '#FF7E00'],
          ['Poor',        '91–120', '#FF0000'],
          ['Very Poor',   '121–250','#99004C'],
          ['Severe',      '251–380','#7E0023'],
          ['Hazardous',   '381+',   '#5A0050'],
        ].map(([label, range, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ color: '#94A3B8', fontSize: 9 }}>{label}</span>
            <span style={{ color: '#475569', fontSize: 8, marginLeft: 'auto', paddingLeft: 8 }}>{range}</span>
          </div>
        ))}
      </div>

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 10, pointerEvents: 'none',
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
      }}>
        <div style={{ color: 'rgba(34,197,94,0.85)', fontSize: 9, letterSpacing: 1 }}>
          1km×1km NCR GRID · T+{step}h
        </div>
        <div style={{ color: 'rgba(148,163,184,0.65)', fontSize: 8, marginTop: 2 }}>
          {GRID_COLS * GRID_ROWS} cells · IDW · Deck.gl + Maplibre
        </div>
        {plumeArr > 0 && (
          <div style={{ color: 'rgba(251,146,60,0.9)', fontSize: 9, marginTop: 3 }}>
            ⚡ PLUME {Math.round(plumeArr * 100)}%
          </div>
        )}
      </div>
    </div>
  );
}
