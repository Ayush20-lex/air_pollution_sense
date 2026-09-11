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

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:8000';

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
