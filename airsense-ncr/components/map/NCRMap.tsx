'use client';

import * as React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Rectangle, TileLayer, Tooltip as LTooltip, useMap } from 'react-leaflet';
import { useTheme } from 'next-themes';
import { aqiColor, bandForPm25, ALERT_COLOR } from '@/lib/aqi';
import {
  DISTRICTS,
  NCR_BOUNDS,
  plumeField,
  windField,
  type Frame,
  type Pollutant,
} from '@/lib/data';
import { SEVERITY as S } from '@/lib/tokens';
import { useAppStore } from '@/store/useAppStore';

const CENTER: [number, number] = [28.6, 77.21];

// Keyless OSM raster tiles; the dark treatment is a CSS filter on the tile
// pane (see globals.css) rather than a second, API-keyed tile provider.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const ATTRIB =
  '&copy; OpenStreetMap contributors &middot; synthetic WRF-Chem field';

/** Colour ramp for a value of the currently selected pollutant. */
function layerColor(value: number, pollutant: Pollutant) {
  switch (pollutant) {
    case 'PBL':
      return value > 900 ? S.good : value > 500 ? S.moderate : value > 250 ? S.poor : S.bad;
    case 'O3':
      return value > 120 ? S.bad : value > 80 ? S.poor : value > 45 ? S.moderate : S.good;
    case 'NOx':
      return value > 140 ? S.severe : value > 90 ? S.bad : value > 55 ? S.poor : S.good;
    case 'WIND':
      return value > 4 ? S.good : value > 2.5 ? S.fair : value > 1.2 ? S.moderate : S.bad;
    default:
      return aqiColor(value);
  }
}

