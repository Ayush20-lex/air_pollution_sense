/**
 * The monitoring mesh the public terminal falls back to when the backend
 * cannot be reached.
 *
 * These were hand-written once - `aqi: 142` was a literal, at a real
 * coordinate, which is the one combination a viewer cannot detect. They are now
 * a frozen snapshot of the archive: the same CPCB National AQI that
 * /api/v1/stations serves, recorded at 2025-12-28T23:00Z, the hour the console
 * replays. Every figure here was measured at the station it sits on.
 *
 * Two consequences worth knowing.
 *
 * The numbers are severe - a mean of 414, ranging 337 to 492 - because late
 * December in Delhi is severe. The old values averaged 142, so an unreachable
 * backend used to drop the mesh from "Severe" to "Moderate" and the page
 * changed its story about the city rather than about its own connectivity.
 *
 * Six of the original 26 are gone. Four had no counterpart in the archive and
 * two could not meet CPCB's three-pollutant rule, so there was nothing
 * measured to put in their place. Twenty real nodes are worth more than
 * twenty-six where six are invented, and this list now matches the live one
 * station for station - offline and online differ in freshness, not in which
 * city they are describing.
 *
 * A snapshot ages. It is the right fallback because it is real and it is
 * consistent with the live feed, not because it is current; the badge says
 * which of the two is on screen. Regenerate it from /api/v1/stations if the
 * replayed hour ever moves.
 */

import { TERM, TERM_SEVERITY } from './palette';

export type TerminalZone = 'North' | 'West' | 'Central' | 'East' | 'South' | 'NCR Outer';

export type NodeStatus = 'ONLINE' | 'DEGRADED' | 'CALIBRATING';

export type Station = {
  /** Stable id, also used as the selection key. */
  id: string;
  name: string;
  zone: TerminalZone;
  /** Monitoring authority that operates the node. */
  agency: 'CPCB' | 'DPCC' | 'IMD' | 'ICAR' | 'HSPCB' | 'UPPCB';
  lat: number;
  lng: number;
  /** Composite AQI at the current hour. */
  aqi: number;
  dominant: 'PM2.5' | 'PM10' | 'O3' | 'NO2';
  /** Attributed upwind source. */
  source: string;
  /** 24-hour change, percent. */
  delta: number;
  sensors: number;
  uptime: string;
  status: NodeStatus;
  /** Master node — the hub the rest of the console reports against. */
  master?: boolean;
};

