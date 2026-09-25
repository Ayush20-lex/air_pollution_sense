import { SEVERITY } from '@/lib/tokens';

/**
 * Severity ramp for the public terminal.
 *
 * The console at `/` colours by PM2.5 concentration (`lib/aqi`); this surface
 * reads composite AQI straight off the station table, so it needs its own
 * breakpoints. Colours come from the shared `SEVERITY` tokens so a band means
 * the same thing on both surfaces.
 */

export type TerminalBand = {
  label: string;
  color: string;
  from: number;
  to: number;
};

/**
 * The six CPCB National AQI categories.
 *
 * This used to be five bands on US EPA boundaries (0-50, 51-100, 101-150,
 * 151-200, 201-500) carrying CPCB's names, which is the worst of both: AQI 272
 * read as "Severe" when CPCB calls it Poor, and the Moderate band was 100
 * points narrower than the standard. The boundaries below are the ones
 * CATEGORIES in backend/aqi_cpcb.py indexes against, so the screen and the
 * engine now agree.
 *
 * PM25_BANDS below was already correct CPCB; only the composite ramp was not.
 */
export const AQI_RAMP: TerminalBand[] = [
  { label: 'Good', color: SEVERITY.good, from: 0, to: 50 },
  { label: 'Satisfactory', color: SEVERITY.fair, from: 51, to: 100 },
  { label: 'Moderate', color: SEVERITY.moderate, from: 101, to: 200 },
  { label: 'Poor', color: SEVERITY.poor, from: 201, to: 300 },
  { label: 'Very Poor', color: SEVERITY.bad, from: 301, to: 400 },
  { label: 'Severe', color: SEVERITY.severe, from: 401, to: 500 },
];

export function bandForAqi(aqi: number): TerminalBand {
  return AQI_RAMP.find((b) => aqi <= b.to) ?? AQI_RAMP[AQI_RAMP.length - 1];
}

export function aqiColor(aqi: number): string {
  return bandForAqi(aqi).color;
}

/** CPCB PM2.5 breakpoints, µg/m³ — used by the map legend. */
export const PM25_BANDS: TerminalBand[] = [
  { label: 'Good', color: SEVERITY.good, from: 0, to: 30 },
  { label: 'Satisfactory', color: SEVERITY.fair, from: 31, to: 60 },
  { label: 'Moderate', color: SEVERITY.moderate, from: 61, to: 90 },
  { label: 'Poor', color: SEVERITY.poor, from: 91, to: 120 },
  { label: 'Very Poor', color: SEVERITY.bad, from: 121, to: 250 },
  { label: 'Severe', color: SEVERITY.severe, from: 251, to: 999 },
];

export function bandForPm25(pm: number): TerminalBand {
  return PM25_BANDS.find((b) => pm <= b.to) ?? PM25_BANDS[PM25_BANDS.length - 1];
}

export function pm25Color(pm: number): string {
  return bandForPm25(pm).color;
}

/** Fields the map can paint. */
/**
 * `MODEL` is the odd one out: the other five are drawn by interpolating live
 * station readings, while MODEL is the forecast tensor's own 70x80 PM2.5
 * field. It is a forecast rather than an observation, so the panel names its
 * run origin - see terminal/gridApi.
 */
export type TerminalField = 'PM2.5' | 'PM10' | 'O3' | 'NOx' | 'PBL' | 'WIND' | 'MODEL';
export const TERMINAL_FIELDS: TerminalField[] = ['PM2.5', 'PM10', 'O3', 'NOx', 'PBL', 'WIND', 'MODEL'];

/**
 * Colour ramp for a value of the selected field. PBL inverts — a deep mixing
 * layer is good news, a collapsed one is not.
 */
