/**
 * What the network is measuring, channel by channel.
 *
 * The pollutant grid shows eight cards because the CPCB National AQI indexes
 * eight pollutants. Four of them read "not reported", and until now nothing on
 * the page said why - which invites the reading that the sensors are broken.
 * They are not: three channels are withheld deliberately and with a stated
 * reason, and two are never offered by the feed at all. Those are three
 * different states and this module keeps them apart.
 *
 * The other thing it keeps apart is the two cohorts. The mesh is a blend: the
 * live WAQI feed carries about two dozen stations for this hour, and the
 * archive carries the rest of the network about 42 hours behind. Their
 * coverage numbers are not comparable and must never be summed into one
 * figure, because they are counting different things:
 *
 *   - A live station publishes a ready-made 24-hour mean, so its "valid hours"
 *     is always the full window. It is a property of WAQI's product, not a
 *     count of observations, and averaging it into a coverage statistic makes
 *     the network look perfectly instrumented.
 *   - An archive station carries its own hourly readings, so its valid-hour
 *     count is real and varies - 19 to 24 across the network this hour.
 *
 * Every function here takes the cohort it should describe and the caller
 * labels it. See useMesh's `freshStations` for the same rule applied to values.
 */
import type { LiveStation, UnindexedStation } from './meshApi';
import type { Station } from './stations';

/**
 * Averaging window per channel, in hours.
 *
 * Mirrors AVERAGING_HOURS in backend/aqi_cpcb.py. Ozone and CO are 8-hourly
 * under CPCB's table and everything else is 24; getting this wrong would label
 * a station's ozone as a daily mean when it is the worst 8-hour rolling one.
 * Change one, change both.
 */
export const CHANNEL_WINDOW_HOURS: Record<string, number> = {
  'PM2.5': 24,
  PM10: 24,
  NO2: 24,
  SO2: 24,
  NH3: 24,
  Pb: 24,
  CO: 8,
  O3: 8,
};

/**
 * Hours that must be valid before the window average is publishable.
 *
 * Mirrors MIN_VALID_HOURS in backend/aqi_cpcb.py: CPCB states 16 of 24 for the
 * daily pollutants, and the 8-hourly ones take the same two-thirds proportion
 * because CPCB does not state a figure for them.
 */
export const MIN_VALID_HOURS: Record<number, number> = { 24: 16, 8: 6 };

/** The order the grid draws them, so every panel agrees. */
export const CHANNEL_ORDER = ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2', 'CO', 'NH3', 'Pb'] as const;

