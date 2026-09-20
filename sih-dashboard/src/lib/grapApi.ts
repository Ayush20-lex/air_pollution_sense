/**
 * GRAP client.
 *
 * `/api/v1/policy/grap` has been built, deployed and served correctly for as
 * long as the backend has existed, and nothing in the frontend called it. It is
 * the one output of this system that tells a reader what to *do* - a public
 * AQI site says what the air is, and this says which stage of the Graded
 * Response Action Plan that puts NCR in - so it was the most valuable thing on
 * the page and it was not on the page.
 *
 * The stage is set from the forecast city AQI: the mean across stations of each
 * station's worst 24-hour mean over the horizon, which is what CAQM actually
 * invokes GRAP on. The worst single station is reported separately and
 * deliberately does not set the stage - one hotspot is not a city.
 */

/** Same contract as forecastApi's API_BASE - see the note there. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type GrapPayload = {
  timestamp: string;
  /** "stations" when station geometry was available, "grid_p95" on fallback. */
  basis: string;
  window_hours: number;
  horizon_hours: number;
  city_pm25_ugm3: number;
  city_aqi: number;
  grap: {
    /** 0 when no emergency measures are active, otherwise 1-4. */
    stage: number;
    category: string;
    actions: string[];
  };
  /** The worst single station. Reported, never stage-setting. */
  hotspot: { station_id: string; pm25_ugm3: number; aqi: number } | null;
  stations_considered: number;
  is_synthetic: boolean;
  /** The backend's own note on how the stage was reached. */
  message?: string;
};

export async function fetchGrap(timeoutMs = 12000): Promise<GrapPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/policy/grap`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      // Same reason as the other two clients: a 200 must mean the server
      // answered, not that the browser still had a copy.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GrapPayload;
    if (!data?.grap || typeof data.grap.stage !== 'number') return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Colour and plain-language urgency per stage.
 *
 * The CAQM stage names are the official ones. The second line is what the
 * stage means for a person reading the page, because "Stage III" on its own
 * tells a Delhi resident nothing they can act on.
 */
export const GRAP_STAGE: Record<
  number,
  { name: string; means: string; color: string }
> = {
  0: { name: 'No stage active', means: 'Routine controls only', color: '#22c55e' },
  1: { name: 'Stage I — Poor', means: 'Dust control, no open burning', color: '#eab308' },
  2: { name: 'Stage II — Very Poor', means: 'Diesel generators restricted, parking charges raised', color: '#f97316' },
  3: { name: 'Stage III — Severe', means: 'Construction halted, BS-III petrol and BS-IV diesel banned', color: '#ef4444' },
  4: { name: 'Stage IV — Severe+', means: 'Trucks stopped, schools and offices may close', color: '#a855f7' },
};
