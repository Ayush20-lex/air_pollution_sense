/**
 * What the air is doing right now, for the landing page.
 *
 * The hero used to read `frames[0]` - the backend forecast. That forecast
 * replays an archive whose newest origin is 2026-09-19, so on 25 September the
 * first screen of the site was still showing 19 September's numbers: PM2.5 104,
 * the four sectors at 86/103/114/114, unchanged for six days, with nothing on
 * screen to say so. Those are the numbers a judge sees first.
 *
 * The station mesh is genuinely current, so the observed quantities come from
 * there instead. PM2.5 is each station's own reading - a published
 * concentration where CPCB gives one, otherwise its published PM2.5 sub-index
 * inverted through CPCB's table (see terminal/pm25Basis), never the composite
 * AQI scaled by a constant.
 *
 * Boundary layer and inversion are deliberately NOT here. No station measures
 * them; they are modelled quantities and the only source for them is the
 * forecast. Rather than dress a six-day-old PBL as "now", the caller keeps
 * those from the model and labels them as forecast - see IntroScreen.
 */
import * as React from 'react';
import { aqiColor } from '@/lib/aqi';
import { isLive, useFreshStations } from '@/lib/terminal/useMesh';
import { stationPm25 } from '@/lib/terminal/pm25Basis';
import type { TerminalZone } from '@/lib/terminal/stations';

export type LiveSector = {
  zone: TerminalZone;
  /** Mean CPCB AQI across the zone's reporting stations. */
  aqi: number;
  /** How many stations that mean is built from. */
  count: number;
  color: string;
};

export type LiveNow = {
  /** City mean PM2.5 in µg/m³, or null when nothing published one. */
  pm25: number | null;
  /** Mean CPCB AQI across every reporting station. */
  aqi: number | null;
  /** Stations behind those means. */
  stations: number;
  /** The four compass sectors, worst first. Empty until the mesh answers. */
  sectors: LiveSector[];
  /** True once real measurements are on screen. */
  live: boolean;
};

/** Sectors the landing page names, in the order it draws them. */
const SECTORS: TerminalZone[] = ['North', 'East', 'South', 'West'];

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function useLiveNow(): LiveNow {
  const stations = useFreshStations();

  return React.useMemo(() => {
    const live = stations.filter(isLive);
    if (!live.length) {
      return { pm25: null, aqi: null, stations: 0, sectors: [], live: false };
    }

    // Only stations that actually published a PM2.5. A station reporting no
    // particulate has nothing to contribute to a particulate mean.
    const pm = live
      .map((s) => stationPm25(s).value)
      .filter((v): v is number => typeof v === 'number');

    const sectors = SECTORS.map((zone) => {
      const inZone = live.filter((s) => s.zone === zone);
      const a = mean(inZone.map((s) => s.aqi));
      return a == null
        ? null
        : { zone, aqi: Math.round(a), count: inZone.length, color: aqiColor(a) };
    }).filter((x): x is LiveSector => x !== null);

    return {
      pm25: mean(pm),
      aqi: mean(live.map((s) => s.aqi)),
      stations: live.length,
      sectors,
      live: true,
    };
  }, [stations]);
}
