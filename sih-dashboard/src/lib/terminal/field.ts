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
import { NCR_BOUNDS, STATIONS, type Station } from './stations';
import { stationPm25, type Pm25Basis } from './pm25Basis';
import { TERM_SEVERITY } from '@/lib/terminal/palette';

/** Cells per side of the nested grid. */
export const GRID = 18;

/**
 * Forecast horizon in hours. 72 is what the rest of the product promises —
 * the entry grid's "72-hour horizon", the model metadata, the intro copy —
 * and this is the surface where that promise is actually walked through.
 */
export const HORIZON_HOURS = 72;

/** NOW, plus one frame per hour out to the horizon. */
export const FRAME_COUNT = HORIZON_HOURS + 1;

export type NodeSample = {
  /**
   * µg/m³. Always a number so the pin and the ramp have something to draw, but
   * only a reading when `pm25Basis` is 'measured' or 'index' - see pm25Basis.ts.
   * On 'none' it is a styling placeholder and must not be displayed or
   * interpolated.
   */
  pm25: number;
  /** How `pm25` was obtained: published concentration, inverted CPCB PM2.5 index, or nothing. */
  pm25Basis: Pm25Basis;
  /** The published CPCB PM2.5 sub-index behind an 'index' reading. */
  pm25SubIndex: number | null;
  aqi: number;
  pbl: number;
  windSpeed: number;
  o3: number;
  nox: number;
  alert: TerminalAlert;
};

