/**
 * Static content for the Live Telemetry overview.
 *
 * Readings, thresholds and copy that the overview renders but does not
 * compute. Kept out of the components so the numbers live in one place and a
 * future API swap has an obvious seam.
 */
import { AQI_RAMP, bandForAqi } from './bands';
import { SEVERITY } from '@/lib/tokens';
import { TERM } from '@/lib/terminal/palette';

export const HUB = {
  name: 'Anand Vihar Hub-04',
  sector: 'Anand Vihar Sector 4',
  station: 'Station Anand Vihar #04 • Sector 4',
  aqi: 142,
  /**
   * Both were invented category names — "Moderate-High" is not a CPCB band at
   * all, and "Unhealthy for Sensitive Groups" is the US EPA's label for a range
   * CPCB simply calls Moderate. Derived from the reading now, so the gauge's
   * caption and the legend beside it cannot disagree.
   */
  get band() {
    return bandForAqi(this.aqi).label;
  },
  get advisoryBand() {
    return `${bandForAqi(this.aqi).label} air quality`;
  },
  delta: 8.4,
  updatedSeconds: 12,
  ping: '18ms',
  uptime: '99.98%',
  min24: 88,
  max24: 176,
  dominant: 'PM2.5 (68 µg/m³)',
  confidence: 'Synthetic sample',
  sampleRate: 'Demo cadence',
} as const;

/**
 * CPCB National AQI categories, shown beside the hero gauge.
 *
 * Was the US EPA scale — Sensitive Groups / Unhealthy / Very Unhealthy over
 * 50-point bands. This project computes the CPCB index end to end
 * (backend/aqi_cpcb.py), and the two standards disagree on both the names and
 * the boundaries: CPCB's Moderate runs 101-200 where EPA splits the same range
 * into two categories. Showing EPA labels over a CPCB number misreports every
 * reading above 100.
 *
 * Derived from AQI_RAMP rather than restated, so the gauge, the pins, the
 * table and this legend cannot drift apart.
 */
export const CPCB_SCALE = AQI_RAMP.map((b) => ({
  label: b.label,
  range: `${b.from} – ${b.to}`,
  color: b.color,
  from: b.from,
  to: b.to,
}));

/** Biometric impact meters in the advisory card. */
export const BIOMETRIC_IMPACTS = [
  { label: 'Respiratory', level: 'Elevated', pct: 72, color: SEVERITY.poor },
  { label: 'Cardio', level: 'Moderate', pct: 54, color: SEVERITY.moderate },
  { label: 'Eye Stress', level: 'High Dust', pct: 68, color: SEVERITY.poor },
  { label: 'Outdoor Run', level: 'Restricted', pct: 84, color: SEVERITY.bad },
] as const;

export const ADVISORY_TEXT =
  'Sensitive individuals (children, elderly, asthmatics) should reduce prolonged outdoor exertion. Wear N95 masks outdoors, keep air purifiers active, and maintain sealed windows during morning peaks.';

/** Six KPI micro-cards. `series` drives the sparkline. */
export const KPI_CARDS = [
  { label: 'PM2.5 Dust', value: '68', unit: 'µg/m³', delta: 12.4, color: SEVERITY.poor, series: [44, 47, 43, 52, 58, 61, 57, 68] },
  { label: 'PM10 Coarse', value: '118', unit: 'µg/m³', delta: 8.1, color: SEVERITY.moderate, series: [96, 101, 98, 106, 110, 108, 114, 118] },
  { label: 'Ambient Temp', value: '29.4', unit: '°C', delta: -2.2, color: SEVERITY.fair, series: [33, 32.4, 31.8, 31, 30.6, 30.1, 29.8, 29.4] },
  { label: 'Humidity', value: '64', unit: '%', delta: 4.6, color: TERM.secondary, series: [54, 56, 58, 57, 60, 62, 63, 64] },
  { label: 'Wind Vector', value: '11.2', unit: 'km/h NW', delta: -1.4, color: TERM.secondary, series: [14, 13.4, 12.8, 12.2, 11.8, 11.4, 11.1, 11.2] },
  { label: 'Optical Vis', value: '2.4', unit: 'km', delta: -6.8, color: SEVERITY.bad, series: [3.6, 3.4, 3.1, 2.9, 2.8, 2.6, 2.5, 2.4] },
] as const;