export const STATIONS: Station[] = [
  { id: 'wazirpur', name: 'Wazirpur', zone: 'North', agency: 'DPCC', lat: 28.6997, lng: 77.165, aqi: 440, dominant: 'PM2.5', source: 'Industrial', delta: 8.6, sensors: 5, uptime: '95.8%', status: 'ONLINE' },
  { id: 'bawana', name: 'Bawana', zone: 'North', agency: 'DPCC', lat: 28.7762, lng: 77.051, aqi: 414, dominant: 'PM2.5', source: 'Industrial', delta: -4.9, sensors: 5, uptime: '95.8%', status: 'ONLINE' },
  { id: 'jahangirpuri', name: 'Jahangirpuri', zone: 'North', agency: 'DPCC', lat: 28.7328, lng: 77.1707, aqi: 436, dominant: 'PM2.5', source: 'Industrial', delta: 7.5, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
  { id: 'dtu', name: 'DTU', zone: 'North', agency: 'CPCB', lat: 28.75, lng: 77.1112, aqi: 423, dominant: 'PM2.5', source: 'Construction', delta: -1.4, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
  { id: 'shadipur', name: 'Shadipur', zone: 'West', agency: 'CPCB', lat: 28.6514, lng: 77.158, aqi: 426, dominant: 'PM2.5', source: 'Vehicular', delta: -12.0, sensors: 5, uptime: '83.3%', status: 'DEGRADED' },
  { id: 'nsit-dwarka', name: 'NSIT Dwarka', zone: 'West', agency: 'CPCB', lat: 28.6094, lng: 77.0329, aqi: 337, dominant: 'PM2.5', source: 'Vehicular', delta: 17.4, sensors: 5, uptime: '87.5%', status: 'DEGRADED' },
  { id: 'crri-mathura-road', name: 'CRRI Mathura Road', zone: 'Central', agency: 'IMD', lat: 28.5512, lng: 77.2735, aqi: 406, dominant: 'PM2.5', source: 'Vehicular', delta: 23.5, sensors: 4, uptime: '95.8%', status: 'ONLINE' },
  { id: 'nehru-nagar', name: 'Nehru Nagar', zone: 'Central', agency: 'DPCC', lat: 28.5677, lng: 77.25, aqi: 460, dominant: 'PM2.5', source: 'Vehicular', delta: 28.1, sensors: 5, uptime: '95.8%', status: 'ONLINE' },
  { id: 'pusa', name: 'Pusa', zone: 'Central', agency: 'DPCC', lat: 28.6394, lng: 77.1462, aqi: 397, dominant: 'PM2.5', source: 'Construction', delta: 3.0, sensors: 5, uptime: '95.8%', status: 'ONLINE' },
  { id: 'lodhi-road', name: 'Lodhi Road', zone: 'Central', agency: 'IMD', lat: 28.5918, lng: 77.2273, aqi: 367, dominant: 'PM2.5', source: 'Vehicular', delta: 13.6, sensors: 4, uptime: '95.8%', status: 'ONLINE' },
  { id: 'okhla-phase-2', name: 'Okhla Phase-2', zone: 'East', agency: 'DPCC', lat: 28.5307, lng: 77.2712, aqi: 423, dominant: 'PM10', source: 'Industrial', delta: 0.4, sensors: 5, uptime: '70.8%', status: 'DEGRADED' },
  { id: 'anand-vihar', name: 'Anand Vihar', zone: 'East', agency: 'DPCC', lat: 28.6503, lng: 77.3152, aqi: 461, dominant: 'PM10', source: 'Industrial + vehicular', delta: 4.2, sensors: 5, uptime: '95.8%', status: 'ONLINE', master: true },
  { id: 'vikas-sadan', name: 'Vikas Sadan', zone: 'NCR Outer', agency: 'HSPCB', lat: 28.4595, lng: 77.0266, aqi: 372, dominant: 'PM2.5', source: 'Vehicular NH48', delta: 35.9, sensors: 5, uptime: '70.8%', status: 'DEGRADED' },
  { id: 'teri-gram', name: 'TERI Gram Gwal Pahari', zone: 'NCR Outer', agency: 'IMD', lat: 28.4211, lng: 77.1466, aqi: 374, dominant: 'PM2.5', source: 'Vehicular NH48', delta: 0.1, sensors: 4, uptime: '95.8%', status: 'ONLINE' },
  { id: 'noida-62', name: 'Noida Sector-62', zone: 'NCR Outer', agency: 'IMD', lat: 28.6245, lng: 77.364, aqi: 391, dominant: 'PM2.5', source: 'Construction', delta: 3.7, sensors: 4, uptime: '95.8%', status: 'ONLINE' },
  { id: 'noida-125', name: 'Noida Sector-125', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.545, lng: 77.325, aqi: 407, dominant: 'PM2.5', source: 'Construction', delta: -4.8, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
  { id: 'loni', name: 'Loni', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.751, lng: 77.288, aqi: 492, dominant: 'PM10', source: 'Industrial', delta: 8.8, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
  { id: 'sanjay-nagar', name: 'Sanjay Nagar', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.683, lng: 77.453, aqi: 387, dominant: 'PM2.5', source: 'Industrial', delta: 22.1, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
  { id: 'vasundhara', name: 'Vasundhara', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.66, lng: 77.37, aqi: 446, dominant: 'PM10', source: 'Industrial', delta: -10.7, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
  { id: 'indirapuram', name: 'Indirapuram', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.642, lng: 77.371, aqi: 419, dominant: 'PM10', source: 'Vehicular', delta: -5.6, sensors: 5, uptime: '91.7%', status: 'ONLINE' },
];

export const MASTER_STATION: Station =
  STATIONS.find((s) => s.master) ?? STATIONS[0];

export function stationById(id: string | null): Station | undefined {
  if (!id) return undefined;
  return STATIONS.find((s) => s.id === id);
}

/** Worst-to-best, the order the mesh ranking and ledger both use. */
export const STATIONS_BY_SEVERITY: Station[] = [...STATIONS].sort((a, b) => b.aqi - a.aqi);

/**
 * The same orderings and rollups, over whichever mesh is actually on screen.
 *
 * The constants above are computed once from the curated list, which was
 * correct while that list was the only one. The live mesh replaces the readings
 * and drops the nodes the archive has no counterpart for, so every derived
 * figure has to be recomputed from it or the zone means would describe a
 * different set of stations than the table below them.
 */
export function bySeverity<T extends Station>(list: T[]): T[] {
  return [...list].sort((a, b) => b.aqi - a.aqi);
}

export function findById<T extends Station>(list: T[], id: string | null): T | undefined {
  if (!id) return undefined;
  return list.find((s) => s.id === id);
}

export const ZONE_ORDER: TerminalZone[] = [
  'North', 'West', 'Central', 'East', 'South', 'NCR Outer',
];

export function zoneSummary(list: Station[]): ZoneSummary[] {
  return ZONE_ORDER.map((zone) => {
    const members = list.filter((s) => s.zone === zone);
    // A zone can empty out once unmatched nodes are dropped; dividing by zero
    // here would put NaN in the rail.
    if (members.length === 0) {
      return { zone, mean: 0, dominant: 'PM2.5' as Station['dominant'], delta: 0, count: 0 };
    }
    const mean = members.reduce((sum, s) => sum + s.aqi, 0) / members.length;
    const delta = members.reduce((sum, s) => sum + s.delta, 0) / members.length;
    const tally = members.reduce<Record<string, number>>((acc, s) => {
      acc[s.dominant] = (acc[s.dominant] ?? 0) + 1;
      return acc;
    }, {});
    const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0] as Station['dominant'];
    return { zone, mean: Math.round(mean), dominant, delta: Number(delta.toFixed(1)), count: members.length };
  }).filter((z) => z.count > 0);
}

export type ZoneSummary = {
  zone: TerminalZone;
  mean: number;
  dominant: Station['dominant'];
  delta: number;
  count: number;
};

/**
 * Zone means over the fallback mesh.
 *
 * One implementation, shared with the live path. The copy that used to live
 * here indexed `Object.entries(tally).sort(...)[0][0]` without checking that
 * the zone had any members, which was safe only while every zone was
 * guaranteed one - and stopped being safe the moment the station list became
 * the archive's rather than a hand-written set that happened to cover all six.
 * South lost its only node (R K Puram cannot meet the three-pollutant rule),
 * the tally came back empty, and the whole module threw at import: a blank
 * terminal, from a station list that was otherwise correct.
 */
export const ZONE_SUMMARY: ZoneSummary[] = zoneSummary(STATIONS);

/**
 * Upwind source apportionment for the current synoptic situation.
 *
 * `entry` is where the air mass crosses into the domain and `target` the basin
 * region it loads, so the map can draw the actual transport path instead of
 * only listing a percentage.
 */
export type PlumeSource = {
  id: string;
  label: string;
  detail: string;
  share: number;
  color: string;
  entry: [number, number];
  target: [number, number];
  /** Perpendicular bow of the transport path, in degrees. */
  curve: number;
};

export const PLUME_SOURCES: PlumeSource[] = [
  {
    id: 'stubble',
    label: 'Stubble Burning',
    detail: 'Punjab / Haryana — NW inflow',
    share: 34,
    color: TERM.tertiary,
    entry: [28.95, 76.78],
    target: [28.72, 77.09],
    curve: 0.05,
  },
  {
    id: 'industrial',
    label: 'Industrial',
    detail: 'Bawana / Wazirpur — N inflow',
    share: 26,
    color: TERM_SEVERITY.severe,
    entry: [28.96, 77.2],
    target: [28.68, 77.28],
    curve: -0.04,
  },
  {
    id: 'vehicular',
    label: 'Vehicular',
    detail: 'NH48 Expressway — SW inflow',
    share: 22,
    color: TERM_SEVERITY.high,
    entry: [28.3, 76.82],
    target: [28.58, 77.08],
    curve: 0.05,
  },
  {
    id: 'construction',
    label: 'Construction',
    detail: 'Faridabad / Noida — SE inflow',
    share: 18,
    color: TERM_SEVERITY.caution,
    entry: [28.28, 77.62],
    target: [28.52, 77.33],
    curve: -0.045,
  },
];

/** Nested model domain, matching the console's d03 framing. */
export const NCR_BOUNDS = { south: 28.28, north: 28.92, west: 76.82, east: 77.62 } as const;
export const NCR_CENTER: [number, number] = [28.6, 77.21];