export type ChannelCoverage = {
  key: string;
  windowHours: number;
  minValidHours: number;
  /** Stations publishing a sub-index for this channel. */
  reporting: number;
  /** Stations in the cohort that could be publishing one. */
  of: number;
  /** Of those, how many also published the concentration behind it. */
  withConcentration: number;
  /** Valid-hour counts across the reporting stations. */
  minValid: number | null;
  medianValid: number | null;
  /** True when every reporting station sits exactly on the full window. */
  uniformWindow: boolean;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Per-channel coverage across one cohort of stations. */
export function channelCoverage(stations: LiveStation[]): ChannelCoverage[] {
  const of = stations.length;
  return CHANNEL_ORDER.map((key) => {
    const window = CHANNEL_WINDOW_HOURS[key] ?? 24;
    const valid: number[] = [];
    let reporting = 0;
    let withConcentration = 0;
    for (const s of stations) {
      const sub = s.subIndices?.[key];
      if (!sub || typeof sub.sub_index !== 'number') continue;
      reporting += 1;
      if (typeof sub.concentration === 'number') withConcentration += 1;
      if (typeof sub.valid_hours === 'number') valid.push(sub.valid_hours);
    }
    return {
      key,
      windowHours: window,
      minValidHours: MIN_VALID_HOURS[window] ?? Math.ceil(window * (2 / 3)),
      reporting,
      of,
      withConcentration,
      minValid: valid.length ? Math.min(...valid) : null,
      medianValid: median(valid),
      // Every station sitting exactly on the full window is the signature of a
      // pre-averaged product rather than a well-instrumented network, and the
      // panel says so rather than presenting it as perfect coverage.
      uniformWindow: valid.length > 0 && valid.every((v) => v === window),
    };
  });
}

export type ChannelState =
  | { kind: 'indexed'; key: string }
  | { kind: 'withheld'; key: string; reason: string }
  | { kind: 'absent'; key: string };

/**
 * Why each of the eight channels is, or is not, in the index.
 *
 * Three states, and collapsing them would lose the whole point:
 *
 *   indexed  - the feed publishes it and CPCB's rules accept it.
 *   withheld - the feed publishes something, and the backend refuses to index
 *              it, with a reason it states. NO2 and SO2 are EPA one-hour
 *              sub-indices being asked to stand in for CPCB 24-hour ones; CO
 *              has a unit contradiction in the catalogue.
 *   absent   - nothing is published at all. NH3 and Pb are in CPCB's table and
 *              in no feed this system reads.
 */
export function channelStates(
  stations: LiveStation[],
  excluded: Record<string, string>,
): ChannelState[] {
  // Keyed lowercase by the backend, title-cased on the cards.
  const withheld = new Map(
    Object.entries(excluded ?? {}).map(([k, v]) => [k.toLowerCase().replace('.', ''), v]),
  );
  const reported = new Set<string>();
  for (const s of stations) {
    for (const [k, v] of Object.entries(s.subIndices ?? {})) {
      if (typeof v?.sub_index === 'number') reported.add(k);
    }
  }
  return CHANNEL_ORDER.map((key): ChannelState => {
    if (reported.has(key)) return { kind: 'indexed', key };
    const reason = withheld.get(key.toLowerCase().replace('.', ''));
    if (reason) return { kind: 'withheld', key, reason };
    return { kind: 'absent', key };
  });
}

export type IndexDriver = {
  /** The channel whose sub-index is the station's AQI. */
  pollutant: string;
  count: number;
  pct: number;
  /** How many of those stations sit in each compass zone. */
  zones: Record<string, number>;
};

/**
 * Which channel is setting the index, across a cohort.
 *
 * The National AQI is the maximum of a station's sub-indices, so exactly one
 * channel decides each station's number. Aggregated, that answers a question
 * the eight cards cannot: what is this city's air actually failing on. Right
 * now it is coarse particulate at almost every station, not PM2.5 - which is
 * worth knowing on a page that leads with PM2.5 everywhere else.
 */
export function indexDrivers(
  stations: (Station | LiveStation)[],
): { total: number; drivers: IndexDriver[] } {
  const byPollutant = new Map<string, { count: number; zones: Record<string, number> }>();
  let total = 0;
  for (const s of stations) {
    const p = s.dominant;
    if (!p) continue;
    total += 1;
    const e = byPollutant.get(p) ?? { count: 0, zones: {} };
    e.count += 1;
    e.zones[s.zone] = (e.zones[s.zone] ?? 0) + 1;
    byPollutant.set(p, e);
  }
  const drivers = [...byPollutant.entries()]
    .map(([pollutant, e]) => ({
      pollutant,
      count: e.count,
      pct: total ? Math.round((e.count / total) * 100) : 0,
      zones: e.zones,
    }))
    .sort((a, b) => b.count - a.count);
  return { total, drivers };
}

export type Shortfall = {
  station: string;
  /** Channel -> CPCB's own arithmetic for why it was not indexed. */
  channels: Record<string, string>;
  reasons: string[];
};

/** Stations CPCB's validity rule kept out of the index, and by how much. */
export function shortfalls(unindexed: UnindexedStation[]): Shortfall[] {
  return unindexed
    .map((u) => ({
      station: u.name,
      channels: u.shortfalls ?? {},
      reasons: u.reasons ?? (u.reason ? [u.reason] : []),
    }))
    .sort((a, b) => Object.keys(b.channels).length - Object.keys(a.channels).length);
}
