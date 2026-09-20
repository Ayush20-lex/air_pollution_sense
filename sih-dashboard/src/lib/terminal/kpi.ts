/**
 * The six telemetry cards, from the backend.
 *
 * `KPI_CARDS` in ./content was six literals - PM2.5 68, PM10 118, temp 29.4,
 * humidity 64, wind 11.2, visibility 2.4 - each with a hand-written delta and
 * a hand-written eight-point sparkline. They sat at the top of the terminal and
 * read as live instrument telemetry. Every value except one was already in a
 * payload the page had fetched and was not reading.
 *
 * Two of the six are measurements and four are forecasts, and the cards say
 * which. That distinction is the whole reason this is a hook rather than a
 * constant: PM2.5 and PM10 are what the stations reported over the last 24
 * hours, while temperature, humidity, wind and boundary-layer depth come from
 * the forecast's own meteorology and describe the next 24. Printing an upward
 * arrow on a forecast field beside an upward arrow on a measured one, with no
 * mark to separate them, is how a page ends up asserting it measured the
 * weather.
 *
 * Optical visibility is gone. Nothing in this system measures or derives it -
 * it was 2.4 km because someone typed 2.4 - and the honest replacement is the
 * boundary-layer depth, which is measured, is in the payload, and is the single
 * most explanatory number this project has: a shallow layer is why Delhi's air
 * goes bad on a still night.
 */
import * as React from 'react';
import { SEVERITY } from '@/lib/tokens';
import { useAppStore } from '@/store/useAppStore';
import { TERM } from './palette';
import { isLive, useFreshStations } from './useMesh';
import { compassName } from './wind';

export type KpiCard = {
  label: string;
  value: string;
  unit: string;
  series: number[];
  color: string;
  /** Percent change, or null when nothing measured one. */
  delta: number | null;
  /** What the number is. The card prints this rather than leaving it implied. */
  basis: 'measured' | 'forecast' | 'unavailable';
  /** "24h measured" / "next 24h" - the window the series covers. */
  window: string;
};

/** Hours of forecast shown in a met card's sparkline. */
const FORECAST_SPAN = 24;

