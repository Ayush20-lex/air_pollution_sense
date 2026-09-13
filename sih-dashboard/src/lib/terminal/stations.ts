/**
 * The 26 CPCB / DPCC / HSPCB / UPPCB monitoring stations of the public
 * terminal mesh, with real coordinates.
 *
 * Values are the current-hour composite AQI. They stay in the same regime as
 * the overview screen (Anand Vihar at 142) so the two terminal pages agree;
 * the hourly variation is applied by `buildFrames` in `./field`.
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
  { id: 'wazirpur', name: 'Wazirpur', zone: 'North', agency: 'CPCB', lat: 28.6997, lng: 77.165, aqi: 168, dominant: 'PM2.5', source: 'Industrial', delta: 9.2, sensors: 8, uptime: '99.94%', status: 'ONLINE' },
  { id: 'bawana', name: 'Bawana', zone: 'North', agency: 'DPCC', lat: 28.7762, lng: 77.051, aqi: 158, dominant: 'PM2.5', source: 'Industrial', delta: 11.4, sensors: 8, uptime: '99.91%', status: 'ONLINE' },
  { id: 'jahangirpuri', name: 'Jahangirpuri', zone: 'North', agency: 'DPCC', lat: 28.7328, lng: 77.1707, aqi: 149, dominant: 'PM2.5', source: 'Industrial', delta: 7.8, sensors: 6, uptime: '99.88%', status: 'ONLINE' },
  { id: 'dtu', name: 'DTU', zone: 'North', agency: 'CPCB', lat: 28.75, lng: 77.1112, aqi: 138, dominant: 'PM10', source: 'Construction', delta: 4.1, sensors: 8, uptime: '99.97%', status: 'ONLINE' },

  { id: 'uttam-nagar', name: 'Uttam Nagar', zone: 'West', agency: 'DPCC', lat: 28.6219, lng: 77.0594, aqi: 155, dominant: 'PM2.5', source: 'Stubble burning', delta: 8.6, sensors: 6, uptime: '99.82%', status: 'ONLINE' },
  { id: 'shadipur', name: 'Shadipur', zone: 'West', agency: 'CPCB', lat: 28.6514, lng: 77.158, aqi: 151, dominant: 'PM2.5', source: 'Vehicular', delta: 6.3, sensors: 8, uptime: '99.93%', status: 'ONLINE' },
  { id: 'nsit-dwarka', name: 'NSIT Dwarka', zone: 'West', agency: 'CPCB', lat: 28.6094, lng: 77.0329, aqi: 121, dominant: 'PM2.5', source: 'Vehicular', delta: -2.4, sensors: 8, uptime: '99.96%', status: 'ONLINE' },

  { id: 'crri-mathura-road', name: 'CRRI Mathura Road', zone: 'Central', agency: 'IMD', lat: 28.5512, lng: 77.2735, aqi: 147, dominant: 'NO2', source: 'Vehicular', delta: 5.9, sensors: 8, uptime: '99.90%', status: 'ONLINE' },
  { id: 'nehru-nagar', name: 'Nehru Nagar', zone: 'Central', agency: 'DPCC', lat: 28.5677, lng: 77.25, aqi: 129, dominant: 'PM2.5', source: 'Vehicular', delta: 3.2, sensors: 6, uptime: '99.85%', status: 'ONLINE' },
  { id: 'pusa', name: 'Pusa', zone: 'Central', agency: 'ICAR', lat: 28.6394, lng: 77.1462, aqi: 118, dominant: 'PM10', source: 'Construction', delta: -1.8, sensors: 8, uptime: '99.98%', status: 'ONLINE' },
  { id: 'lodhi-road', name: 'Lodhi Road', zone: 'Central', agency: 'IMD', lat: 28.5918, lng: 77.2273, aqi: 104, dominant: 'NO2', source: 'Vehicular', delta: -3.6, sensors: 8, uptime: '99.99%', status: 'ONLINE' },

  { id: 'okhla-phase-2', name: 'Okhla Phase-2', zone: 'East', agency: 'DPCC', lat: 28.5307, lng: 77.2712, aqi: 144, dominant: 'PM2.5', source: 'Industrial', delta: 6.7, sensors: 6, uptime: '99.87%', status: 'ONLINE' },
  { id: 'anand-vihar', name: 'Anand Vihar', zone: 'East', agency: 'CPCB', lat: 28.6503, lng: 77.3152, aqi: 142, dominant: 'PM2.5', source: 'Industrial + vehicular', delta: 8.4, sensors: 8, uptime: '99.98%', status: 'ONLINE', master: true },
  { id: 'shahdara', name: 'Shahdara', zone: 'East', agency: 'DPCC', lat: 28.679, lng: 77.292, aqi: 139, dominant: 'PM2.5', source: 'Industrial', delta: 5.1, sensors: 6, uptime: '99.83%', status: 'ONLINE' },

  { id: 'rk-puram', name: 'R K Puram', zone: 'South', agency: 'DPCC', lat: 28.5635, lng: 77.1855, aqi: 133, dominant: 'PM2.5', source: 'Vehicular', delta: 2.9, sensors: 8, uptime: '99.92%', status: 'ONLINE' },

  { id: 'vikas-sadan', name: 'Vikas Sadan', zone: 'NCR Outer', agency: 'HSPCB', lat: 28.4595, lng: 77.0266, aqi: 98, dominant: 'NO2', source: 'Vehicular NH48', delta: -5.7, sensors: 6, uptime: '99.79%', status: 'ONLINE' },
  { id: 'teri-gram', name: 'TERI Gram Gwal Pahari', zone: 'NCR Outer', agency: 'HSPCB', lat: 28.4211, lng: 77.1466, aqi: 92, dominant: 'O3', source: 'Vehicular NH48', delta: -6.2, sensors: 6, uptime: '98.41%', status: 'CALIBRATING' },
  { id: 'faridabad-16a', name: 'Faridabad Sector-16A', zone: 'NCR Outer', agency: 'HSPCB', lat: 28.4089, lng: 77.3178, aqi: 176, dominant: 'PM10', source: 'Brick kiln', delta: 14.2, sensors: 8, uptime: '99.76%', status: 'ONLINE' },
  { id: 'faridabad-30', name: 'Faridabad Sector-30', zone: 'NCR Outer', agency: 'HSPCB', lat: 28.442, lng: 77.31, aqi: 164, dominant: 'PM10', source: 'Brick kiln', delta: 12.1, sensors: 6, uptime: '99.71%', status: 'ONLINE' },
  { id: 'noida-62', name: 'Noida Sector-62', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.6245, lng: 77.364, aqi: 134, dominant: 'PM10', source: 'Construction', delta: 6.1, sensors: 8, uptime: '99.89%', status: 'ONLINE' },
  { id: 'noida-125', name: 'Noida Sector-125', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.545, lng: 77.325, aqi: 127, dominant: 'PM10', source: 'Construction', delta: 4.4, sensors: 5, uptime: '97.12%', status: 'DEGRADED' },
  { id: 'loni', name: 'Loni', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.751, lng: 77.288, aqi: 181, dominant: 'PM2.5', source: 'Industrial', delta: 15.8, sensors: 8, uptime: '99.68%', status: 'ONLINE' },
  { id: 'sanjay-nagar', name: 'Sanjay Nagar', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.683, lng: 77.453, aqi: 162, dominant: 'PM2.5', source: 'Industrial', delta: 10.3, sensors: 6, uptime: '99.74%', status: 'ONLINE' },
  { id: 'vasundhara', name: 'Vasundhara', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.66, lng: 77.37, aqi: 157, dominant: 'PM2.5', source: 'Industrial', delta: 9.1, sensors: 6, uptime: '99.80%', status: 'ONLINE' },
  { id: 'indirapuram', name: 'Indirapuram', zone: 'NCR Outer', agency: 'UPPCB', lat: 28.642, lng: 77.371, aqi: 152, dominant: 'PM2.5', source: 'Vehicular', delta: 8.2, sensors: 6, uptime: '99.77%', status: 'ONLINE' },
  { id: 'murthal', name: 'Murthal', zone: 'NCR Outer', agency: 'HSPCB', lat: 29.029, lng: 77.067, aqi: 144, dominant: 'PM2.5', source: 'Stubble burning', delta: 7.4, sensors: 6, uptime: '99.62%', status: 'ONLINE' },
];

export const MASTER_STATION: Station =
  STATIONS.find((s) => s.master) ?? STATIONS[0];

export function stationById(id: string | null): Station | undefined {
  if (!id) return undefined;
  return STATIONS.find((s) => s.id === id);
}

/** Worst-to-best, the order the mesh ranking and ledger both use. */
export const STATIONS_BY_SEVERITY: Station[] = [...STATIONS].sort((a, b) => b.aqi - a.aqi);

export type ZoneSummary = {
  zone: TerminalZone;
  mean: number;
  dominant: Station['dominant'];
  delta: number;
  count: number;
};

/** Zone means, derived so they can never drift from the station table. */
export const ZONE_SUMMARY: ZoneSummary[] = (
  ['North', 'West', 'Central', 'East', 'South', 'NCR Outer'] as TerminalZone[]
).map((zone) => {
  const members = STATIONS.filter((s) => s.zone === zone);
  const mean = members.reduce((sum, s) => sum + s.aqi, 0) / members.length;
  const delta = members.reduce((sum, s) => sum + s.delta, 0) / members.length;

  // Most frequent dominant pollutant in the zone.
  const tally = members.reduce<Record<string, number>>((acc, s) => {
    acc[s.dominant] = (acc[s.dominant] ?? 0) + 1;
    return acc;
  }, {});
  const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0] as Station['dominant'];

  return { zone, mean: Math.round(mean), dominant, delta: Number(delta.toFixed(1)), count: members.length };
});

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
