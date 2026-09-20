/**
 * NOAA GFS client.
 *
 * `/api/v1/met/gfs` reads the NCR-clipped GFS extract the partner pipeline
 * commits, and it has never been called from the page. That left one thing
 * invisible that a reader most needs: the extract expires. It carries a
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

export async function fetchGfs(timeoutMs = 12000): Promise<GfsPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/met/gfs`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GfsPayload;
    return data?.freshness ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How to paint each state.
 *
 * NCEP issues GFS four times a day, so "aging" after six hours is normal and
 * not a fault - only `expired` means the file can no longer describe anything
 * ahead of now.
 */
export const GFS_STATUS: Record<string, { color: string; means: string }> = {
  fresh: { color: '#22c55e', means: 'Current cycle' },
  aging: { color: '#84cc16', means: 'A newer cycle exists upstream' },
  stale: { color: '#eab308', means: 'More than a day old' },
  expired: { color: '#ef4444', means: 'Its whole window is in the past' },
};
