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

export function useKpiCards(): KpiCard[] {
  // `fresh` is derived from the mesh and is the only station input used here;
  // subscribing to the whole mesh as well would recompute on changes that
  // cannot affect these six cards.
  const fresh = useFreshStations();
  const frames = useAppStore((st) => st.liveFrames);

  return React.useMemo(() => {
    // ── measured: the station mesh ────────────────────────────────────────
    const live = fresh.filter(isLive);

    const pm25Now = mean(live.map((s) => s.pm25 ?? NaN));
    const pm10Now = mean(live.map((s) => s.subIndices?.PM10?.concentration ?? NaN));

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
      pm25Now == null
        ? unavailable('PM2.5', 'µg/m³', SEVERITY.poor)
        : {
            label: 'PM2.5',
            value: pm25Now.toFixed(1),
            unit: 'µg/m³',
            series: cityHourly('pm25'),
            color: SEVERITY.poor,
            delta: measuredDelta,
            basis: 'measured',
            window: '24h measured',
          },
      pm10Now == null
        ? unavailable('PM10', 'µg/m³', SEVERITY.moderate)
        : {
            label: 'PM10',
            value: pm10Now.toFixed(0),
            unit: 'µg/m³',
            series: cityHourly('pm10'),
            color: SEVERITY.moderate,
            delta: null, // the payload carries a station delta, not a per-pollutant one
            basis: 'measured',
            window: '24h measured',
          },
      met('Ambient Temp', '°C', SEVERITY.fair, (f) => f.avgTemp, (v) => v.toFixed(1)),
      met('Humidity', '%', TERM.secondary, (f) => f.avgRh ?? NaN, (v) => v.toFixed(0)),
      met('Wind', `km/h ${windDirName}`.trim(), TERM.secondary,
          (f) => f.avgWind * 3.6, (v) => v.toFixed(1)),
      // Replaces the invented optical visibility. See the module note.
      met('Boundary Layer', 'm', SEVERITY.bad, (f) => f.avgPbl, (v) => v.toFixed(0)),
    ];
  }, [fresh, frames]);
}
