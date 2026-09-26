/**
 * The model's own forecast field, at the resolution it actually runs at.
 *
 * Every other surface on this page is built from station observations: the
 * heat field blends 70-odd points, the pins are the stations themselves. That
 * is the right way to draw *now*, and it is not the model. The landing page
 * claims a 1 km grid and until this existed nothing on the site could show
 * one - `/api/v1/forecast/grid` served a 10x10 subsample and no client called
 * it at all.
 *
 * `stride=1` returns the full 70x80 field, ~1.1 km a side, 5,600 cells that
 * gzip to about 32 KB. That is the forecast tensor itself, one channel of one
 * hour, rather than an interpolation of anything.
 *
 * Two things a reader has to be told, and the panel tells them. This is a
 * forecast, so at hour zero it is a prediction of now and not a measurement of
 * it. And it carries the run's origin, which on an archive-replay deployment
 * can be days behind the clock - so its absolute values will not match the
 * live pins, and pretending otherwise would put two contradictory truths on
 * one screen.
 */

/** Same contract as the other clients - see forecastApi's note. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type GridCell = { lat: number; lng: number; value: number };

export type ModelGrid = {
  cells: GridCell[];
  /** Distinct rows and columns, for drawing cell rectangles. */
  rows: number;
  cols: number;
  /** When the run that produced this was issued. */
  issuedAt: string | null;
  /** 'live' or 'synthetic', straight from the backend. */
  dataMode: string | null;
  weightsLoaded: boolean | null;
};

type Feature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, number>;
};

/** One request per step, kept for the session: the run does not change under us. */
const cache = new Map<number, ModelGrid | null>();
const inflight = new Map<number, Promise<ModelGrid | null>>();

async function load(step: number, channel: number, timeoutMs: number): Promise<ModelGrid | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/forecast/grid?step=${step}&channels=${channel}&stride=1`,
      { signal: ctrl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Feature[];
      meta?: { issued_at?: string; data_mode?: string; weights_loaded?: boolean };
    };
    const feats = data?.features;
    if (!Array.isArray(feats) || !feats.length) return null;

    const cells: GridCell[] = [];
    const lats = new Set<number>();
    const lngs = new Set<number>();
    for (const f of feats) {
      const [lng, lat] = f.geometry.coordinates;
      // One channel was requested, so take whatever property came back rather
      // than naming it here - the channel index to name mapping lives server
      // side and duplicating it is how the two drift apart.
      const v = Object.values(f.properties ?? {})[0];
      if (typeof v !== 'number') continue;
      cells.push({ lat, lng, value: v });
      lats.add(lat);
      lngs.add(lng);
    }
    if (!cells.length) return null;

    return {
      cells,
      rows: lats.size,
      cols: lngs.size,
      issuedAt: data.meta?.issued_at ?? null,
      dataMode: data.meta?.data_mode ?? null,
      weightsLoaded: data.meta?.weights_loaded ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The grid for one forecast hour. Null while it is loading or if it failed -
 * the caller keeps drawing the observed field rather than an empty map.
 *
 * The timeout is generous on purpose: a cold backend rebuilds the forecast
 * tensor on the first call, which took 22s on the deployed box.
 */
export function fetchModelGrid(
  step: number,
  channel = 0,
  timeoutMs = 45000,
): Promise<ModelGrid | null> {
  if (cache.has(step)) return Promise.resolve(cache.get(step) ?? null);
  const running = inflight.get(step);
  if (running) return running;

  const p = load(step, channel, timeoutMs).then((g) => {
    // A failure is cached as null only for this attempt; drop it from the map
    // so scrubbing back gives it another try rather than a permanent blank.
    if (g) cache.set(step, g);
    inflight.delete(step);
    return g;
  });
  inflight.set(step, p);
  return p;
}