export function NCRMap({ frame }: { frame: Frame }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== 'light';
  const layers = useAppStore((s) => s.layers);
  const pollutant = useAppStore((s) => s.pollutant);
  const selected = useAppStore((s) => s.selectedDistrict);
  const selectDistrict = useAppStore((s) => s.selectDistrict);

  return (
    <MapContainer
      center={CENTER}
      zoom={10}
      minZoom={8}
      maxZoom={13}
      zoomControl={false}
      attributionControl
      preferCanvas
      className="h-full w-full"
      style={{ background: 'transparent' }}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIB} maxZoom={19} />
      <Fitter />
      {layers.heatmap && <HeatField frame={frame} pollutant={pollutant} />}
      {layers.plume && <PlumeContours frame={frame} />}
      {layers.wind && <WindVectors frame={frame} />}
      {layers.pins &&
        DISTRICTS.map((d) => {
          const s = frame.districts[d.id];
          return (
            <Marker
              key={d.id}
              position={[d.lat, d.lng]}
              icon={buildPin(d.name, s.pm25, s.aqi, s.alert, selected === d.id)}
              eventHandlers={{
                click: () => selectDistrict(selected === d.id ? null : d.id),
              }}
            >
              <LTooltip direction="top" offset={[0, -50]} opacity={1} className="as-tip">
                <div style={{ minWidth: 150 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.name}</div>
                  <div>AQI {s.aqi} · {bandForPm25(s.pm25).label}</div>
                  <div>PM2.5 {s.pm25.toFixed(1)} µg/m³</div>
                  <div>PBL {s.pbl} m · {s.windSpeed.toFixed(1)} m/s</div>
                  <div>O₃ {s.o3.toFixed(0)} · NOx {s.nox.toFixed(0)} ppb</div>
                </div>
              </LTooltip>
            </Marker>
          );
        })}
    </MapContainer>
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

/** Raster grid of the selected variable. */
function HeatField({ frame, pollutant }: { frame: Frame; pollutant: Pollutant }) {
  const cells = React.useMemo(() => plumeField(frame), [frame]);
  const dLat = (NCR_BOUNDS.north - NCR_BOUNDS.south) / 18;
  const dLng = (NCR_BOUNDS.east - NCR_BOUNDS.west) / 18;
  const max = Math.max(...cells.map((c) => c.value), 1);

  return (
    <>
      {cells.map((c, i) => {
        const norm = c.value / max;
        if (norm < 0.06) return null;
        // Taper the outer ring of cells so the nested domain does not read as
        // a hard-edged rectangle painted over the basemap.
        const gi = Math.floor(i / 18);
        const gj = i % 18;
        const edge = Math.min(gi, gj, 17 - gi, 17 - gj);
        const taper = Math.min(1, (edge + 0.5) / 3.5);
        const color = layerColor(c.value, pollutant === 'WIND' ? 'PM2.5' : pollutant);
        return (
          <Rectangle
            key={i}
            bounds={[
              [c.lat - dLat / 2, c.lng - dLng / 2],
              [c.lat + dLat / 2, c.lng + dLng / 2],
            ]}
            pathOptions={{
              stroke: false,
              fillColor: color,
              fillOpacity: (0.05 + norm * 0.44) * taper,
            }}
            interactive={false}
          />
        );
      })}
    </>
  );
}

/** Plume dispersion envelope — coarse iso-contours around the hot core. */
function PlumeContours({ frame }: { frame: Frame }) {
  const cells = React.useMemo(() => plumeField(frame, 1), [frame]);
  const max = Math.max(...cells.map((c) => c.value), 1);
  const dLat = (NCR_BOUNDS.north - NCR_BOUNDS.south) / 18;
  const dLng = (NCR_BOUNDS.east - NCR_BOUNDS.west) / 18;

  return (
    <>
      {cells.map((c, i) => {
        const norm = c.value / max;
        if (norm < 0.72) return null;
        return (
          <Rectangle
            key={`p-${i}`}
            bounds={[
              [c.lat - dLat / 2, c.lng - dLng / 2],
              [c.lat + dLat / 2, c.lng + dLng / 2],
            ]}
            pathOptions={{
              color: norm > 0.88 ? S.bad : S.moderate,
              weight: 1,
              opacity: 0.5,
              fill: false,
              dashArray: '3 3',
            }}
            interactive={false}
          />
        );
      })}
    </>
  );
}

/** Wind barb lattice rendered as rotated div icons. */
function WindVectors({ frame }: { frame: Frame }) {
  const vectors = React.useMemo(() => windField(frame), [frame]);
  return (
    <>
      {vectors.map((v, i) => (
        <Marker
          key={`w-${i}`}
          position={[v.lat, v.lng]}
          interactive={false}
          icon={L.divIcon({
            className: 'as-pin-wrap',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            html: `<div style="transform:rotate(${v.dir + 90}deg);opacity:.85">
              <svg width="26" height="26" viewBox="0 0 26 26">
                <path d="M13 4 L13 22 M13 22 L9.5 17 M13 22 L16.5 17"
                  stroke="${layerColor(v.speed, 'WIND')}" stroke-width="1.4"
                  fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg></div>`,
          })}
        />
      ))}
    </>
  );
}

function buildPin(name: string, pm: number, aqi: number, alert: string, selected: boolean) {
  const color = aqiColor(pm);
  const alertColor = ALERT_COLOR[alert as keyof typeof ALERT_COLOR] ?? color;
  const critical = alert === 'EMERGENCY';

  const html = `
    <div class="as-pin" style="--pin:${color};--alert:${alertColor}">
      ${critical ? '<span class="as-pin-ring"></span>' : ''}
      <div class="as-pin-body${selected ? ' as-pin-selected' : ''}">
        <span class="as-pin-aqi">${aqi}</span>
        <span class="as-pin-name">${name}</span>
      </div>
      <span class="as-pin-stem"></span>
    </div>`;

  return L.divIcon({
    className: 'as-pin-wrap',
    iconSize: [86, 48],
    iconAnchor: [43, 48],
    html,
  });
}
