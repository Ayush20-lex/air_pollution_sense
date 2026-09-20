/**
 * The advisory feed, from things that are actually true right now.
 *
 * `INCIDENTS` in ./content is three hand-written scenarios with fixed clock
 * times - "13:42 IST", "22 km² affected", "bowl retention now 3.4 days" - and
 * it is what the sidebar's "3 PENDING" badge counts. That badge is the last
 * fabricated number in the persistent navigation: it says three whatever the
 * air is doing, on every page, including a day when nothing is wrong.
 *
 * Everything needed to replace it is already fetched. The inversion endpoint
 * says where the boundary layer collapses and when, the policy endpoint says
 * which GRAP stage the forecast requires, and the mesh knows how much of itself
 * is reporting. Those are three real sources of "something a reader should know
 * about", and between them they produce zero advisories on a good day - which
 * is the behaviour a feed of hand-written incidents can never have.
 *
 * The inversion zones are summarised into one entry rather than listed. Ten
 * zones crossing a threshold is one fact about the basin, and ten rows saying
 * it would bury the other advisories under the loudest source.
 */
import * as React from 'react';
import { fetchInversion, type InversionZone } from '@/lib/inversionApi';
import { fetchGrap, GRAP_STAGE, type GrapPayload } from '@/lib/grapApi';
import { useMesh } from './useMesh';

export type AdvisoryLevel = 'CRITICAL' | 'WARNING' | 'ADVISORY';

export type Advisory = {
  id: string;
  level: AdvisoryLevel;
  /** IST clock the advisory refers to - a forecast hour, not "now". */
  time: string;
  zone: string;
  text: string;
};

/** Matches the panels so nothing on the page disagrees about the hour. */
const REFRESH_MS = 120_000;

function ist(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d) + ' IST';
}

function inversionAdvisory(zones: InversionZone[]): Advisory | null {
  if (!zones.length) return null;
  // The backend sorts by score, so the first is the worst.
  const worst = zones[0];
  const level: AdvisoryLevel =
    worst.severity === 'EMERGENCY' ? 'CRITICAL'
    : worst.severity === 'SEVERE' ? 'WARNING'
    : 'ADVISORY';
  const soonest = zones.reduce((a, z) => (z.lead_hours < a.lead_hours ? z : a), worst);
  const many = zones.length > 1 ? `${zones.length} zones` : '1 zone';
  return {
    id: 'inversion',
    level,
    time: ist(soonest.peak_at),
    zone: 'REGION-WIDE',
    text:
      `${many} trap below the ventilation threshold — worst at ` +
      `${worst.lat_center.toFixed(2)}°N ${worst.lon_center.toFixed(2)}°E, ` +
      `layer down to ${worst.pbl_min.toFixed(0)} m with PM2.5 near ` +
      `${worst.pm25_peak.toFixed(0)} µg/m³ at that hour`,
  };
}

function grapAdvisory(g: GrapPayload): Advisory | null {
  // Stage 0 is not an advisory. A feed that reports "nothing is required" as an
  // item is a feed that always has something in it.
  if (!g.grap || g.grap.stage <= 0) return null;
  const stage = GRAP_STAGE[g.grap.stage] ?? GRAP_STAGE[0];
  return {
    id: 'grap',
    level: g.grap.stage >= 3 ? 'CRITICAL' : 'WARNING',
    time: ist(g.timestamp),
    zone: 'REGION-WIDE',
    text: `${stage.name} in force — ${stage.means.toLowerCase()}. City AQI ${g.city_aqi} over ${g.window_hours}h across ${g.stations_considered} stations`,
  };
}

/**
 * The advisories a reader should see, newest concern first.
 *
 * Returns an empty list when nothing is wrong, and the callers draw that state
 * rather than padding it.
 */
export function useAdvisories(): { items: Advisory[]; loading: boolean } {
  const mesh = useMesh();
  const [zones, setZones] = React.useState<InversionZone[] | null>(null);
  const [grap, setGrap] = React.useState<GrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const [z, g] = await Promise.all([fetchInversion(), fetchGrap()]);
      if (!alive) return;
      if (z) setZones(z);
      if (g) setGrap(g);
      setLoading(false);
      timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return React.useMemo(() => {
    const items: Advisory[] = [];

    const g = grap ? grapAdvisory(grap) : null;
    if (g) items.push(g);

    const inv = zones ? inversionAdvisory(zones) : null;
    if (inv) items.push(inv);

    // Mesh health is an advisory about the page itself, not about the air, so
    // it sits last and never outranks a reading.
    const notIndexed = mesh.dropped.length + mesh.unindexed.length;
    if (notIndexed > 0) {
      items.push({
        id: 'mesh-coverage',
        level: 'ADVISORY',
        time: mesh.asOf ? ist(mesh.asOf) : '—',
        zone: 'MESH',
        text: `${notIndexed} station${notIndexed === 1 ? '' : 's'} are measuring but cannot be indexed under CPCB's rules — they are excluded from the city figure`,
      });
    }
    if (mesh.status === 'offline') {
      items.push({
        id: 'mesh-offline',
        level: 'WARNING',
        time: mesh.asOf ? ist(mesh.asOf) : '—',
        zone: 'MESH',
        text: 'The station feed is unreachable — readings on this page are the last ones received, not current',
      });
    }

    const rank: Record<AdvisoryLevel, number> = { CRITICAL: 0, WARNING: 1, ADVISORY: 2 };
    items.sort((a, b) => rank[a.level] - rank[b.level]);
    return { items, loading };
  }, [zones, grap, mesh.dropped.length, mesh.unindexed.length, mesh.status, mesh.asOf, loading]);
}
