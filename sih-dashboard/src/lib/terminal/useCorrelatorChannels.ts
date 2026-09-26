/**
 * City-mean hourly series per pollutant, for the multi-pollutant correlator.
 *
 * The correlator used to draw `POLLUTANTS[].trend` from content.ts — eight
 * twelve-point arrays written by hand. They never moved, because nothing ever
 * wrote to them: PM2.5 climbed 44→68 and NH3 slid 46→41 on every load, on
 * every deployment, whatever the air was doing. Everything else on the page
 * had been put on the mesh; this panel was still a drawing of one.
 *
 * The mesh publishes what it needs: each station carries `hourly`, the window
 * its sub-indices were computed from, keyed by lowercase pollutant. Averaging
 * across stations per hour gives a city channel with a real shape - O3 peaking
 * through the afternoon, PM2.5 dipping at midday and building again after
 * dark.
 *
 * Two things this is careful about.
 *
 * It prefers `hourly_readings` stations, and on this feed that decides which
 * clock the panel speaks for. The two properties turn out to be the same
 * split: the 24 live stations all publish `rolling_24h_mean`, the 49 archive
 * ones all publish `hourly_readings`. So the live set carries a 24-hour mean
 * sampled hourly - a curve that has had a day's worth of averaging run over
 * it, which is to say almost no shape at all - and a correlator drawn from it
 * would be four nearly flat lines over a panel whose entire subject is the
 * shape of a channel and how the channels move against each other.
 *
 * The archive set has the real signal: O3 climbing through the afternoon and
 * falling away after dark, PM2.5 dipping at midday and rebuilding overnight.
 * So that is what is drawn, and `kind` is returned so the panel can say the
 * window is the archive's rather than imply it is this hour. Note this is not
 * the mixing `freshStations` exists to prevent - every station here shares one
 * clock, it is simply not the clock on the wall.
 *
 * If a deployment ever has no instantaneous stations, the rolling set is used
 * rather than drawing nothing, and `kind` says so.
 *
 * Gaps stay gaps. An hour no station reported is null, not interpolated and
 * not zero, and the caller breaks the line there. The mesh is careful to send
 * QC-rejected readings as null rather than closing over them; spending that
 * care and then drawing a straight line through the hole would be worse than
 * not having it.
 */
import * as React from 'react';
import { isLive, useMesh } from '@/lib/terminal/useMesh';
import { useTermTheme } from '@/lib/terminal/palette';

/** How many trailing hours the panel plots. */
const WINDOW_HOURS = 24;

export type CorrelatorChannel = {
  /** Matches POLLUTANTS[].id, so the panel keeps its colours and symbols. */
  id: string;
  /** The mesh's key for this pollutant; absent from `hourly` means unmeasured. */
  key: string;
  /** Hourly city means, oldest first. Null where nothing reported. */
  series: (number | null)[];
  /** Stations behind the series. Zero means the archive has no channel here. */
  stations: number;
  /** True when at least two hours carry a reading — one point draws nothing. */
  measured: boolean;
  /** This channel's identity colour in the current theme. */
  color: string;
};

/** Which series the channels were built from. See the note above. */
export type CorrelatorKind = 'hourly' | 'rolling' | 'none';

/**
 * Line colours for the correlator, which are identity and not severity.
 *
 * POLLUTANTS carries a severity colour per pollutant, which is right on the
 * cards - it says how bad this reading is. Here it collides: PM10 and NO2 are
 * both SEVERITY.moderate, so two channels drew in the same #FFCC00 and the
 * chart could not be read at all. O3 and NH3 share SEVERITY.good the same way.
 * A correlator is asking which line is which, so the scale has to be
 * categorical.
 *
 * Two ramps because a line is not text but still has to be seen: the 400-level
 * hues that carry on the dark card wash out on the white one.
 */
const CHANNEL_HUES: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    pm25: '#fb923c',
    pm10: '#facc15',
    o3: '#4ade80',
    no2: '#60a5fa',
    so2: '#c084fc',
    co: '#2dd4bf',
    nh3: '#f472b6',
    pb: '#94a3b8',
  },
  light: {
    pm25: '#c2410c',
    pm10: '#a16207',
    o3: '#15803d',
    no2: '#1d4ed8',
    so2: '#7e22ce',
    co: '#0f766e',
    nh3: '#be185d',
    pb: '#475569',
  },
};

/** POLLUTANTS ids to the mesh's lowercase hourly keys. */
const CHANNEL_KEY: Record<string, string> = {
  pm25: 'pm25',
  pm10: 'pm10',
  o3: 'o3',
  no2: 'no2',
  so2: 'so2',
  co: 'co',
  nh3: 'nh3',
  pb: 'pb',
};

export function useCorrelatorChannels(ids: string[]): {
  channels: Record<string, CorrelatorChannel>;
  /** Stations contributing to the richest channel, for the panel's subtitle. */
  stationCount: number;
  kind: CorrelatorKind;
} {
  const { stations } = useMesh();
  const theme = useTermTheme();

  return React.useMemo(() => {
    const hues = CHANNEL_HUES[theme];
    // Every station, not `freshStations`: the instantaneous series live on the
    // archive half of the mesh, which that helper filters away whenever any
    // station is live. See the note above.
    const live = stations.filter(isLive);
    const hourly = live.filter((s) => s.historyKind === 'hourly_readings');
    const source = hourly.length ? hourly : live;
    const kind: CorrelatorKind = hourly.length
      ? 'hourly'
      : live.length
        ? 'rolling'
        : 'none';

    const channels: Record<string, CorrelatorChannel> = {};
    let stationCount = 0;

    for (const id of ids) {
      const key = CHANNEL_KEY[id] ?? id;
      const rows = source
        .map((s) => s.hourly?.[key])
        .filter(
          (r): r is (number | null)[] =>
            Array.isArray(r) && r.some((v) => v != null),
        );

      const color = hues[id] ?? hues.pb;

      if (!rows.length) {
        channels[id] = { id, key, series: [], stations: 0, measured: false, color };
        continue;
      }

      // Right-aligned. The rows are the same window but not guaranteed the
      // same length, and they share an end - this hour - not a start, so the
      // last N of each line up and the first N would not.
      const len = Math.max(...rows.map((r) => r.length));
      const from = Math.max(0, len - WINDOW_HOURS);
      const series: (number | null)[] = [];
      for (let i = from; i < len; i++) {
        const vals = rows
          .map((r) => r[i])
          .filter((v): v is number => v != null && Number.isFinite(v));
        series.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
      }

      const measured = series.filter((v) => v != null).length >= 2;
      channels[id] = { id, key, series, stations: rows.length, measured, color };
      if (measured) stationCount = Math.max(stationCount, rows.length);
    }

    return { channels, stationCount, kind };
  }, [stations, ids, theme]);
}
