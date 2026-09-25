/**
 * Where a station's PM2.5 concentration comes from, and the figure itself.
 *
 * CPCB's live bulletin (the data.gov.in resource cpcb_live.py reads) publishes
 * one value per pollutant and that value is the sub-index, not µg/m³ - which is
 * why 74 of the live stations arrive with `concentration: null`. The map used to
 * fill that gap with the station's *composite* AQI × 0.48. Composite AQI is the
 * worst pollutant's index, often PM10's, so that was a guess at PM2.5 built
 * from a different pollutant: Alipur reported a PM2.5 index of 129 and a
 * composite of 146, and the map drew it from the 146.
 *
 * The station's own PM2.5 sub-index is on the page and is an exact function of
 * the concentration, so it is inverted here instead. This is not the lossy
 * reconstruction the backend refuses to do on the WAQI path - that crossed from
 * the US scale to the Indian one, with different breakpoints and windows. This
 * is CPCB's formula run backwards through CPCB's own table, and the only loss is
 * the integer rounding of the published index: ~0.3 µg/m³ per index point in the
 * 61-90 band, ~1.3 in the 121-250 band.
 *
 * Stations with no PM2.5 index at all report `none` and are kept out of the
 * interpolated field rather than being given a number they never published.
 */

/**
 * `estimate` exists only for the curated fallback mesh in stations.ts, which the
 * page shows when the live feed does not answer. Those entries carry an AQI and
 * no pollutant data at all, so their PM2.5 is the old composite-AQI ratio - kept
 * so the offline map still draws a field, and labelled so it is never mistaken
 * for a reading. A live station never gets this basis.
 */
export type Pm25Basis = 'measured' | 'index' | 'estimate' | 'none';

/**
 * CPCB National AQI (2014) PM2.5 breakpoints, 24-hour mean, µg/m³.
 * Row form (c_lo, c_hi, i_lo, i_hi) - identical to BREAKPOINTS['pm25'] in
 * backend/aqi_cpcb.py, whose `sub_index` this inverts. Change one, change both.
 */
const PM25_BREAKPOINTS: readonly [number, number, number, number][] = [
  [0, 30, 0, 50],
  [30, 60, 51, 100],
  [60, 90, 101, 200],
  [90, 120, 201, 300],
  [120, 250, 301, 400],
  [250, 500, 401, 500],
];

/**
 * The concentration a PM2.5 sub-index was computed from.
 *
 * The exact inverse of the backend's
 *   index = (i_hi - i_lo) / (c_hi - c_lo) * (c - c_lo) + i_lo
 * within the band the index falls in. 500 is the published cap - anything at or
 * above 500 µg/m³ - so it returns the band floor and `atCap` says so.
 */
export function pm25FromSubIndex(
  subIndex: number,
): { ugm3: number; atCap: boolean } | null {
  if (!Number.isFinite(subIndex) || subIndex < 0) return null;
  const idx = Math.min(500, subIndex);
  for (const [cLo, cHi, iLo, iHi] of PM25_BREAKPOINTS) {
    if (idx >= iLo && idx <= iHi) {
      const step = (cHi - cLo) / (iHi - iLo);
      let ugm3 = cLo + (idx - iLo) * step;
      // The first index of every band after the first needs a nudge. The table
      // is discontinuous at each shared edge: exactly 30 µg/m³ indexes as 50 -
      // the backend checks bands in order and the edge belongs to the lower one
      // - so 51 only starts just above 30 and covers (30, 30 + step/2]. Its
      // exact inverse, 30, would index back to 50. The middle of the range that
      // actually publishes 51 is cLo + step/4.
      if (idx === iLo && iLo > 0) ugm3 += step / 4;
      return { ugm3, atCap: subIndex >= 500 };
    }
  }
  return null;
}

type WithPm25 = {
  pm25?: number | null;
  subIndices?: Record<string, { sub_index?: number | null; concentration?: number | null }>;
};

/**
 * A station's PM2.5 and how it was obtained, most direct source first:
 * a published concentration, then the published PM2.5 sub-index inverted,
 * then nothing.
 */
export function stationPm25(st: WithPm25): {
  value: number | null;
  basis: Pm25Basis;
  subIndex: number | null;
} {
  const sub = st.subIndices?.['PM2.5'];
  const subIndex = typeof sub?.sub_index === 'number' ? sub.sub_index : null;

  if (typeof st.pm25 === 'number' && Number.isFinite(st.pm25)) {
    return { value: st.pm25, basis: 'measured', subIndex };
  }
  if (typeof sub?.concentration === 'number' && Number.isFinite(sub.concentration)) {
    return { value: sub.concentration, basis: 'measured', subIndex };
  }
  if (subIndex != null) {
    const inv = pm25FromSubIndex(subIndex);
    if (inv) return { value: inv.ugm3, basis: 'index', subIndex };
  }
  return { value: null, basis: 'none', subIndex: null };
}
