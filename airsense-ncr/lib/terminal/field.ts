/**
 * Hourly field engine for the public terminal map.
 *
 * Same contract as `lib/data` on the console side — deterministic, no
 * `Math.random`, so server and client renders agree and the timeline scrubs
 * reproducibly. The difference is the source: the console synthesises a
 * WRF-Chem style field from five districts, this interpolates the 26 real
 * monitoring nodes.
 *
 *   nocturnal PBL collapse  ->  smaller ventilation volume  ->  higher load
 *   afternoon mixing        ->  deeper layer                ->  lower load
 */
import { alertForAqi, type TerminalAlert } from './bands';
import type { GridPoint, ScalarGrid } from './contours';
import { NCR_BOUNDS, STATIONS } from './stations';

/** Cells per side of the nested grid. */
export const GRID = 18;
export const FRAME_COUNT = 24;

export type NodeSample = {
  pm25: number;
  aqi: number;
  pbl: number;
  windSpeed: number;
  o3: number;
  nox: number;
  alert: TerminalAlert;
};

export type TerminalFrame = {
  /** Hours relative to now: -23 … 0. */
  offset: number;
  /** Local IST hour of the frame, 0-23. */
  localHour: number;
  /** Short date label, e.g. "12 Sep". */
  label: string;
  /** Keyed by station id. */
  nodes: Record<string, NodeSample>;
};

/** Diurnal multiplier — peaks before dawn, troughs mid-afternoon. */
function diurnal(hour: number): number {
  return 1 + 0.32 * Math.cos(((hour - 7) / 24) * 2 * Math.PI);
}

/** Boundary-layer height in metres for a given local hour. */
function pblHeight(hour: number): number {
  return 240 + 760 * Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
}

/**
 * Build the 24 hourly frames ending at `now`.
 *
 * Pass a fixed `now` from the caller to keep a render deterministic; the page
 * builds frames once on mount so the clock ticking does not rebuild the field.
 */
export function buildFrames(now: Date = new Date()): TerminalFrame[] {
  const frames: TerminalFrame[] = [];

  for (let f = 0; f < FRAME_COUNT; f++) {
    const t = new Date(now.getTime() - (FRAME_COUNT - 1 - f) * 3600_000);
    // IST is UTC+5:30; the half hour does not change which hour bucket we are in.
    const localHour = (t.getUTCHours() + 5) % 24;
    const dial = diurnal(localHour);
    const pblBase = pblHeight(localHour);
    const mixing = Math.max(0, Math.sin(((localHour - 8) / 12) * Math.PI));

    const nodes: Record<string, NodeSample> = {};
    STATIONS.forEach((st, idx) => {
      // Small per-node phase offset so the mesh does not breathe in unison.
      const jitter = 1 + 0.06 * Math.sin(f * 0.7 + idx * 1.3);
      const aqi = st.aqi * dial * jitter;
      nodes[st.id] = {
        pm25: st.aqi * 0.48 * dial * jitter,
        aqi: Math.round(aqi),
        pbl: Math.round(pblBase * (0.85 + 0.3 * ((idx % 5) / 5))),
        windSpeed: 1.1 + 3.4 * Math.max(0, Math.sin(((localHour - 8) / 14) * Math.PI)) + (idx % 3) * 0.25,
        o3: 18 + 74 * mixing + (idx % 4) * 4,
        nox: st.aqi * 0.34 * (1.25 - 0.4 * mixing),
        alert: alertForAqi(st.aqi),
      };
    });

    frames.push({
      offset: f - (FRAME_COUNT - 1),
      localHour,
      label: t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      nodes,
    });
  }

  return frames;
}

export type FieldCell = { lat: number; lng: number; value: number };

/**
 * Inverse-distance interpolation of node PM2.5 over the nested grid.
 *
 * `smooth` lowers the distance power, which widens the hot core — the plume
 * envelope uses it so its contours sit outside the concentration peaks.
 */