export function fieldColor(value: number, field: TerminalField): string {
  switch (field) {
    case 'PBL':
      return value > 900 ? SEVERITY.good : value > 500 ? SEVERITY.moderate : value > 250 ? SEVERITY.poor : SEVERITY.bad;
    case 'O3':
      return value > 120 ? SEVERITY.bad : value > 80 ? SEVERITY.poor : value > 45 ? SEVERITY.moderate : SEVERITY.good;
    case 'NOx':
      return value > 140 ? SEVERITY.severe : value > 90 ? SEVERITY.bad : value > 55 ? SEVERITY.poor : SEVERITY.good;
    case 'WIND':
      return value > 4 ? SEVERITY.good : value > 2.5 ? SEVERITY.fair : value > 1.2 ? SEVERITY.moderate : SEVERITY.bad;
    default:
      return pm25Color(value);
  }
}

/**
 * Atmospheric dispersion ramp for the map overlay.
 *
 * Deliberately separate from `AQI_RAMP`: that one is categorical and must stay
 * readable as discrete bands on pins, tables and zone tiles. This one is a
 * continuous field ramp — clean air reads as cyan rather than green so it
 * recedes against the dark basemap, and the loaded end runs orange → red →
 * crimson so hotspot cores stay legible where blobs pile up.
 *
 * Alpha climbs with intensity: the outer wash stays light enough to read roads
 * and labels through, cores approach opaque.
 */
export const DISPERSION_STOPS: [number, string][] = [
  [0.0, 'rgba(8, 145, 178, 0)'],
  [0.08, 'rgba(34, 211, 238, 0.34)'],
  [0.22, 'rgba(103, 232, 249, 0.44)'],
  [0.38, 'rgba(190, 242, 180, 0.5)'],
  [0.5, 'rgba(250, 204, 21, 0.58)'],
  [0.63, 'rgba(249, 115, 22, 0.66)'],
  [0.76, 'rgba(239, 68, 68, 0.74)'],
  [0.88, 'rgba(185, 28, 28, 0.82)'],
  [1.0, 'rgba(127, 29, 29, 0.88)'],
];

/** The same ramp as a CSS gradient, so the legend cannot drift from the map. */
export function dispersionGradientCss(direction = '90deg') {
  return `linear-gradient(${direction}, ${DISPERSION_STOPS.map(
    ([t, c]) => `${c} ${(t * 100).toFixed(0)}%`,
  ).join(', ')})`;
}

/**
 * Normalised 0-1 intensity for the heat field. PBL inverts — a deep mixing
 * layer means clean air, so it has to read at the cyan end of the ramp.
 */
export function fieldIntensity(
  sample: { pm25: number; o3: number; nox: number; pbl: number; windSpeed: number },
  field: TerminalField,
): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  switch (field) {
    // Never reached for MODEL: that field is painted cell by cell from the
    // forecast grid and never goes through a station sample. Listed so the
    // switch stays exhaustive if someone adds a case above.
    case 'MODEL':
      return clamp(sample.pm25 / 120);
    case 'PM10':
      return clamp((sample.pm25 * 1.74) / 210);
    case 'O3':
      return clamp(sample.o3 / 130);
    case 'NOx':
      return clamp(sample.nox / 150);
    case 'PBL':
      return clamp(1 - sample.pbl / 1000);
    case 'WIND':
      return clamp(1 - sample.windSpeed / 6);
    default:
      return clamp(sample.pm25 / 120);
  }
}

export type TerminalAlert = 'NONE' | 'WATCH' | 'ALERT' | 'EMERGENCY';

export const TERMINAL_ALERT_COLOR: Record<TerminalAlert, string> = {
  NONE: SEVERITY.good,
  WATCH: SEVERITY.moderate,
  ALERT: SEVERITY.poor,
  EMERGENCY: SEVERITY.bad,
};

/**
 * Operational alert stage for an AQI.
 *
 * Aligned to GRAP, the Graded Response Action Plan the NCR actually runs on —
 * Stage I at Poor (201), Stage II at Very Poor (301), Stage III at Severe
 * (401). The previous thresholds (130 / 155 / 175) sat inside what CPCB calls
 * Moderate, so the map raised an EMERGENCY over air the standard does not
 * consider unhealthy for the general population.
 */
export function alertForAqi(aqi: number): TerminalAlert {
  if (aqi > 400) return 'EMERGENCY';
  if (aqi > 300) return 'ALERT';
  if (aqi > 200) return 'WATCH';
  return 'NONE';
}