export type PollutantReading = {
  id: string;
  symbol: string;
  name: string;
  value: number;
  unit: string;
  reference: string;
  pct: number;
  delta: number;
  status: string;
  color: string;
  note: string;
  /** 24h trajectory, 2-hour bins — revealed on hover. */
  trend: number[];
};

/**
 * The eight-channel chemical grid, also the rows of the ledger.
 *
 * These are the eight the CPCB National AQI indexes — PM2.5, PM10, NO2, SO2,
 * CO, O3, NH3, Pb — matching BREAKPOINTS in backend/aqi_cpcb.py. This grid
 * used to carry CO2 in place of NO2, which was wrong twice over: CO2 has no
 * CPCB breakpoint table and so cannot contribute a sub-index, and dropping
 * NO2 removed the vehicular marker that matters most in an NCR winter.
 *
 * NO2 sits at 68 µg/m³ against the 80 µg/m³ 24-hour standard — a sub-index of
 * about 85, which stays below the 142 shown on the hero, so PM2.5 remains the
 * prominent pollutant and the two screens still agree.
 */
export const POLLUTANTS: PollutantReading[] = [
  { id: 'pm25', symbol: 'PM2.5', name: 'Fine Particulate', value: 68, unit: 'µg/m³', reference: '< 30', pct: 78, delta: 12.4, status: 'Unhealthy', color: SEVERITY.poor, note: 'Threshold Exceeded', trend: [44, 47, 43, 52, 58, 61, 55, 64, 66, 67, 68, 68] },
  { id: 'pm10', symbol: 'PM10', name: 'Coarse Particulate', value: 118, unit: 'µg/m³', reference: '< 60', pct: 68, delta: 8.1, status: 'Poor', color: SEVERITY.moderate, note: 'Threshold Exceeded', trend: [92, 96, 99, 104, 101, 108, 112, 109, 114, 116, 117, 118] },
  { id: 'nh3', symbol: 'NH₃', name: 'Ammonia', value: 41, unit: 'µg/m³', reference: '< 400', pct: 18, delta: -2.6, status: 'Normal', color: SEVERITY.good, note: 'Within Limits', trend: [46, 45, 44, 44, 43, 42, 43, 42, 41, 41, 41, 41] },
  { id: 'o3', symbol: 'O₃', name: 'Ground Ozone', value: 41, unit: 'µg/m³', reference: '< 100', pct: 34, delta: 5.2, status: 'Normal', color: SEVERITY.good, note: 'Within Limits', trend: [22, 26, 31, 36, 44, 51, 55, 52, 47, 44, 42, 41] },
  { id: 'pb', symbol: 'Pb', name: 'Lead Aerosol', value: 0.42, unit: 'µg/m³', reference: '< 1.0', pct: 42, delta: 1.1, status: 'Normal', color: SEVERITY.good, note: 'Within Limits', trend: [0.38, 0.39, 0.4, 0.39, 0.41, 0.42, 0.41, 0.42, 0.42, 0.43, 0.42, 0.42] },
  { id: 'so2', symbol: 'SO₂', name: 'Sulphur Dioxide', value: 22, unit: 'µg/m³', reference: '< 80', pct: 28, delta: 3.4, status: 'Normal', color: SEVERITY.good, note: 'Within Limits', trend: [17, 18, 19, 18, 20, 21, 20, 21, 22, 22, 23, 22] },
  { id: 'co', symbol: 'CO', name: 'Carbon Monoxide', value: 1.8, unit: 'mg/m³', reference: '< 2.0', pct: 62, delta: 6.9, status: 'Elevated', color: SEVERITY.moderate, note: 'Approaching Limit', trend: [1.2, 1.3, 1.4, 1.4, 1.5, 1.6, 1.6, 1.7, 1.7, 1.8, 1.8, 1.8] },
  { id: 'no2', symbol: 'NO₂', name: 'Nitrogen Dioxide', value: 68, unit: 'µg/m³', reference: '< 80', pct: 85, delta: 5.7, status: 'Elevated', color: SEVERITY.moderate, note: 'Vehicular Peak', trend: [44, 47, 51, 50, 54, 57, 59, 62, 63, 66, 67, 68] },
];

