/**
 * The corridor's fires, as pixels rather than one average.
 *
 * Until this existed the only fire data on the client was a single
 * FRP-weighted centroid - `source.fire.centroid_lat/lon` - so the map drew the
 * smoke as one ribbon from one point. The pixels were never missing from the
 * physics: `firms_fire.plume_field` burns every one of them into the forecast.
 * They were missing from the serialiser. `/api/v1/fires` is that gap closed.
 *
 * Two windows, one endpoint. Without `start` the backend follows the forecast
 * run, so the map and the forecast cannot disagree about which fires are in
 * play. With `start` it serves that window and, critically, that window's own
 * wind - which is what makes showing a past burning episode honest rather than
 * a matter of pasting old fires under today's weather.
 */

/** Same contract as the other clients - see forecastApi's note. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** How a cluster's smoke is, or is not, being carried to Delhi. */
export type FireTransit = {
  /** True when the flow carries it, false when it does not, null when unknown. */
  carrying: boolean | null;
  /** Hours to Delhi. Only ever a number when `carrying` is true. */
  hours: number | null;
  /** cos(angle between the flow and the bearing to Delhi). */
  alignment: number | null;
  arrivesAt: string | null;
  /** Why there is no number, in words the panel can print. */
  reason: string | null;
};

export type FireCluster = {
  id: string;
  lat: number;
  lon: number;
  /** Latitude slice. Geometric, so it cannot be wrong. */
  band: string;
  /** Rectangle guess at the state. Always printed with "approx.". */
  stateApprox: string;
  pixels: number;
  /** FIRMS's own type flags for this cluster's pixels. */
  types: Record<string, number>;
  frpTotalMw: number;
  frpMaxMw: number;
  frpSharePct: number;
  distKm: number;
  fromDelhiDeg: number;
  fromDelhiCompass: string;
  newestDetection: string | null;
  ageH: number | null;
  satellites: Record<string, number>;
  /** VIIRS's own per-pixel flag: l / n / h. A measurement, not our estimate. */
  confidence: Record<string, number>;
  daynight: Record<string, number>;
  transit: FireTransit;
};

export type FireRegion = {
  band: string;
  stateApprox: string;
  pixels: number;
  frpTotalMw: number;
  frpMaxMw: number;
  nearestKm: number;
  meanKm: number;
};

/** One detection: position, power, when, and VIIRS's own confidence flag. */
export type FirePixel = {
  lat: number;
  lon: number;
  frp: number;
  at: string | null;
  conf: string | null;
  dn: string | null;
};

export type FireWind = {
  speedKmh: number;
  /** The direction it blows **to** - what the advection uses. */
  toDeg: number;
  toCompass: string;
  /** The direction it comes **from** - what every weather report prints. */
  fromDeg: number;
  fromCompass: string;
  source: string;
};

export type FireTransport = {
  available: boolean;
  wind: FireWind | null;
  alignMin: number;
  horizonH: number;
  carryingClusters: number;
  carryingFrpSharePct: number;
  earliestArrivalH: number | null;
  assumptions: string[];
  reason: string | null;
};

export type FireCorridor = {
  available: boolean;
  reason: string | null;
  product: string | null;
  /** [west, south, east, north] - the box FIRMS was asked for. */
  bbox: [number, number, number, number] | null;
  window: { start: string; days: number; end: string | null };
  /** True when this window is the forecast run's own. */
  alignedToForecastOrigin: boolean;
  season: string | null;
  status: string | null;
  totals: {
    pixels: number;
    frpTotalMw: number;
    frpMaxMw: number;
    /** FIRMS's classification. `unclassified` means NRT ships no type column. */
    types: Record<string, number>;
    newestDetection: string | null;
    oldestDetection: string | null;
  };
  regionMethod: string;
  clusterMethod: string;
  regions: FireRegion[];
  clusters: FireCluster[];
  clustersOther: { clusters: number; pixels: number; frpTotalMw: number };
  pixels: {
    returned: number;
    total: number;
    method: string;
    droppedFrpSharePct: number;
    rows: FirePixel[];
  };
  transport: FireTransport;
  /** The one apportionment figure the model computes. Null on an episode. */
  smoke: { sharePct: number | null; basis: string; note: string } | null;
};

type Raw = Record<string, any>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toTransit(r: Raw | undefined): FireTransit {
  return {
    carrying: typeof r?.carrying === 'boolean' ? r.carrying : null,
    hours: typeof r?.hours === 'number' ? r.hours : null,
    alignment: typeof r?.alignment === 'number' ? r.alignment : null,
    arrivesAt: str(r?.arrives_at),
    reason: str(r?.reason),
  };
}

function toCluster(r: Raw): FireCluster {
  return {
    id: String(r.id),
    lat: num(r.lat),
    lon: num(r.lon),
    band: String(r.band ?? ''),
    stateApprox: String(r.state_approx ?? ''),
    pixels: num(r.pixels),
    types: (r.types ?? {}) as Record<string, number>,
    frpTotalMw: num(r.frp_total_mw),
    frpMaxMw: num(r.frp_max_mw),
    frpSharePct: num(r.frp_share_pct),
    distKm: num(r.dist_km),
    fromDelhiDeg: num(r.from_delhi_deg),
    fromDelhiCompass: String(r.from_delhi_compass ?? ''),
    newestDetection: str(r.newest_detection),
    ageH: typeof r.age_h === 'number' ? r.age_h : null,
    satellites: (r.satellites ?? {}) as Record<string, number>,
    confidence: (r.confidence ?? {}) as Record<string, number>,
    daynight: (r.daynight ?? {}) as Record<string, number>,
    transit: toTransit(r.transit),
  };
}

