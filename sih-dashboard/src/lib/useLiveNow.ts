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
  /** The worst station's own CPCB AQI. Not a mean; see the note on `sectors`. */
  aqi: number;
  /** The instrument reporting it. */
  station: string;
  /** How many stations in the sector, so the pill can say what it chose from. */
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
  /**
   * The four compass sectors, each reporting its worst station this hour.
   *
   * Worst rather than a mean, and this is the figure two different views were
   * computing two different ways. The globe's pills took the maximum; this
   * strip took the average; and because a sector's average sits far below its
   * worst, the same page showed North as 182 on a wide screen and 24 on a
   * narrow one. One source now, so they cannot disagree again.
   *
   * Worst is the right one to keep. A landing page is read for a few seconds,
   * and in those seconds "how bad is the north" has one answer - the number a
   * reader would act on. A mean answers a question nobody asked and hides the
   * station that matters: a sector with one hazardous node and six clean ones
   * averages to fine.
   *
   * The station's name travels with it, because "the worst in the north" is
   * unfalsifiable without saying which instrument said so.
   */
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

    // Only stations reporting this hour, which `useFreshStations` has already
    // narrowed to. It matters here more than anywhere: the globe's pills were
    // reading the whole mesh, so every one of the four was quoting an archive
    // station from nine days earlier - 182, 151, 141, 133 - under a header
    // that said LIVE. The live maxima that hour were 38, 97, 63 and 22.
    const sectors = SECTORS.map((zone) => {
      const inZone = live.filter((s) => s.zone === zone);
      let worst: (typeof inZone)[number] | null = null;
      for (const s of inZone) if (!worst || s.aqi > worst.aqi) worst = s;
      return worst == null
        ? null
        : {
            zone,
            aqi: worst.aqi,
            station: worst.name,
            count: inZone.length,
            color: aqiColor(worst.aqi),
          };
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
