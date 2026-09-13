/**
 * Low-level wind field and streamline integration.
 *
 * The old field was `dir = 315 + 16 * sin(...)` on a 7x7 lattice — every vector
 * pointing north-west inside a ±16° band. With no convergence, no channelling
 * and no calm, any renderer drawn on top of it reads as wallpaper. This builds
 * a field with the structure the rest of the page already asserts:
 *
 *   prevailing NW synoptic flow
 *     + deflection along the Aravalli (SW) and Himalayan (NE) barriers
 *     + convergence into the basin, strengthening as the mixing layer collapses
 *     = air that streams by day and stalls into the bowl at night
 *
 * Kept free of React and Leaflet so the vector maths can be tested on its own.
 */
import { NCR_BOUNDS } from './stations';

export type WindVec = {
  /** Eastward component. */
  u: number;
  /** Northward component. */
  v: number;
  /** Magnitude, m/s. */
  speed: number;
};

export type WindContext = {
  /** 0 = deep, well-mixed afternoon layer; 1 = collapsed nocturnal layer. */
  stagnation: number;
  /** Domain-mean wind speed, m/s. */
  meanSpeed: number;
};

/** Longitude degrees are shorter than latitude degrees at this latitude. */
const LNG_SCALE = Math.cos((28.6 * Math.PI) / 180);

/** Centre of the basin — where the bowl traps what the barriers deflect. */
const BASIN: [number, number] = [28.62, 77.18];

/**
 * Barrier ridges as line segments, with the falloff distance over which they
 * bend the flow. Positions follow the Trapping Profile card's geography.
 */
const RIDGES: { a: [number, number]; b: [number, number]; sigma: number }[] = [
  // Aravalli, running SW -> NE through Gurugram toward the Delhi ridge.
  { a: [28.3, 76.88], b: [28.66, 77.22], sigma: 0.13 },
  // Himalayan foothills, far north-east.
  { a: [28.82, 77.34], b: [29.06, 77.78], sigma: 0.15 },
];

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** Perpendicular distance to a segment, plus its unit tangent. */
function ridgeGeometry(lat: number, lng: number, a: [number, number], b: [number, number]) {
  const ax = a[1] * LNG_SCALE;
  const ay = a[0];
  const bx = b[1] * LNG_SCALE;
  const by = b[0];
  const px = lng * LNG_SCALE;
  const py = lat;

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;

  const t = clamp01(((px - ax) * tx + (py - ay) * ty) / len);
  const cx = ax + dx * t;
  const cy = ay + dy * t;

  return { distance: Math.hypot(px - cx, py - cy), tx, ty };
}

/** Context for one frame: how stagnant the column is, and how fast it moves. */
export function buildWindContext(samples: { pbl: number; windSpeed: number }[]): WindContext {
  if (!samples.length) return { stagnation: 0.5, meanSpeed: 2 };
  const meanPbl = samples.reduce((s, x) => s + x.pbl, 0) / samples.length;
  const meanSpeed = samples.reduce((s, x) => s + x.windSpeed, 0) / samples.length;
  // A 900 m layer ventilates freely; 250 m is the nocturnal trap.
  return { stagnation: clamp01(1 - meanPbl / 900), meanSpeed };
}

/** The wind vector at a point. */
export function windAt(lat: number, lng: number, ctx: WindContext): WindVec {
  // --- prevailing synoptic flow: from the NW, so blowing toward the SE ---
  let u = 0.7071;
  let v = -0.7071;

  // --- barrier channelling: flow turns to run along a ridge it approaches ---
  let blocked = 0;
  for (const ridge of RIDGES) {
    const { distance, tx, ty } = ridgeGeometry(lat, lng, ridge.a, ridge.b);
    const w = Math.exp(-((distance / ridge.sigma) ** 2));
    if (w < 0.01) continue;
    blocked = Math.max(blocked, w);
    // Push toward whichever way along the ridge the synoptic flow already goes.
    const along = u * tx + v * ty >= 0 ? 1 : -1;
    u += tx * along * w * 1.15;
    v += ty * along * w * 1.15;
  }

  // --- basin convergence: air drawn inward, strongly when the lid is low ---
  const dLat = BASIN[0] - lat;
  const dLng = (BASIN[1] - lng) * LNG_SCALE;
  const dist = Math.hypot(dLat, dLng) || 1e-6;
  const pull = Math.exp(-((dist / 0.34) ** 2)) * ctx.stagnation * 1.25;
  u += (dLng / dist) * pull;
  v += (dLat / dist) * pull;

  // --- magnitude: ventilated by day, stalled by night and beside barriers ---
  const mag = Math.hypot(u, v) || 1;
  const ventilation = 0.4 + 0.85 * (1 - ctx.stagnation);
  const shelter = 1 - blocked * 0.4;
  const calm = 1 - Math.exp(-((dist / 0.3) ** 2)) * ctx.stagnation * 0.45;
  const speed = ctx.meanSpeed * ventilation * shelter * calm;

  return { u: (u / mag) * speed, v: (v / mag) * speed, speed };
}

