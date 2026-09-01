import React, { useMemo, useEffect, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import {
  ColumnLayer, ScatterplotLayer, ArcLayer, TextLayer, BitmapLayer
} from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import { _GlobeView as GlobeView, LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core';
import { fetchForecastGrid } from '@/lib/api';

const DELHI_COORDS = { lat: 28.6139, lng: 77.2090 };
const BOUNDS = { minLon: 76.80, maxLon: 77.60, minLat: 28.20, maxLat: 28.90 };

const INITIAL_VIEW = {
  longitude: 0,
  latitude: 0,
  zoom: 1.0,
  pitch: 0,
  bearing: 0,
};

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

const LIGHTING = new LightingEffect({
  ambientLight:     new AmbientLight({ color: [255,255,255], intensity: 0.9 }),
  directionalLight: new DirectionalLight({
    color: [200, 220, 255], intensity: 1.2,
    direction: [-3, -5, -1],
  }),
});

function cpcbColor(pm25) {
  if (pm25 <= 30)  return [0,   210,   0,  145];
  if (pm25 <= 60)  return [230, 230,   0,  155];
  if (pm25 <= 90)  return [255, 126,   0,  170];
  if (pm25 <= 120) return [220,  28,  28,  180];
  if (pm25 <= 250) return [153,   0,  76,  200];
  return               [110,   0,  30,  220];
}

const PLUME_ARCS = [
  { source: [74.9, 31.0], target: [76.9, 28.75] },
  { source: [75.8, 30.2], target: [77.1, 28.72] },
  { source: [76.3, 29.5], target: [77.3, 28.65] },
];

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

export default function CinematicGlobe({ step = 0, layers = {} }) {
  const { heatmap = true, particles = true, plume = true, pbl: pblLayer = true } = layers;
  
  const frameRef = useRef(0);
  const [tick, setTick] = useState(0);

  const [gridCells,   setGridCells]   = useState([]);
  const [gridMeta,    setGridMeta]    = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError,   setGridError]   = useState(null);
  const lastFetchedStep = useRef(-1);
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  const [isScanning, setIsScanning] = useState(false);
  const [scanPulse, setScanPulse] = useState(0);
  const [scanPhase, setScanPhase] = useState('IDLE'); // 'IDLE', 'CHASE', 'DIVING', 'RESOLVED'
  const [satPosition, setSatPosition] = useState([0, DELHI_COORDS.lat, 800000]);
  const orbitRef = useRef(null);

  useEffect(() => {
    let startTime = Date.now();
    
    const animate = () => {
      const now = Date.now();
      
      // Satellite continuous orbit
      const lon = ((now % 30000) / 30000) * 360 - 180;
      setSatPosition([lon, DELHI_COORDS.lat, 800000]);

      if (isScanning) {
        const elapsed = (now - startTime) % 2000;
        setScanPulse(elapsed / 2000);
      }
      orbitRef.current = requestAnimationFrame(animate);
    };

    orbitRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current);
    };
  }, [isScanning, scanPhase]);

  const handleScanNcr = () => {
    setIsScanning(true);
    setScanPhase('CHASE');
    
    // Step 1 (Chase): Move camera
    setViewState({
      longitude: DELHI_COORDS.lng,
      latitude: DELHI_COORDS.lat - 5,
      zoom: 3.5,
      pitch: 80, 
      bearing: 0,
      transitionDuration: 2000
    });

    // Step 3 (The Dive): 1500ms delay after the 2000ms chase transition
    setTimeout(() => {
      setScanPhase('DIVING');
      setViewState({
        longitude: DELHI_COORDS.lng,
        latitude: DELHI_COORDS.lat,
        zoom: 11,
        pitch: 60,
        bearing: 0,
        transitionDuration: 4000
      });

      // Step 4 (The Reveal): Triggered when dive completes
      setTimeout(() => {
        setScanPhase('RESOLVED');
        setIsScanning(false);
      }, 4000);
    }, 3500);
  };

  useEffect(() => {
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
      const cells = (data?.features ?? []).map(f => ({
        position: f.geometry.coordinates,
        pm25: f.properties?.pm25 ?? 0,
        pbl:  f.properties?.pbl  ?? 0,
      }));
      setGridCells(cells);
    }, 300);

    return () => clearTimeout(id);
  }, [step]);

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

  const particleData = useMemo(() => buildParticles(frameRef.current), [tick]);

  const meanPbl = gridCells.length > 0
    ? gridCells.reduce((s, c) => s + c.pbl, 0) / gridCells.length
    : 500;

  const pblRing = useMemo(() => {
    const pbl = Math.max(50, meanPbl);
    const cx = 77.20, cy = 28.59;
    const scale = 0.06 + pbl / 12000;
    return Array.from({ length: 60 }, (_, i) => {
      const rad = (i / 60) * Math.PI * 2;
      return { position: [cx + scale * Math.cos(rad) * 1.3, cy + scale * Math.sin(rad)] };
    });
  }, [meanPbl]);

  const deckLayers = [
    // 0. Base Map (Satellite Tiles mapped onto Globe)
    new TileLayer({
      id: 'satellite-tiles',
      data: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      maxCacheSize: 500,
      renderSubLayers: props => {
        const { boundingBox } = props.tile;
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
        });
      }
    }),

    // 0.5. Base Map Labels (Places, boundaries)
    new TileLayer({
      id: 'label-tiles',
      data: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png',
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      maxCacheSize: 500,
      renderSubLayers: props => {
        const { boundingBox } = props.tile;
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
        });
      }
    }),

    new ScenegraphLayer({
      id: 'orbiting-satellite',
      data: [{ position: satPosition, orientation: [0, 0, 90] }],
      scenegraph: '/satellite.glb',
      getPosition: d => d.position,
      getOrientation: d => d.orientation,
      sizeScale: 150000, 
      _lighting: 'pbr',
      pickable: false
    }),

    isScanning && new ScatterplotLayer({
      id: 'radar-scan-sweep',
      data: [DELHI_COORDS],
      pickable: false,
      opacity: 1 - scanPulse,
      stroked: true,
      filled: true,
      radiusScale: scanPulse * 150000,
      radiusMinPixels: 1,
      radiusMaxPixels: 1000,
      lineWidthMinPixels: 3,
      getPosition: d => [d.lng, d.lat, 100],
      getFillColor: [56, 189, 248, 40],
      getLineColor: [56, 189, 248, 255],
      getRadius: 1,
    }),

    // 1. PM2.5 heatmap columns (Only reveal if not diving/chasing)
    heatmap && (scanPhase === 'IDLE' || scanPhase === 'RESOLVED') && gridCells.length > 0 && new ColumnLayer({
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
      fontFamily: 'monospace',
      outlineWidth: 3,
      outlineColor: [0, 0, 0, 255],
      background: true,
      backgroundPadding: [3, 2],
      getBackgroundColor: [8, 14, 30, 200],
    }),

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

  const getTooltip = ({ object }) => {
    if (!object) return null;
    if (object.name) {
      return {
        html: `<div style="font:10px monospace;background:#0D1424;border:1px solid #1E2D4A;padding:6px 10px;border-radius:4px">
          <b style="color:#E2E8F0">${object.name}</b><br/>CPCB Station
        </div>`,
        style: { background: 'none', border: 'none', padding: 0 },
      };
    }
    if (object.pm25 !== undefined) {
      return {
        html: `<div style="font:10px monospace;background:#0D1424;border:1px solid #1E2D4A;padding:4px 8px;border-radius:4px">
          PM2.5: <b style="color:#EF4444">${Math.round(object.pm25)} µg/m³</b><br/>
          PBL: <b style="color:#818CF8">${object.pbl ? Math.round(object.pbl) + ' m' : '—'}</b>
        </div>`,
        style: { background: 'none', border: 'none', padding: 0 },
      };
    }
    return null;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#020617' }}>
      
      <DeckGL
        views={new GlobeView()}
        viewState={viewState}
        onViewStateChange={e => setViewState(e.viewState)}
        controller={{ scrollZoom: true, dragPan: true, dragRotate: true, doubleClickZoom: true }}
        layers={deckLayers}
        effects={[LIGHTING]}
        getTooltip={getTooltip}
        parameters={{
          cull: true,
          clearColor: [2, 6, 23, 255] // Dark space background (#020617)
        }}
      />

      {/* Cinematic HUD Overlay */}
      {scanPhase !== 'IDLE' && (
        <div style={{
          position: 'absolute', top: '120px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, padding: '16px 32px', borderRadius: '8px',
          background: 'rgba(13, 20, 36, 0.65)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: scanPhase === 'RESOLVED' ? '#4ade80' : '#f87171',
          fontFamily: 'monospace', letterSpacing: '0.1em', textAlign: 'center',
          animation: scanPhase === 'CHASE' ? 'pulse 1s infinite alternate' : 'none'
        }}>
          {scanPhase === 'CHASE' || scanPhase === 'DIVING' ? (
            <>
              <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>⌖ [INSAT-3D IMAGER ACTIVE]</div>
              <div>ACQUIRING AEROSOL OPTICAL DEPTH (650nm)</div>
            </>
          ) : (
            <div style={{ fontWeight: 'bold' }}>LOCAL FORECAST COUPLED</div>
          )}
        </div>
      )}

      {/* Cinematic UI Controls */}
      <div style={{ position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
        <button 
          onClick={handleScanNcr}
          style={{
            padding: '16px 32px',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.5)',
            color: '#38bdf8',
            fontSize: '14px',
            fontFamily: 'monospace',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            borderRadius: '4px',
            boxShadow: '0 0 20px rgba(56, 189, 248, 0.2)',
            transition: 'all 0.2s ease-in-out'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.25)';
            e.currentTarget.style.boxShadow = '0 0 30px rgba(56, 189, 248, 0.4)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.15)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.2)';
          }}
        >
          Scan NCR
        </button>
      </div>

    </div>
  );
}