export type TerminalFrame = {
  /** Hours ahead of now: 0 … 72. */
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
 * Build the hourly frames from `now` out to the 72-hour horizon.
 *
 * This ran backwards until the map's timeline became a forecast: it built the
 * 24 hours ending at `now`, so the one thing the product claims to do — say
 * where the plume goes next — was the one thing the map could not show.
 *
 * The engine itself is unchanged by the reversal. Each frame is the mesh
 * modulated by the diurnal cycle at that frame's local hour, and that function
 * runs forwards as readily as backwards; only the sign of the step moved.
 *
 * Pass a fixed `now` from the caller to keep a render deterministic; the page
 * builds frames once on mount so the clock ticking does not rebuild the field.
 */
/**
 * @param stations The mesh to run forward. Defaults to the curated list so the
 *   offline page behaves as before; the live mesh carries measured readings,
 *   and hour 0 is then a measurement rather than a starting point.
 */
export function buildFrames(
  now: Date = new Date(),
  stations: Station[] = STATIONS,
): TerminalFrame[] {
  const frames: TerminalFrame[] = [];

  // Hour 0 has to come out as the station's own reading, untouched. The dial
  // and the jitter are a forward model; applying them to the present would
  // hand back a number that is neither the measurement nor a forecast of it,
  // and the map would disagree with the table beside it. Both are therefore
  // expressed relative to their value at hour 0, which cancels there exactly.
  const hour0 = (now.getUTCHours() + 5) % 24;
  const dial0 = diurnal(hour0);

  for (let f = 0; f < FRAME_COUNT; f++) {
    const t = new Date(now.getTime() + f * 3600_000);
    // IST is UTC+5:30; the half hour does not change which hour bucket we are in.
    const localHour = (t.getUTCHours() + 5) % 24;
    const dial = diurnal(localHour);
    const pblBase = pblHeight(localHour);
    const mixing = Math.max(0, Math.sin(((localHour - 8) / 12) * Math.PI));

    const nodes: Record<string, NodeSample> = {};
    stations.forEach((st, idx) => {
      // Small per-node phase offset so the mesh does not breathe in unison.
      const jitter = 1 + 0.06 * Math.sin(f * 0.7 + idx * 1.3);
      const jitter0 = 1 + 0.06 * Math.sin(idx * 1.3);
      const shape = (dial / dial0) * (jitter / jitter0);
      const aqi = st.aqi * shape;
      // The station's own PM2.5: a published concentration, else its published
      // CPCB PM2.5 sub-index inverted exactly. This used to fall back to the
      // *composite* AQI × 0.48, which for 74 of 80 live stations meant a PM2.5
      // figure derived from whichever pollutant was worst - often PM10.
      const own = stationPm25(st as Station & Parameters<typeof stationPm25>[0]);
      // A feed station always carries `subIndices`, even empty; the curated
      // fallback list never does. Only the fallback falls back to the ratio.
      const fromFeed = 'subIndices' in st;
      const basis: Pm25Basis = own.value != null ? own.basis : fromFeed ? 'none' : 'estimate';
      // On 'none' this is a placeholder for styling only: `sampled` keeps the
      // node out of the field and the tooltip says nothing was published.
      const pm0 = own.value ?? st.aqi * 0.48;
      nodes[st.id] = {
        pm25: pm0 * shape,
        pm25Basis: basis,
        pm25SubIndex: own.subIndex,
        aqi: Math.round(aqi),
        pbl: Math.round(pblBase * (0.85 + 0.3 * ((idx % 5) / 5))),
        windSpeed: 1.1 + 3.4 * Math.max(0, Math.sin(((localHour - 8) / 14) * Math.PI)) + (idx % 3) * 0.25,
        o3: 18 + 74 * mixing + (idx % 4) * 4,
        nox: st.aqi * 0.34 * (1.25 - 0.4 * mixing),
        // The frame's own AQI, not the station's base reading. Keyed to the
        // base, every pin held one alert state across the whole window — so
        // scrubbing into a forecast hour at 350 left the map insisting the
        // mesh was calm. The alert is a function of the reading; it has to
        // move when the reading does.
        alert: alertForAqi(Math.round(aqi)),
      };
    });

    frames.push({
      /** Hours ahead of now: 0 … 72. */
      offset: f,
      localHour,
      label: t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      nodes,
    });
  }

  return frames;
}

/**
 * The nodes this frame actually carries, with their coordinates.
 *
 * The frame and the mesh are separate pieces of state and they update one
 * render apart, so a station can exist in the list before it exists in the
 * frame. Reading `frame.nodes[id].pm25` straight off the list threw
 * "Cannot read properties of undefined" for exactly that one render when the
 * measured mesh replaced the curated one. Interpolating over what the frame
 * has is both crash-free and correct: a node with no sample has nothing to
 * contribute to the field.
 */
function sampled(frame: TerminalFrame, stations: Station[]): { st: Station; pm25: number }[] {
  const out: { st: Station; pm25: number }[] = [];
  for (const st of stations) {
    const n = frame.nodes[st.id];
    // A station that publishes no PM2.5 has nothing to contribute to a PM2.5
    // field - its placeholder would be interpolated as if it were a reading.
    if (n && n.pm25Basis !== 'none') out.push({ st, pm25: n.pm25 });
  }
  return out;
}

export type FieldCell = { lat: number; lng: number; value: number };

/**
 * Inverse-distance interpolation of node PM2.5 over the nested grid.
 *
 * `smooth` lowers the distance power, which widens the hot core — the plume
 * envelope uses it so its contours sit outside the concentration peaks.
 */
export function plumeField(
  frame: TerminalFrame,
  smooth = false,
  stations: Station[] = STATIONS,
): FieldCell[] {
  const nodes = sampled(frame, stations);
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
      for (const { st, pm25 } of nodes) {
        const d2 = (st.lat - lat) ** 2 + (st.lng - lng) ** 2;
        // The epsilon keeps a cell that lands on a station from dividing by zero.
        const w = 1 / Math.pow(d2 + 0.0004, power / 2);
        num += w * pm25;
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
export function pm25Grid(
  frame: TerminalFrame,
  n = 48,
  stations: Station[] = STATIONS,
): ScalarGrid {
  const nodes = sampled(frame, stations);
  const values: number[] = new Array(n * n);
  const latSpan = NCR_BOUNDS.north - NCR_BOUNDS.south;
  const lngSpan = NCR_BOUNDS.east - NCR_BOUNDS.west;

  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const lat = NCR_BOUNDS.north - (gy / (n - 1)) * latSpan;
      const lng = NCR_BOUNDS.west + (gx / (n - 1)) * lngSpan;

      let num = 0;
      let den = 0;
      for (const { st, pm25 } of nodes) {
        const d2 = (st.lat - lat) ** 2 + (st.lng - lng) ** 2;
        const w = 1 / Math.pow(d2 + 0.0006, 1.1);
        num += w * pm25;
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
/**
 * Isopleths at CPCB's own PM2.5 category boundaries, in ug/m3.
 *
 * These were 45 / 60 / 90, chosen to sit inside the hand-written mesh, whose
 * PM2.5 worked out around 72. Real measurements are nothing like that range -
 * the archive's late-December field runs 200-300 - so every cell sat above the
 * top level, no isopleth had anything to cross, and the contour layer rendered
 * empty while reporting no error at all.
 *
 * Tying them to the National AQI boundaries fixes that in both directions: a
 * line now means "this is where the air changes category", which is worth
 * drawing whatever the absolute level, and clean and severe days each get
 * isopleths instead of only one of them doing so.
 */
export const CONTOUR_LEVELS = [
  { value: 30, label: '30', color: TERM_SEVERITY.caution, dash: '6 6' as string | null, weight: 1.0 },
  { value: 60, label: '60', color: TERM_SEVERITY.elevated, dash: '6 6' as string | null, weight: 1.2 },
  { value: 90, label: '90', color: TERM_SEVERITY.high, dash: null as string | null, weight: 1.4 },
  { value: 120, label: '120', color: TERM_SEVERITY.highSoft, dash: null as string | null, weight: 1.6 },
  { value: 250, label: '250', color: TERM_SEVERITY.severe, dash: null as string | null, weight: 2.0 },
];
