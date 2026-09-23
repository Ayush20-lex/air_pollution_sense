import { SEVERITY } from './tokens';

/**
 * CPCB National Air Quality Index breakpoints (India) for PM2.5, 24h avg.
 * Colour semantics are theme-independent by design.
 */
export type AqiBand = {
  label: string;
  short: string;
  color: string;
  from: number;
  to: number;
  aqiFrom: number;
  aqiTo: number;
};

export const AQI_BANDS: AqiBand[] = [
  { label: 'Good', short: 'GOOD', color: SEVERITY.good, from: 0, to: 30, aqiFrom: 0, aqiTo: 50 },
  { label: 'Satisfactory', short: 'FAIR', color: SEVERITY.fair, from: 30, to: 60, aqiFrom: 51, aqiTo: 100 },
  { label: 'Moderate', short: 'MOD', color: SEVERITY.moderate, from: 60, to: 90, aqiFrom: 101, aqiTo: 200 },
  { label: 'Poor', short: 'POOR', color: SEVERITY.poor, from: 90, to: 120, aqiFrom: 201, aqiTo: 300 },
  { label: 'Very Poor', short: 'V.POOR', color: SEVERITY.bad, from: 120, to: 250, aqiFrom: 301, aqiTo: 400 },
  { label: 'Severe', short: 'SEVERE', color: SEVERITY.severe, from: 250, to: 1000, aqiFrom: 401, aqiTo: 500 },
];

export function pm25ToAqi(pm: number): number {
  const b = AQI_BANDS.find((x) => pm >= x.from && pm < x.to) ?? AQI_BANDS[AQI_BANDS.length - 1];
  const ratio = (pm - b.from) / (b.to - b.from);
  return Math.round(b.aqiFrom + ratio * (b.aqiTo - b.aqiFrom));
}

export function bandForPm25(pm: number): AqiBand {
  return AQI_BANDS.find((x) => pm >= x.from && pm < x.to) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

export function aqiColor(pm: number): string {
  return bandForPm25(pm).color;
}

/**
 * The band an *index* falls in, keyed on `aqiFrom`/`aqiTo`.
 *
 * `bandForPm25` reads the same table by its concentration columns, and the two
 * are nowhere near interchangeable: an AQI of 188 is Moderate, but handed to
 * `bandForPm25` it is read as 188 ug/m3 and comes back Very Poor. A caller
 * with an index and no concentration has to come here.
 */
export function bandForAqi(aqi: number): AqiBand {
  return AQI_BANDS.find((x) => aqi >= x.aqiFrom && aqi <= x.aqiTo) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/** Band colour for an index. See `bandForAqi` for why this is not `aqiColor`. */
export function aqiBandColor(aqi: number): string {
  return bandForAqi(aqi).color;
}

export type AlertLevel = 'NOMINAL' | 'ADVISORY' | 'WARNING' | 'EMERGENCY';

export const ALERT_COLOR: Record<AlertLevel, string> = {
  NOMINAL: SEVERITY.good,
  ADVISORY: SEVERITY.fair,
  WARNING: SEVERITY.moderate,
  EMERGENCY: SEVERITY.bad,
};

/** Alert level blends absolute load with the inversion-trap index. */
export function alertLevel(pm: number, inversionIndex: number): AlertLevel {
  const score = pm / 120 + inversionIndex * 0.75;
  if (score > 1.65) return 'EMERGENCY';
  if (score > 1.2) return 'WARNING';
  if (score > 0.8) return 'ADVISORY';
  return 'NOMINAL';
}