/** Stressor contribution to the composite index. */
export const STRESSORS = [
  { label: 'PM2.5', share: 38, color: SEVERITY.poor },
  { label: 'PM10', share: 24, color: SEVERITY.moderate },
  { label: 'NO₂', share: 14, color: SEVERITY.fair },
  { label: 'O₃', share: 11, color: TERM.secondary },
  { label: 'Other', share: 13, color: TERM.outline },
] as const;

/** 30-day exposure frequency, days spent in each band. */
export const EXPOSURE_HISTORY = [
  { label: 'Good', days: 2, color: SEVERITY.good },
  { label: 'Moderate', days: 6, color: SEVERITY.fair },
  { label: 'Sensitive', days: 13, color: SEVERITY.poor },
  { label: 'Unhealthy', days: 7, color: SEVERITY.bad },
  { label: 'Severe', days: 2, color: SEVERITY.severe },
] as const;

/** Composite AQI trace for the temporal panel, 24 points. */
export const TEMPORAL_TRACE = [
  96, 102, 110, 118, 126, 131, 138, 144, 149, 152, 147, 139,
  128, 121, 118, 124, 132, 141, 148, 154, 151, 147, 144, 142,
];

export const INCIDENTS = [
  {
    level: 'CRITICAL' as const,
    time: '13:42 IST',
    zone: 'NORTH ZONE',
    station: 'wazirpur',
    text: 'PM2.5 plume front advancing from NW — 22 km² affected along the Bawana → Wazirpur → Anand Vihar corridor',
  },
  {
    level: 'WARNING' as const,
    time: '12:08 IST',
    zone: 'REGION-WIDE',
    station: 'anand-vihar',
    text: 'Thermal inversion at 412 m suppressing vertical dispersion — bowl retention now 3.4 days',
  },
  {
    level: 'ADVISORY' as const,
    time: '09:15 IST',
    zone: 'GURUGRAM',
    station: 'teri-gram',
    text: 'Node TERI Gram Gwal Pahari reporting 4.2% optical variance — recalibration queued',
  },
];

export const COVERAGE_KPIS = [
  { label: 'Mesh Coverage', value: '94.2', unit: '%', color: TERM.primary, series: [88, 89, 90, 91, 92, 93, 94, 94.2] },
  { label: 'Interpolation Confidence', value: '96.8', unit: '%', color: TERM.secondary, series: [93, 94, 93.5, 95, 95.4, 96, 96.4, 96.8] },
  { label: 'Spatial Resolution', value: '250', unit: 'm', color: TERM.outline, series: [250, 250, 250, 250, 250, 250, 250, 250] },
  { label: 'Last Full Sweep', value: '12', unit: 's ago', color: SEVERITY.poor, series: [9, 14, 8, 16, 11, 15, 10, 12] },
] as const;

/**
 * Footer strip. It claims no conformance, and that is deliberate: EN 16450 and
 * EPA CFR 40 are real instrument standards, and nothing here is the output of
 * an accredited analyser - the readings are CPCB's own published bulletin,
 * re-indexed and re-drawn. Claiming an accreditation the project does not hold
 * is a credibility risk in front of anyone who knows the standard, so the
 * safest thing this strip can do is name the sources and stop there.
 */
export const CERTIFICATIONS = [
  'STATION LIST: CPCB / DPCC / HSPCB / UPPCB',
  'SIH ID26082 · NCMRWF',
] as const;

export const LOCATIONS = [
  'Delhi NCR - Anand Vihar (Sector 4)',
  'Delhi NCR - Connaught Place',
  'Delhi NCR - Wazirpur Industrial',
  'Delhi NCR - Hauz Khas Corridor',
] as const;