function normalise(d: Raw): FireCorridor | null {
  if (!d || typeof d !== 'object') return null;
  if (d.available === false) {
    return {
      available: false,
      reason: str(d.reason) ?? 'fire data unavailable',
      product: null,
      bbox: null,
      window: { start: '', days: 0, end: null },
      alignedToForecastOrigin: false,
      season: null,
      status: null,
      totals: { pixels: 0, frpTotalMw: 0, frpMaxMw: 0, types: {}, newestDetection: null, oldestDetection: null },
      regionMethod: '',
      clusterMethod: '',
      regions: [],
      clusters: [],
      clustersOther: { clusters: 0, pixels: 0, frpTotalMw: 0 },
      pixels: { returned: 0, total: 0, method: '', droppedFrpSharePct: 0, rows: [] },
      transport: {
        available: false, wind: null, alignMin: 0.3, horizonH: 72,
        carryingClusters: 0, carryingFrpSharePct: 0, earliestArrivalH: null,
        assumptions: [], reason: str(d.reason),
      },
      smoke: null,
    };
  }

  const w = d.transport?.wind;
  // Columnar on the wire - cols + rows - because 1,200 objects repeating six
  // keys is most of the payload. Expanded here, once, rather than in a chart.
  const rows: FirePixel[] = Array.isArray(d.pixels?.rows)
    ? d.pixels.rows.map((r: unknown[]) => ({
        lat: num(r[0]),
        lon: num(r[1]),
        frp: num(r[2]),
        at: str(r[3]),
        conf: str(r[4]),
        dn: str(r[5]),
      }))
    : [];

  return {
    available: true,
    reason: null,
    product: str(d.product),
    bbox: Array.isArray(d.bbox) && d.bbox.length === 4 ? (d.bbox as FireCorridor['bbox']) : null,
    window: {
      start: String(d.window?.start ?? ''),
      days: num(d.window?.days),
      end: str(d.window?.end),
    },
    alignedToForecastOrigin: Boolean(d.aligned_to_forecast_origin),
    season: str(d.season),
    status: str(d.status),
    totals: {
      pixels: num(d.totals?.pixels),
      frpTotalMw: num(d.totals?.frp_total_mw),
      frpMaxMw: num(d.totals?.frp_max_mw),
      types: (d.totals?.types ?? {}) as Record<string, number>,
      newestDetection: str(d.totals?.newest_detection),
      oldestDetection: str(d.totals?.oldest_detection),
    },
    regionMethod: String(d.region_method ?? ''),
    clusterMethod: String(d.cluster_method ?? ''),
    regions: Array.isArray(d.regions)
      ? d.regions.map((r: Raw) => ({
          band: String(r.band ?? ''),
          stateApprox: String(r.state_approx ?? ''),
          pixels: num(r.pixels),
          frpTotalMw: num(r.frp_total_mw),
          frpMaxMw: num(r.frp_max_mw),
          nearestKm: num(r.nearest_km),
          meanKm: num(r.mean_km),
        }))
      : [],
    clusters: Array.isArray(d.clusters) ? d.clusters.map(toCluster) : [],
    clustersOther: {
      clusters: num(d.clusters_other?.clusters),
      pixels: num(d.clusters_other?.pixels),
      frpTotalMw: num(d.clusters_other?.frp_total_mw),
    },
    pixels: {
      returned: num(d.pixels?.returned),
      total: num(d.pixels?.total),
      method: String(d.pixels?.method ?? ''),
      droppedFrpSharePct: num(d.pixels?.dropped_frp_share_pct),
      rows,
    },
    transport: {
      available: Boolean(d.transport?.available),
      wind: w
        ? {
            speedKmh: num(w.speed_kmh),
            toDeg: num(w.to_deg),
            toCompass: String(w.to_compass ?? ''),
            fromDeg: num(w.from_deg),
            fromCompass: String(w.from_compass ?? ''),
            source: String(w.source ?? ''),
          }
        : null,
      alignMin: num(d.transport?.align_min) || 0.3,
      horizonH: num(d.transport?.horizon_h) || 72,
      carryingClusters: num(d.transport?.carrying_clusters),
      carryingFrpSharePct: num(d.transport?.carrying_frp_share_pct),
      earliestArrivalH:
        typeof d.transport?.earliest_arrival_h === 'number'
          ? d.transport.earliest_arrival_h
          : null,
      assumptions: Array.isArray(d.transport?.assumptions) ? d.transport.assumptions : [],
      reason: str(d.transport?.reason),
    },
    smoke: d.smoke
      ? {
          sharePct: typeof d.smoke.share_pct === 'number' ? d.smoke.share_pct : null,
          basis: String(d.smoke.basis ?? ''),
          note: String(d.smoke.note ?? ''),
        }
      : null,
  };
}

/**
 * One window of corridor fires. Null on any failure - the caller keeps
 * whatever it had rather than blanking the map.
 *
 * `start` omitted follows the forecast run. The timeout is generous because a
 * window nobody has asked for yet costs one request to NASA.
 */
export async function fetchFires(
  opts: { start?: string | null; maxPixels?: number; timeoutMs?: number } = {},
): Promise<FireCorridor | null> {
  const { start = null, maxPixels = 1200, timeoutMs = 20000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const q = new URLSearchParams({ max_pixels: String(maxPixels) });
    if (start) q.set('start', start);
    const res = await fetch(`${API_BASE}/api/v1/fires?${q}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return normalise((await res.json()) as Raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
