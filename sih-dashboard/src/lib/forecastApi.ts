/**
 * Live forecast client.
 *
 * `buildForecast()` in lib/data.ts generates the console's `Frame[]`
 * synthetically. This fetches the same shape from the backend instead, which
 * serves it from `/api/v1/forecast/frames`.
 *
 * The synthetic generator is deliberately kept rather than replaced. It is the
 * offline fallback when the backend is down, and it still drives the what-if
 * simulator — the backend has no policy-intervention model, so scenario deltas
 * are computed from the synthetic physics and applied to the live baseline
 * (see applyInterventionRatio).
 */
import type { Frame, Interventions } from '@/lib/data';
import { buildForecast, DEFAULT_INTERVENTIONS } from '@/lib/data';
import { alertLevel, pm25ToAqi } from '@/lib/aqi';

/**
 * Where the API lives. Empty means same-origin, which is the deployed case.
 *
 * The backend runs on a plain-HTTP host and the dashboard is served over
 * HTTPS, so the browser blocks the call as mixed content before it is ever
 * sent - no request, no CORS exchange, nothing in the network tab to explain
 * it, just a red badge. Pointing VITE_API_BASE straight at http://<ip>:8000
 * cannot work from an HTTPS page however correct the URL is.
 *
 * So the deployed build calls itself and vercel.json rewrites /api/* to the
 * host server-side, where plain HTTP is fine. `?? ''` rather than `??
 * 'http://localhost:8000'`: an unset variable now means same-origin instead of
 * pointing every visitor's browser at port 8000 on their own machine, which is
 * what the last deploy actually did. Local development sets it explicitly.
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** What produced the numbers currently on screen. */
export type ForecastSource = {
  engine: 'coupled_model' | 'blend_baseline' | 'untrained_model';
  is_synthetic: boolean;
  method?: string;
  mode?: string;
  origin?: string;
  validated_rmse_ugm3?: number;
  beats_raw_cams_by?: string;
  stations?: number;
  real_channels?: number[];
  synthetic_channels?: number[];
  /**
   * What each of the 72 leads was built from, in order. A lead with a measured
   * day behind it is the validated blend; past the observations there is no
   * diurnal parent and CAMS runs alone, at a different and larger error. One
   * figure over the whole horizon would be claiming the better of the two for
   * hours that never earned it.
   */
  lead_methods?: ('blend' | 'blend_live' | 'cams_only')[];
  lead_rmse_ugm3?: number[];
  blend_leads?: number;
  cams_only_leads?: number;
  rmse_by_method?: Record<string, number>;
  /**
   * Real VIIRS fire pixels over the Punjab/Haryana corridor for this origin,
   * and what share of the forecast PM2.5 their smoke accounts for. The map's
   * stubble ribbon is drawn from this instead of from a literal.
   */
  fire?: {
    fires?: number;
    smoke_share_pct?: number;
    centroid_lat?: number;
    centroid_lon?: number;
    season?: string;
    status?: string;
  };
};

export type LiveForecast = { frames: Frame[]; source: ForecastSource };

/**
 * Fetch the live 72-hour forecast. Returns null rather than throwing when the
 * backend is unreachable — the caller keeps the synthetic frames and the
 * console stays usable offline.
 */
export async function fetchLiveForecast(timeoutMs = 8000): Promise<LiveForecast | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/forecast/frames`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      // A 200 has to mean the server answered, not that the browser still had
      // a copy. The backend sets no Cache-Control, which leaves the response
      // open to heuristic caching here and to any proxy in between; a hit then
      // resolves instantly and indistinguishably from a healthy fetch, and the
      // provenance badge goes green over a body of unknown age. Bypassing the
      // cache costs one request and makes success mean what it claims.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LiveForecast;
    if (!Array.isArray(data?.frames) || data.frames.length === 0) return null;
    return data;
  } catch {
    // Offline, CORS-blocked, or timed out. The synthetic forecast stands in.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Apply a what-if scenario to live frames.
 *
 * The backend forecast has no notion of policy levers, so the effect is taken
 * from the synthetic model — the ratio between a scenario run and the baseline
 * run — and multiplied onto the live values. The shape of the intervention
 * comes from the project's emission mix; only its magnitude rides on real data.
 */
export function applyInterventionRatio(live: Frame[], iv: Interventions): Frame[] {
  const base = buildForecast(DEFAULT_INTERVENTIONS);
  const scen = buildForecast(iv);

  return live.map((frame, i) => {
    const b = base[i];
    const s = scen[i];
    if (!b || !s) return frame;

    const districts: Frame['districts'] = {};
    let pmSum = 0;
    let n = 0;

    for (const [id, cell] of Object.entries(frame.districts)) {
      const bd = b.districts[id];
      const sd = s.districts[id];
      const ratio = bd && sd && bd.pm25 > 0 ? sd.pm25 / bd.pm25 : 1;
      const pm25 = cell.pm25 * ratio;
      // AQI and the alert badge are derived from PM2.5, so they have to move
      // with it — otherwise a scenario shows cleaner air under an unchanged
      // EMERGENCY badge.
      districts[id] = {
        ...cell,
        pm25: Math.round(pm25 * 10) / 10,
        aqi: pm25ToAqi(pm25),
        alert: alertLevel(pm25, cell.inversion),
      };
      pmSum += pm25;
      n += 1;
    }

    const avgPm25 = n > 0 ? pmSum / n : frame.avgPm25;
    return {
      ...frame,
      districts,
      avgPm25: Math.round(avgPm25 * 10) / 10,
      avgAqi: pm25ToAqi(avgPm25),
      alert: alertLevel(avgPm25, frame.inversionIndex),
    };
  });
}
