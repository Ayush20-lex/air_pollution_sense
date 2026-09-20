/**
 * Inversion alert client.
 *
 * `/api/v1/alerts/inversion` is the second endpoint that has been serving
 * correctly since the backend existed with nothing in the frontend calling it -
 * and it answers a clause the problem statement names outright: "features that
 * explicitly track atmospheric inversion strength".
 *
 * An inversion is the mechanism behind every bad-air night in Delhi. A shallow
 * layer puts the same emissions into a smaller volume, so the index is not a
 * restatement of the AQI; it is the reason the AQI is about to move.
 */

/** Same contract as the other clients - see forecastApi's note. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type InversionZone = {
  zone_id: string;
  severity: 'MODERATE' | 'SEVERE' | 'EMERGENCY';
  isi_score: number;
  lat_center: number;
  lon_center: number;
  lat_range: [number, number];
  lon_range: [number, number];
  /** Conditions at the zone's worst hour - both read from that same hour. */
  pm25_peak: number;
  pbl_min: number;
  /** When that hour lands, and how far ahead of the forecast origin. */
  peak_at: string;
  lead_hours: number;
  issued_at: string;
  message: string;
};

export async function fetchInversion(timeoutMs = 12000): Promise<InversionZone[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/alerts/inversion`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as InversionZone[];
    // An empty list is a real answer - no zone crossed the threshold - and is
    // not the same as the endpoint being unreachable. Both must be sayable.
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const INVERSION_TIER: Record<string, { color: string; means: string }> = {
  MODERATE: { color: '#eab308', means: 'Elevated risk — worth watching' },
  SEVERE: { color: '#f97316', means: 'Restrict outdoor activity' },
  EMERGENCY: { color: '#ef4444', means: 'Graded-response action required' },
};

/** "in 14h · Sat 05:30" - the lead first, because that is the decision. */
export function whenLabel(z: InversionZone): string {
  const lead = z.lead_hours <= 0 ? 'now' : `in ${z.lead_hours}h`;
  const d = new Date(z.peak_at);
  if (Number.isNaN(d.getTime())) return lead;
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${lead} · ${clock}`;
}
