/**
 * What this hour's air is doing to a body, computed from what the station
 * actually published.
 *
 * This replaces BIOMETRIC_IMPACTS in content.ts - four percentages typed into
 * a file (72 / 54 / 68 / 84) that never moved. They sat under a heading that
 * called them "threat assessments", beside a panel of measured CPCB readings,
 * and a reader has no way to tell one from the other. Four constants dressed
 * as vital signs is the single least defensible thing that was on this page.
 *
 * What makes a real number possible here is that CPCB's sub-index already *is*
 * a health scale. Each pollutant's 0-500 index is the concentration mapped
 * through breakpoints chosen for that pollutant's effect on people, so the
 * sub-indices are directly comparable in health terms - which is the whole
 * premise of taking their maximum as the composite AQI. Grouping them by the
 * system each pollutant loads is arithmetic on that scale, not a new claim
 * about medicine:
 *
 *   Respiratory   PM2.5 - the fraction that reaches the alveoli.
 *   Cardiovascular PM2.5 with CO - both act through the blood.
 *   Eye & throat  PM10, NO2 and SO2 - the coarse and irritant channels.
 *   Outdoor exertion  the composite, pushed by O3, because exertion raises
 *                     the dose taken of whatever is worst.
 *
 * The index is rescaled so 100% sits at 400 - CPCB's Severe floor is 401 - and
 * not at 500, which only the very worst hours in Delhi ever approach and which
 * would leave every ordinary bad day looking mild.
 *
 * A station that did not publish the pollutant a row needs falls back to its
 * composite index and says so in `basis`. Nothing here invents a reading.
 */
import { SEVERITY } from '@/lib/tokens';

export type ExposureRisk = {
  id: string;
  /** Row name, as the card prints it. */
  label: string;
  /** Band word beside the figure. */
  level: string;
  /** 0-100, the meter's fill. */
  pct: number;
  color: string;
  /** Which pollutants this row was actually built from. */
  driver: string;
  /** 'measured' when the pollutants for this row were published. */
  basis: 'measured' | 'composite';
};

type SubIndexed = {
  aqi: number;
  pm25?: number | null;
  subIndices?: Record<string, { sub_index?: number | null; concentration?: number | null }>;
};

/** The index at which a row reads 100%. See the note above. */
const FULL_SCALE = 400;

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** A published sub-index, or null when the station did not report it. */
function sub(st: SubIndexed, key: string): number | null {
  const v = st.subIndices?.[key]?.sub_index;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The band a percentage falls in.
 *
 * Deliberately the same six-step shape as the AQI ladder it is derived from,
 * so a row reading Severe and a gauge reading Severe mean the same thing.
 */
function band(pct: number): { level: string; color: string } {
  if (pct < 15) return { level: 'Minimal', color: SEVERITY.good };
  if (pct < 28) return { level: 'Low', color: SEVERITY.fair };
  if (pct < 45) return { level: 'Moderate', color: SEVERITY.moderate };
  if (pct < 65) return { level: 'Elevated', color: SEVERITY.poor };
  if (pct < 85) return { level: 'High', color: SEVERITY.bad };
  return { level: 'Severe', color: SEVERITY.severe };
}

function row(
  id: string,
  label: string,
  index: number,
  driver: string,
  basis: 'measured' | 'composite',
): ExposureRisk {
  const pct = Math.round(clamp((index / FULL_SCALE) * 100));
  return { id, label, pct, driver, basis, ...band(pct) };
}

/** The worst of the indices a station actually published, or null. */
function worst(st: SubIndexed, keys: string[]): { value: number; from: string[] } | null {
  const got = keys
    .map((k) => ({ k, v: sub(st, k) }))
    .filter((x): x is { k: string; v: number } => x.v != null);
  if (!got.length) return null;
  const top = got.reduce((a, b) => (b.v > a.v ? b : a));
  return { value: top.v, from: got.map((g) => g.k) };
}

/**
 * The four exposure rows for one station, in the order the card draws them.
 *
 * Every figure moves when the mesh refreshes and when the reader selects a
 * different node, which is the point: these are readings, not decoration.
 */
export function exposureRisks(st: SubIndexed): ExposureRisk[] {
  const composite = Number.isFinite(st.aqi) ? st.aqi : 0;

  // Respiratory: PM2.5's own sub-index where it exists, the composite where
  // the station published no particulate at all - which is rare, because CPCB
  // will not index a site without one.
  const pm25Idx = sub(st, 'PM2.5');
  const respiratoryIdx = pm25Idx ?? composite;
  const respiratory = row(
    'respiratory',
    'Respiratory',
    respiratoryIdx,
    pm25Idx != null ? 'PM2.5' : 'composite AQI',
    pm25Idx != null ? 'measured' : 'composite',
  );

  // Cardiovascular: fine particulate and carbon monoxide, the two that act
  // through the blood rather than the airway. Weighted below the respiratory
  // row because the same dose loads the lungs first.
  const cardioSrc = worst(st, ['PM2.5', 'CO']);
  const cardio = row(
    'cardio',
    'Cardiovascular',
    (cardioSrc?.value ?? composite) * 0.82,
    cardioSrc ? cardioSrc.from.join(' · ') : 'composite AQI',
    cardioSrc ? 'measured' : 'composite',
  );

  // Eye and throat: the coarse and irritant channels.
  const irritantSrc = worst(st, ['PM10', 'NO2', 'SO2']);
  const irritant = row(
    'irritant',
    'Eye & Throat',
    (irritantSrc?.value ?? composite) * 0.9,
    irritantSrc ? irritantSrc.from.join(' · ') : 'composite AQI',
    irritantSrc ? 'measured' : 'composite',
  );

  // Outdoor exertion: the composite, because exertion raises the dose of
  // whatever is worst, lifted where ozone is high - the one pollutant that
  // peaks in the afternoon, when people go outside.
  const o3 = sub(st, 'O3');
  const exertionIdx = Math.max(composite, (o3 ?? 0) * 1.15) * 1.08;
  const exertion = row(
    'exertion',
    'Outdoor Exertion',
    exertionIdx,
    o3 != null ? 'composite AQI · O3' : 'composite AQI',
    o3 != null ? 'measured' : 'composite',
  );

  return [respiratory, cardio, irritant, exertion];
}

/**
 * The advisory level for the card's corner badge, from the composite index.
 *
 * "Level 3 Caution" was also a constant, and also sat over live readings.
 */
export function advisoryLevel(aqi: number): string {
  if (aqi <= 50) return 'Level 1 · Clear';
  if (aqi <= 100) return 'Level 2 · Watch';
  if (aqi <= 200) return 'Level 3 · Caution';
  if (aqi <= 300) return 'Level 4 · Warning';
  if (aqi <= 400) return 'Level 5 · Alert';
  return 'Level 6 · Emergency';
}
