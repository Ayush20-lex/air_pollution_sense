/**
 * The pollutant grid, driven by the hub station's own measurements.
 *
 * `POLLUTANTS` in ./content carries eight cards whose numbers were typed by
 * hand. The backend indexes four of them for any given station — PM2.5, PM10,
 * NO2 and O3 — under CPCB's averaging rules, and reports the concentration it
 * indexed along with how many valid hours went into it.
 *
 * The four it measures are replaced. The four it does not (NH3, Pb, CO, SO2)
 * are marked unreported rather than left showing their literals: a card that
 * says 1.8 mg/m3 of CO beside three measured cards reads as a measurement, and
 * CO in particular is excluded from the index on purpose — the archive's unit
 * for it is contradicted by its own values.
 *
 * Offline nothing here runs and the static grid stands as before, labelled.
 */
import { POLLUTANTS, type PollutantReading } from './content';
import { aqiColor } from './bands';
import type { LiveStation } from './meshApi';

/** Card id -> the key the backend reports it under. */
const SUB_INDEX_KEY: Record<string, string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO2',
  o3: 'O3',
  so2: 'SO2',
};

export type LivePollutant = PollutantReading & {
  /** False when the archive has no reading for this pollutant. */
  measured: boolean;
  /** 0-500 CPCB sub-index. 100 is the standard. */
  subIndex?: number;
  /** Averaging window CPCB requires — 24h, or 8h for ozone. */
  windowHours?: number;
  /** Hours inside that window the station actually reported. */
  validHours?: number;
  /** The measured 24-hour window, gaps as null. Empty when not measured. */
  series: (number | null)[];
  /** What to show instead of a line when `series` has nothing in it. */
  emptyNote?: string;
  /** Printed under the line when it is not a series of hourly readings. */
  caption: string | null;
  /**
   * What the card says about the window under the chart.
   *
   * For the archive these are the same window - the chart IS the 24 hours the
   * sub-index was computed from, so "22 of 24h reported" describes both. For a
   * live station they are two different things: the sub-index comes from WAQI's
   * own 24-hour mean, while the chart is however much we have recorded. Printed
   * side by side without this, "1h recorded" and "24 of 24h reported" read as a
   * contradiction rather than as two facts about two windows.
   */
  windowNote: string;
};

/**
 * A sub-index of 100 is the standard, so the meter reads full there and stays
 * full above it rather than running off the end of the card.
 */
function meterPct(subIndex: number): number {
  return Math.max(2, Math.min(100, subIndex));
}

function statusFor(subIndex: number): { status: string; note: string } {
  if (subIndex <= 50) return { status: 'Good', note: 'Well within limits' };
  if (subIndex <= 100) return { status: 'Satisfactory', note: 'Within limits' };
  if (subIndex <= 200) return { status: 'Moderate', note: 'Threshold exceeded' };
  if (subIndex <= 300) return { status: 'Poor', note: 'Threshold exceeded' };
  if (subIndex <= 400) return { status: 'Very Poor', note: 'Threshold exceeded' };
  return { status: 'Severe', note: 'Threshold exceeded' };
}

/**
 * Measured cards first, unreported ones after — so a reader scanning the grid
 * meets the real numbers before the gaps, and the gaps stay visible rather
 * than being dropped. Dropping them would quietly change what the grid claims
 * to cover, which the heading states as eight channels.
 */
export function livePollutants(station: LiveStation): LivePollutant[] {
  const out = POLLUTANTS.map((p): LivePollutant => {
    const key = SUB_INDEX_KEY[p.id];
    const sub = key ? station.subIndices[key] : undefined;
    // Zeroed, not carried over: this card is about to say "Not reported",
    // and a hand-written 24h change printed beside that reads as a
    // measurement of something the archive has no reading for.
    if (!sub)
      return { ...p, measured: false, delta: 0, series: [], caption: null, windowNote: '' };

    const { status, note } = statusFor(sub.sub_index);
    const series = station.hourly[p.id] ?? [];
    const rolling = station.historyKind === 'rolling_24h_mean';
    const recorded = series.filter((v) => v != null).length;
    return {
      ...p,
      measured: true,
      value: sub.concentration,
      pct: meterPct(sub.sub_index),
      color: aqiColor(sub.sub_index),
      status,
      note,
      subIndex: sub.sub_index,
      windowHours: sub.window_hours,
      validHours: sub.valid_hours,
      series,
      // A live station's window is recorded by us, not fetched: WAQI's feed is
      // a single snapshot. So an empty series there is our own history not yet
      // gathered, not an instrument that failed to report, and saying "no
      // readings" would blame the sensor for it.
      emptyNote: rolling
        ? 'Live history recording — first hours appear shortly'
        : undefined,
      // Named on the chart because it is not the same quantity as the archive's
      // hourly readings; see MeshStation.history_kind.
      caption:
        rolling && recorded > 0
          ? `${recorded}h recorded · 24h rolling mean`
          : null,
      windowNote: rolling
        ? `Index from ${sub.window_hours}h mean`
        : `${sub.valid_hours} of ${sub.window_hours}h reported`,
      // Per-pollutant 24h change is not in the payload — only the station's.
      // Leaving the hand-written delta here would read as measured.
      delta: 0,
    };
  });

  return [...out.filter((p) => p.measured), ...out.filter((p) => !p.measured)];
}
