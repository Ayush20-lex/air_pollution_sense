/**
 * Meteorology source client.
 *
 * Two endpoints serve the same contract, and this asks for the live one first.
 *
 * `/api/v1/met/live` fetches NCEP GFS from Open-Meteo per request, so it cannot
 * go stale. `/api/v1/met/gfs` reads the NCR-clipped extract the partner pipeline
 * commits, which can and does: as this was rewritten it was 299.6 hours old with
 * its whole window in the past, and the panel hides itself when expired - so the
 * meteorology section was simply absent from the dashboard, with a working
 * keyless live source of the same model unused in the repository.
 *
 * The fallback is kept rather than replaced. The parquet is what the partner
 * owns, and if Open-Meteo is unreachable an aging file is still better than an
 * empty panel.
 *
 * The original note, still true of the parquet path: the extract expires. It carries a
 * 72-hour window from a fixed cycle, and once that window has passed the file
 * is a record of weather that already happened.
 *
 * The backend computes this and says so plainly - `status`, `cycle_age_hours`,
 * `hours_remaining` and a note. Right now it reads "expired", 104 hours old
 * with the whole window in the past, and nobody looking at the dashboard could
 * have known. A met source that has gone stale is exactly the kind of thing a
 * page should surface rather than quietly keep drawing from.
 *
 * This is a read-only side channel: it feeds no forecast. The blend baseline is
 * validated at 62.23 without it, and wiring it into the forecast would
 * invalidate that number. So the panel reports the file's health and does not
 * imply the forecast depends on it.
 */

/** Same contract as the other clients - see forecastApi's note. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type GfsFreshness = {
  status: 'fresh' | 'aging' | 'stale' | 'expired' | string;
  cycle_init: string | null;
  cycle_age_hours: number | null;
  hours_remaining: number | null;
  expired: boolean;
  evaluated_at: string;
  note?: string;
};

export type GfsField = {
  unit: string;
  rows: number;
  rows_flagged: number;
  rows_imputed: number;
  rows_no_window?: number;
};

export type GfsPayload = {
  source: string;
  export: string;
  via?: string;
  resolution_deg?: number;
  grid_points: number;
  cycles: string[];
  is_synthetic: boolean;
  first_valid: string;
  last_valid: string;
  steps: number;
  fields: Record<string, GfsField>;
  fields_absent: string[];
  freshness: GfsFreshness;
};

/** Live first, the committed extract second. Both return the same shape. */
const MET_ENDPOINTS = ['/api/v1/met/live', '/api/v1/met/gfs'] as const;

async function fetchMet(path: string, timeoutMs: number): Promise<GfsPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    // 204 is the documented "nothing to serve" for both, and `res.ok` is true
    // for it - so the freshness check below, not the status, is what decides.
    if (!res.ok) return null;
    const data = (await res.json()) as GfsPayload;
    return data?.freshness ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGfs(timeoutMs = 12000): Promise<GfsPayload | null> {
  // Sequential on purpose. Asking both at once would spend a request on the
  // parquet almost every time, and the budget is shared with the station mesh.
  for (const path of MET_ENDPOINTS) {
    const data = await fetchMet(path, timeoutMs);
    if (data) return data;
  }
  return null;
}

/**
 * What to call each source in the subtitle.
 *
 * Keyed on the payload's own `source`, so a panel drawing the parquet never
 * claims to be live and one drawing Open-Meteo never claims to be the partner's
 * file. The fallback covers a source this build has not been told about.
 */
export const MET_SOURCE: Record<string, string> = {
  open_meteo: 'NCEP GFS via Open-Meteo, fetched live over the NCR domain',
  noaa_gfs: 'NOAA GFS, clipped to the NCR domain by the partner pipeline',
};

/**
 * How to paint each state.
 *
 * NCEP issues GFS four times a day, so "aging" after six hours is normal and
 * not a fault - only `expired` means the file can no longer describe anything
 * ahead of now.
 */
export const GFS_STATUS: Record<string, { color: string; means: string }> = {
  // "Current" rather than "Current cycle": a live fetch has no cycle id, and
  // the word was reading as a claim about a file that was not there.
  fresh: { color: '#22c55e', means: 'Current' },
  aging: { color: '#84cc16', means: 'A newer cycle exists upstream' },
  stale: { color: '#eab308', means: 'More than a day old' },
  expired: { color: '#ef4444', means: 'Its whole window is in the past' },
};