export function plumeField(frame: TerminalFrame, smooth = false): FieldCell[] {
  const cells: FieldCell[] = [];
  const dLat = (NCR_BOUNDS.north - NCR_BOUNDS.south) / GRID;
  const dLng = (NCR_BOUNDS.east - NCR_BOUNDS.west) / GRID;
  const power = smooth ? 1.6 : 2.4;

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const lat = NCR_BOUNDS.south + (i + 0.5) * dLat;
      const lng = NCR_BOUNDS.west + (j + 0.5) * dLng;

      let num = 0;
      let den = 0;
      for (const st of STATIONS) {
        const d2 = (st.lat - lat) ** 2 + (st.lng - lng) ** 2;
        // The epsilon keeps a cell that lands on a station from dividing by zero.
        const w = 1 / Math.pow(d2 + 0.0004, power / 2);
        num += w * frame.nodes[st.id].pm25;
        den += w;
      }
      cells.push({ lat, lng, value: den ? num / den : 0 });
    }
  }
  return cells;
}

/*
 * The 7x7 barb lattice that used to live here was replaced by the structured
 * field and streamline integrator in `./wind`. The console's own `windField`
 * in `lib/data.ts` is a separate thing and is untouched.
 */

/** Deterministic sparkline series for a node, ending at its current value. */
export function nodeSeries(seed: number, aqi: number, points = 8): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < points; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(aqi - 26 + (s / 233280) * 34 + i * 1.4);
  }
  return out;
}

/** Dispersion diagnostics shown beside the map. */
export const DISPERSION = {
  windSpeed: 11.2,
  windDir: 'NW',
  boundaryLayer: 412,
  dispersionIndex: 0.38,
  dispersionLabel: 'POOR',
  inversionRisk: 'HIGH',
  bowlRetentionDays: 3.4,
  driftSpeed: 3.1,
  driftDir: 'SE',
  ventilationIndex: 1840,
} as const;


/**
 * PM2.5 field on an arbitrary-resolution grid, in µg/m³ rather than normalised
 * units, so iso-contours can be drawn at real CPCB breakpoints.
 *
 * `plumeField` returns cell centres for the old 18x18 raster; contours need a
 * denser lattice sampled at grid *nodes*, hence the separate builder.
 */
export function pm25Grid(frame: TerminalFrame, n = 48): ScalarGrid {
  const values: number[] = new Array(n * n);
  const latSpan = NCR_BOUNDS.north - NCR_BOUNDS.south;
  const lngSpan = NCR_BOUNDS.east - NCR_BOUNDS.west;

  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const lat = NCR_BOUNDS.north - (gy / (n - 1)) * latSpan;
      const lng = NCR_BOUNDS.west + (gx / (n - 1)) * lngSpan;

      let num = 0;
      let den = 0;
      for (const st of STATIONS) {
        const d2 = (st.lat - lat) ** 2 + (st.lng - lng) ** 2;
        const w = 1 / Math.pow(d2 + 0.0006, 1.1);
        num += w * frame.nodes[st.id].pm25;
        den += w;
      }
      values[gy * n + gx] = den ? num / den : 0;
    }
  }

  return { w: n, h: n, values };
}

/** Grid space -> map space, matching the lattice `pm25Grid` builds. */
export function gridToLatLng(n: number, [gx, gy]: GridPoint): [number, number] {
  const latSpan = NCR_BOUNDS.north - NCR_BOUNDS.south;
  const lngSpan = NCR_BOUNDS.east - NCR_BOUNDS.west;
  return [
    NCR_BOUNDS.north - (gy / (n - 1)) * latSpan,
    NCR_BOUNDS.west + (gx / (n - 1)) * lngSpan,
  ];
}

/**
 * PM2.5 iso-levels, µg/m³.
 *
 * Chosen to sit inside the field's actual diurnal range (~33 at the afternoon
 * minimum to ~106 at the pre-dawn peak), so at least one contour is drawn at
 * every hour. 60 and 90 are the CPCB satisfactory/moderate and moderate/poor
 * boundaries; 45 is the mid-line that keeps the afternoon readable. Levels
 * outside the range draw nothing at all — 30 is below the whole domain and 120
 * above it.
 */
export const CONTOUR_LEVELS = [
  { value: 45, label: '45', color: '#facc15', dash: '6 6' as string | null, weight: 1.1 },
  { value: 60, label: '60', color: '#f97316', dash: null as string | null, weight: 1.4 },
  { value: 90, label: '90', color: '#ef4444', dash: null as string | null, weight: 1.8 },
];