function mean(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** A card with nothing behind it says so rather than showing a stale literal. */
function unavailable(label: string, unit: string, color: string): KpiCard {
  return { label, value: '—', unit, series: [], color, delta: null,
           basis: 'unavailable', window: 'no data' };
}

/**
 * A particulate card, drawn from whatever history exists.
 *
 * The sparkline is the city's recorded window: the archive supplies a full 24
 * hours of it, and a live feed supplies however many hours the backend's
 * recorder has gathered since it started - CPCB's bulletin carries no history
 * of its own, so on a fresh box that is one point and it grows hourly.
 *
 * The window label follows the series rather than claiming 24 hours over two.
 * An empty one draws no line at all, which is the honest picture of a feed
 * whose history has not accumulated yet, and is why the card still shows its
 * current reading beside it.
 */
function particulateCard(
  label: string,
  now: { value: number; unit: string; asIndex: boolean } | null,
  series: number[],
  color: string,
  delta: number | null,
): KpiCard {
  if (now == null) return unavailable(label, 'µg/m³', color);
  return {
    label,
    value: now.value.toFixed(now.asIndex ? 0 : 1),
    unit: now.unit,
    series,
    color,
    delta,
    basis: 'measured',
    window: series.length >= 24 ? '24h measured'
          : series.length > 1 ? `${series.length}h recorded`
          : 'current reading',
  };
}

export function useKpiCards(): KpiCard[] {
  // `fresh` is derived from the mesh and is the only station input used here;
  // subscribing to the whole mesh as well would recompute on changes that
  // cannot affect these six cards.
  const fresh = useFreshStations();
  const frames = useAppStore((st) => st.liveFrames);

  return React.useMemo(() => {
    // ── measured: the station mesh ────────────────────────────────────────
    const live = fresh.filter(isLive);

    // CPCB's live bulletin publishes sub-indices and leaves `concentration`
    // null - all 74 live stations, every pollutant - while the archive carries
    // both. So a particulate card takes the concentration when there is one and
    // falls back to the sub-index, which is a different quantity and is
    // labelled as one. The rest of the page already does exactly this; showing
    // "no data" over a live feed that is reporting would be worse than either.
    const particulate = (key: 'PM2.5' | 'PM10') => {
      const conc = mean(live.map((s) => s.subIndices?.[key]?.concentration ?? NaN));
      if (conc != null) return { value: conc, unit: 'µg/m³', asIndex: false };
      const idx = mean(live.map((s) => s.subIndices?.[key]?.sub_index ?? NaN));
      if (idx != null) return { value: idx, unit: 'CPCB sub-index', asIndex: true };
      return null;
    };
    const pm25Now = particulate('PM2.5');
    const pm10Now = particulate('PM10');

    // The city's hourly window is the mean across stations at each hour, not
    // one station's series: a single node dropping out would otherwise look
    // like the city's air changing.
    const cityHourly = (key: 'pm25' | 'pm10'): number[] => {
      const rows = live.map((s) => s.hourly?.[key]).filter(Boolean) as (number | null)[][];
      if (!rows.length) return [];
      const n = Math.max(...rows.map((r) => r.length));
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const m = mean(rows.map((r) => (r[i] == null ? NaN : (r[i] as number))));
        if (m != null) out.push(m);
      }
      return out;
    };

    // Only stations that actually measured a change contribute to it.
    const deltas = live.filter((s) => s.deltaKnown).map((s) => s.delta);
    const measuredDelta = deltas.length ? mean(deltas) : null;

    // ── forecast: the frames the map already runs on ──────────────────────
    const f0 = frames?.[0];
    const span = frames ? frames.slice(0, FORECAST_SPAN) : [];
    const ahead = frames?.[Math.min(FORECAST_SPAN, (frames?.length ?? 1) - 1)];

    /** Percent change from now to the end of the forecast span. */
    const fDelta = (pick: (f: NonNullable<typeof f0>) => number): number | null => {
      if (!f0 || !ahead) return null;
      const a = pick(f0);
      const b = pick(ahead);
      return Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? ((b - a) / a) * 100 : null;
    };

    const met = (
      label: string,
      unit: string,
      color: string,
      pick: (f: NonNullable<typeof f0>) => number,
      format: (v: number) => string,
    ): KpiCard => {
      if (!f0) return unavailable(label, unit, color);
      return {
        label,
        value: format(pick(f0)),
        unit,
        series: span.map(pick).filter(Number.isFinite),
        color,
        delta: fDelta(pick),
        basis: 'forecast',
        window: `next ${FORECAST_SPAN}h`,
      };
    };

    // Wind is reported in km/h and the payload is m/s; the compass name comes
    // from the districts, averaged as vectors rather than as numbers.
    const windDirName = (() => {
      if (!f0) return '';
      const degs = Object.values(f0.districts)
        .map((d) => d.windDir)
        .filter((d): d is number => typeof d === 'number');
      if (!degs.length) return '';
      let x = 0;
      let y = 0;
      for (const d of degs) {
        const r = (d * Math.PI) / 180;
        x += Math.cos(r);
        y += Math.sin(r);
      }
      return compassName(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    })();

    return [
      particulateCard('PM2.5', pm25Now, cityHourly('pm25'), SEVERITY.poor, measuredDelta),
      // The payload carries a station-level 24h change, not a per-pollutant
      // one, so PM10 has no delta to show rather than borrowing PM2.5's.
      particulateCard('PM10', pm10Now, cityHourly('pm10'), SEVERITY.moderate, null),
      met('Ambient Temp', '°C', SEVERITY.fair, (f) => f.avgTemp, (v) => v.toFixed(1)),
      met('Humidity', '%', TERM.secondary, (f) => f.avgRh ?? NaN, (v) => v.toFixed(0)),
      met('Wind', `km/h ${windDirName}`.trim(), TERM.secondary,
          (f) => f.avgWind * 3.6, (v) => v.toFixed(1)),
      // Replaces the invented optical visibility. See the module note.
      met('Boundary Layer', 'm', SEVERITY.bad, (f) => f.avgPbl, (v) => v.toFixed(0)),
    ];
  }, [fresh, frames]);
}