/** Meteorological direction the wind blows *from*, degrees. */
export function windFromDegrees({ u, v }: WindVec): number {
  return (Math.atan2(-u, -v) * 180) / Math.PI + 180;
}

export type StreamOptions = {
  /** Seed lattice resolution. */
  seeds?: number;
  /** Integration step, degrees of latitude. */
  step?: number;
  /** Maximum steps in each direction from a seed. */
  maxSteps?: number;
  /** Occupancy grid resolution — controls how evenly lines are spaced. */
  spacing?: number;
  /** Reject streamlines shorter than this many points. */
  minPoints?: number;
};

/**
 * Evenly-spaced streamlines, after Jobard & Lefer.
 *
 * Seeds are walked in a deterministic scrambled order; a candidate is skipped
 * if its cell is already taken, and integration stops on entering an occupied
 * cell. That prevents the bunching that makes naive streamline plots unreadable
 * without needing any randomness.
 */
export function streamlines(ctx: WindContext, opts: StreamOptions = {}): [number, number][][] {
  const seeds = opts.seeds ?? 26;
  const step = opts.step ?? 0.012;
  const maxSteps = opts.maxSteps ?? 90;
  const spacing = opts.spacing ?? 46;
  const minPoints = opts.minPoints ?? 10;

  const latSpan = NCR_BOUNDS.north - NCR_BOUNDS.south;
  const lngSpan = NCR_BOUNDS.east - NCR_BOUNDS.west;
  const occupied = new Uint8Array(spacing * spacing);

  const cellOf = (lat: number, lng: number) => {
    const gx = Math.floor(((lng - NCR_BOUNDS.west) / lngSpan) * spacing);
    const gy = Math.floor(((NCR_BOUNDS.north - lat) / latSpan) * spacing);
    if (gx < 0 || gy < 0 || gx >= spacing || gy >= spacing) return -1;
    return gy * spacing + gx;
  };

  const inside = (lat: number, lng: number) =>
    lat >= NCR_BOUNDS.south &&
    lat <= NCR_BOUNDS.north &&
    lng >= NCR_BOUNDS.west &&
    lng <= NCR_BOUNDS.east;

  /** RK2 midpoint, on the normalised direction so spacing stays uniform. */
  const advance = (lat: number, lng: number, sign: number): [number, number] | null => {
    const k1 = windAt(lat, lng, ctx);
    const m1 = Math.hypot(k1.u, k1.v);
    if (m1 < 1e-6) return null;
    const midLat = lat + ((sign * step) / 2) * (k1.v / m1);
    const midLng = lng + ((sign * step) / 2) * (k1.u / m1) / LNG_SCALE;

    const k2 = windAt(midLat, midLng, ctx);
    const m2 = Math.hypot(k2.u, k2.v);
    if (m2 < 1e-6) return null;
    return [lat + sign * step * (k2.v / m2), lng + (sign * step * (k2.u / m2)) / LNG_SCALE];
  };

  // Deterministic scramble: a coprime stride walks every seed in a scattered
  // order, so early streamlines are spread over the domain rather than a corner.
  const total = seeds * seeds;
  const stride = 619;
  const paths: [number, number][][] = [];

  for (let n = 0; n < total; n++) {
    const idx = (n * stride) % total;
    const sy = Math.floor(idx / seeds);
    const sx = idx % seeds;

    // Half-cell offset, with a deterministic jitter so seeds are not collinear.
    const jx = ((idx * 37) % 13) / 13 - 0.5;
    const jy = ((idx * 71) % 17) / 17 - 0.5;
    const lat = NCR_BOUNDS.north - ((sy + 0.5 + jy * 0.6) / seeds) * latSpan;
    const lng = NCR_BOUNDS.west + ((sx + 0.5 + jx * 0.6) / seeds) * lngSpan;

    const startCell = cellOf(lat, lng);
    if (startCell < 0 || occupied[startCell]) continue;

    const forward: [number, number][] = [];
    const backward: [number, number][] = [];

    for (const [sign, out] of [
      [1, forward],
      [-1, backward],
    ] as const) {
      let p: [number, number] = [lat, lng];
      for (let s = 0; s < maxSteps; s++) {
        const next = advance(p[0], p[1], sign);
        if (!next || !inside(next[0], next[1])) break;
        const cell = cellOf(next[0], next[1]);
        if (cell < 0) break;
        // Running into another streamline's territory ends this one.
        if (occupied[cell] && cell !== startCell) break;
        out.push(next);
        p = next;
      }
    }

    const path: [number, number][] = [...backward.reverse(), [lat, lng], ...forward];
    if (path.length < minPoints) continue;

    for (const [plat, plng] of path) {
      const cell = cellOf(plat, plng);
      if (cell >= 0) occupied[cell] = 1;
    }
    paths.push(path);
  }

  return paths;
}
