/**
 * Real monitoring mesh client.
 *
 * `STATIONS` in ./stations carries 26 nodes at their true coordinates with
 * readings that were typed by hand — `aqi: 142` was a literal. This replaces
 * those readings with the station's own measurements from `/api/v1/stations`,
 * indexed under the CPCB National AQI.
 *
 * The curated list is kept, not replaced. It still supplies what the archive
 * cannot — the zone grouping the rail is built around, and the upwind source
 * attribution, which is editorial and is labelled as such where it is shown.
 * Everything a viewer would read as a measurement now comes from the backend.
 *
 * Offline, the curated list stands on its own exactly as before, and the page
 * says DEMO. That fallback is why this merges rather than replaces.
 */
import type { Station } from './stations';
import { STATIONS } from './stations';

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:8000';

/** One station as the backend reports it. Shape mirrors station_registry. */
export type MeshStation = {
  id: number;
  name: string;
  full_name: string;
  agency: string;
  zone: string;
  lat: number;
  lon: number;
  pm25: number | null;
  delta_24h_pct: number | null;
  hours_observed: number;
  hours_expected: number;
  coverage_pct: number;
  sensors_reporting: number;
  pollutants: string[];
  /** False when CPCB's rules forbid publishing a number; `aqi` is then null. */
  valid: boolean;
  aqi: number | null;
  category: string | null;
  prominent_pollutant: string | null;
  reasons: string[];
};

export type MeshPayload = {
  season: number;
  as_of: string;
  count: number;
  indexable: number;
  window_hours: number;
  index: string;
  note: string;
  pollutants_indexed: string[];
  pollutants_excluded: Record<string, string>;
  stations: MeshStation[];
};

export async function fetchMesh(timeoutMs = 8000): Promise<MeshPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/stations`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      // Same reason as the forecast client: a 200 must mean the server
      // answered, not that the browser still had a copy.
      cache: 'no-store',
    });
    // 204 is an ordinary answer — the archive has no indexable stations.
    if (res.status === 204 || !res.ok) return null;
    const data = (await res.json()) as MeshPayload;
    if (!Array.isArray(data?.stations) || data.stations.length === 0) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── matching ────────────────────────────────────────────────────────────────

/** Planar distance in km. Good enough over a 60 km domain. */
function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111.0, (aLng - bLng) * 97.5);
}

/**
 * Words too common across NCR station names to identify anything. "Delhi"
 * appears in most of them; matching on it would pair any two stations.
 */
const STOP = new Set(['delhi', 'new', 'ncr', 'uttar', 'pradesh', 'up', 'india', 'gram']);

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Nearest-first, each side used once, and the name has to agree. */
const MAX_KM = 2.0;
/** Inside this, two records are the same site whatever they are called. */
const SAME_SITE_KM = 0.25;

export type Match = { station: Station; mesh: MeshStation; km: number };

/**
 * Pair curated nodes with real stations.
 *
 * Distance alone is not enough, and this is not hypothetical: Shadipur's
 * nearest neighbour in the archive is "North Campus, DU" 0.67 km away, while
 * the real Shadipur station sits 1.04 km off. Taking the nearest would have
 * published DU's measurements under Shadipur's name — a different fabrication,
 * not a fix. Requiring a shared name token rejects that pairing and finds the
 * right one.
 */
export function matchStations(curated: Station[], mesh: MeshStation[]): Match[] {
  const pairs: Match[] = [];
  for (const station of curated) {
    for (const m of mesh) {
      const d = km(station.lat, station.lng, m.lat, m.lon);
      if (d <= MAX_KM) pairs.push({ station, mesh: m, km: d });
    }
  }
  pairs.sort((a, b) => a.km - b.km);

  const usedCurated = new Set<string>();
  const usedMesh = new Set<number>();
  const out: Match[] = [];
  for (const p of pairs) {
    if (usedCurated.has(p.station.id) || usedMesh.has(p.mesh.id)) continue;
    if (p.km > SAME_SITE_KM) {
      const shared = [...tokens(p.station.name)].some((t) => tokens(p.mesh.full_name).has(t));
      if (!shared) continue;
    }
    usedCurated.add(p.station.id);
    usedMesh.add(p.mesh.id);
    out.push(p);
  }
  return out;
}

// ── merging ─────────────────────────────────────────────────────────────────

const POLLUTANT_LABEL: Record<string, Station['dominant']> = {
  'PM2.5': 'PM2.5',
  PM10: 'PM10',
  O3: 'O3',
  NO2: 'NO2',
};

export type LiveStation = Station & {
  /** Backend station id, so a reader can look the node up in CPCB's listings. */
  meshId: number;
  /** The archive's own name for it, agency suffix and all. */
  fullName: string;
  pm25: number | null;
  category: string | null;
  /** How far the curated coordinate sits from the archive's. */
  matchKm: number;
};

export type MergedMesh = {
  stations: LiveStation[];
  /** Curated nodes with no counterpart in the archive, by name. */
  dropped: string[];
  as_of: string;
  index: string;
  note: string;
  excluded: Record<string, string>;
};

/**
 * Curated nodes carrying their real readings.
 *
 * Nodes with no counterpart are dropped rather than kept at their hand-written
 * value. Four of the 26 have none: two sit where the archive has no station,
 * and two (Uttam Nagar, Faridabad Sector-16A) lose their nearest match to a
 * closer node. Showing 22 measured nodes is worth more than 26 of which four
 * are invented, and a mesh that mixes the two cannot be read at all.
 */
export function mergeMesh(payload: MeshPayload, curated: Station[] = STATIONS): MergedMesh {
  const indexable = payload.stations.filter((s) => s.valid && s.aqi != null);
  const matches = matchStations(curated, indexable);

  const stations = matches.map(({ station, mesh, km: d }): LiveStation => {
    const dominant = mesh.prominent_pollutant
      ? (POLLUTANT_LABEL[mesh.prominent_pollutant] ?? station.dominant)
      : station.dominant;
    return {
      ...station,
      // Measured, all of it.
      aqi: mesh.aqi as number,
      delta: mesh.delta_24h_pct ?? 0,
      dominant,
      agency: (mesh.agency as Station['agency']) ?? station.agency,
      sensors: mesh.sensors_reporting,
      // Real coverage over the indexing window, not an invented availability
      // figure. It reads lower than the old hand-written "99.94%" because it
      // is counting actual reporting hours.
      uptime: `${mesh.coverage_pct.toFixed(1)}%`,
      status: mesh.coverage_pct >= 90 ? 'ONLINE' : mesh.coverage_pct >= 60 ? 'DEGRADED' : 'CALIBRATING',
      meshId: mesh.id,
      fullName: mesh.full_name,
      pm25: mesh.pm25,
      category: mesh.category,
      matchKm: Math.round(d * 100) / 100,
    };
  });

  const kept = new Set(matches.map((m) => m.station.id));
  return {
    stations,
    dropped: curated.filter((s) => !kept.has(s.id)).map((s) => s.name),
    as_of: payload.as_of,
    index: payload.index,
    note: payload.note,
    excluded: payload.pollutants_excluded ?? {},
  };
}
