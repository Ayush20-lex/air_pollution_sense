/**
 * Daily city history from the archive.
 *
 * Two charts wanted this and neither could have it: the 30-day exposure
 * histogram (`EXPOSURE_HISTORY` - 2/6/13/7/2 days by band) and the temporal
 * trend line (`TEMPORAL_TRACE` - twenty-four constants). The archive has held a
 * year of observations the whole time; `/api/v1/history/city` now serves them.
 *
 * A day is the mean across stations of each station's own 24-hour mean, from
 * unfilled observations, and days the network barely reported are excluded by
 * the backend rather than drawn thin. `days_excluded_thin` says how many, so a
 * reader asking for thirty and getting fewer can see why.
 */

/** Same contract as the other clients - see forecastApi's note. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type HistoryDay = {
  date: string;
  pm25: number;
  aqi: number | null;
  band: string | null;
  stations: number;
  /** Share of the day's station-hours actually reported. */
  coverage_pct: number;
};

export type CityHistory = {
  days: HistoryDay[];
  /** Days spent in each CPCB band across the window. */
  band_days: Record<string, number>;
  window_days: number;
  days_excluded_thin: number;
  min_coverage_pct: number;
  season: number;
  index: string;
  note: string;
};

export async function fetchCityHistory(
  days = 30,
  timeoutMs = 15000,
): Promise<CityHistory | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/history/city?days=${days}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CityHistory;
    return Array.isArray(data?.days) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The CPCB bands, in order, with the colours the rest of the page uses. */
export const BAND_ORDER = [
  'Good',
  'Satisfactory',
  'Moderate',
  'Poor',
  'Very Poor',
  'Severe',
] as const;
