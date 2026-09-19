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

/** Same contract as forecastApi's API_BASE - see the note there. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/**
 * One pollutant's contribution to a station's CPCB index.
 *
 * `concentration` is the measured value over `window_hours` — 24h for the
 * particulates and NO2, 8h for ozone, per CPCB's averaging rules. It is what
 * the pollutant grid shows; `sub_index` is that concentration mapped onto the
 * 0-500 scale, and the largest across pollutants becomes the station AQI.
 */
export type SubIndex = {
  sub_index: number;
  concentration: number;
  window_hours: number;
  valid_hours: number;
};

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
  /** Keyed "PM2.5" | "PM10" | "NO2" | "O3" | "SO2". Absent pollutants simply
   *  have no entry — the archive has no reading, not a reading of zero. */
  sub_indices: Record<string, SubIndex>;
  /** The 24 hourly readings each sub-index was computed from, keyed by the
   *  lowercase pollutant ("pm25" | "pm10" | "no2" | "o3" | "so2"). Gaps and
   *  readings the QC rejected come through as null rather than being closed
   *  over, so a chart shows the hole instead of drawing across it. */
  hourly: Record<string, (number | null)[]>;
  reasons: string[];
  /** WAQI's own US-scale figure, present only on the live feed. */
  aqi_us?: number | null;
  /**
   * Which clock this station is speaking for. "live" is this hour; "archive"
   * is a station that reports to CPCB but not to the live feed, carried so the
   * map is not three quarters empty. Absent on the offline curated fallback.
   */
  freshness?: 'live' | 'archive';
  /** This station's own hour. Differs between the two freshnesses. */
  as_of?: string;
};

export type MeshPayload = {
  /** "waqi_live" when the feed is live, "archive" when it is the replay. */
  source?: string;
  season: number | null;
  as_of: string;
  count: number;
  indexable: number;
  window_hours: number;
  index: string;
  note: string;
  pollutants_indexed: string[];
  pollutants_excluded: Record<string, string>;
  /** Archive-only stations added to fill the map. Never counted in `count`. */
  supplemented?: number;
  supplement_as_of?: string | null;
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
  /**
   * Whether `delta` is a measurement. The live feed is a single snapshot with
   * no previous day behind it, and a 0 would render as "no change" -
   * indistinguishable from a measured flat 24 hours.
   */
  deltaKnown: boolean;
  /** WAQI's US-scale figure, for reconciling against a US-scale site. */
  aqiUs: number | null;
  /** Per-pollutant measurements behind this station's index. */
  subIndices: Record<string, SubIndex>;
  /** The hourly window behind those measurements. */
  hourly: Record<string, (number | null)[]>;
  /** Share of the indexing window this station actually reported. */
  coveragePct: number;
  /** See MeshStation.freshness. Defaults to the payload's own feed. */
  freshness: 'live' | 'archive';
  /** This station's own hour, which on a blended mesh is not the page's. */
  stationAsOf: string | null;
};

export type MergedMesh = {
  stations: LiveStation[];
  /** Stations the feed carried but could not index, by name. */
  dropped: string[];
  /** "waqi_live" or "archive". */
  source: string;
  as_of: string;
  index: string;
  note: string;
  excluded: Record<string, string>;
  /** How many stations came from the archive to fill out the map. */
  supplemented: number;
};

/**
 * The feed's own stations, as the page will draw them.
 *
 * This used to intersect the payload with the curated list in ./stations,
 * which was right while both described the same 68 CPCB sites. The live feed
 * does not: WAQI carries 24 NCR stations and only six of them coincide with a
 * curated node, so intersecting would have thrown away three quarters of a
 * live mesh to preserve a hand-drawn one.
 *
 * So the backend decides which stations exist and this renders them. The
 * curated list is now purely the offline fallback, which is all it was ever
 * really doing.
 *
 * `source` is the one field with no equivalent in either feed - it is an
 * editorial attribution of the upwind sector, and the table marks it as such.
 */
export function mergeMesh(payload: MeshPayload): MergedMesh {
  const zones: Station['zone'][] = ['North', 'West', 'Central', 'East', 'South', 'NCR Outer'];

  const stations = payload.stations
    .filter((s) => s.valid && s.aqi != null)
    .map((s): LiveStation => ({
      id: `m${s.id}`,
      name: s.name,
      zone: (zones.includes(s.zone as Station['zone']) ? s.zone : 'Central') as Station['zone'],
      agency: (s.agency as Station['agency']) ?? 'CPCB',
      lat: s.lat,
      lng: s.lon,
      aqi: s.aqi as number,
      dominant: (POLLUTANT_LABEL[s.prominent_pollutant ?? ''] ?? 'PM2.5'),
      source: '—',
      delta: s.delta_24h_pct ?? 0,
      deltaKnown: s.delta_24h_pct != null,
      sensors: s.sensors_reporting,
      uptime: `${s.coverage_pct.toFixed(1)}%`,
      status:
        s.coverage_pct >= 90 ? 'ONLINE' : s.coverage_pct >= 60 ? 'DEGRADED' : 'CALIBRATING',
      meshId: s.id,
      fullName: s.full_name,
      pm25: s.pm25,
      category: s.category,
      aqiUs: s.aqi_us ?? null,
      subIndices: s.sub_indices ?? {},
      hourly: s.hourly ?? {},
      coveragePct: s.coverage_pct,
      freshness: s.freshness ?? (payload.source === 'waqi_live' ? 'live' : 'archive'),
      stationAsOf: s.as_of ?? payload.as_of ?? null,
    }));

  return {
    stations,
    dropped: payload.stations.filter((s) => !s.valid).map((s) => s.name),
    as_of: payload.as_of,
    index: payload.index,
    note: payload.note,
    excluded: payload.pollutants_excluded ?? {},
    source: payload.source ?? 'archive',
    // Counted from the list that is actually drawn, not from the payload's
    // own `supplemented`. The two differ: the backend carries every archived
    // station, including the ones CPCB's rules forbid publishing a number for,
    // and this drops those a few lines above. Subtracting the backend's count
    // from the filtered list read 12 nodes reporting where 24 were.
    supplemented: stations.filter((s) => s.freshness === 'archive').length,
  };
}
