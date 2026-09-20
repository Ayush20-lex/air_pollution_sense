/**
 * Where the plume ribbons come from, and which of them are measured.
 *
 * `PLUME_SOURCES` in ./stations is four literals: fixed entry and target
 * coordinates and shares hardwired to 34/26/22/18. They were drawn over a live
 * wind field and pointed the same way whatever it did, which is the giveaway -
 * a real inflow turns when the wind turns.
 *
 * One of the four can now be measured. The backend carries real VIIRS fire
 * pixels over the Punjab corridor and reports what share of the forecast PM2.5
 * its smoke accounts for, so the stubble ribbon can take its direction from the
 * measured wind and its share from the measured plume. On 20 September that
 * share is 1.5%, not 34%: the literal was overstating stubble by a factor of
 * twenty on a day when the corridor is barely alight, and at the November peak
 * the same figure reads 22.7%.
 *
 * The other three have no data behind them. There is no emissions inventory in
 * this system, so industrial, vehicular and construction cannot be computed
 * from anything - they are an editorial attribution of the sectors NCR is known
 * to carry. They are kept, because dropping them would leave a reader thinking
 * stubble is the only source, and they are marked so nobody reads an estimate
 * as a measurement.
 */
import * as React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { meanBearing } from './wind';
import { NCR_CENTER, PLUME_SOURCES, type PlumeSource } from './stations';

export type LivePlumeSource = PlumeSource & {
  /** True when both the direction and the share come from the backend. */
  measured: boolean;
  /** What the number is, in a few words, for the label. */
  note: string;
};

/** The fire block the backend attaches to every forecast. */
export type FireMeta = {
  fires?: number;
  smoke_share_pct?: number;
  centroid_lat?: number;
  centroid_lon?: number;
  season?: string;
  status?: string;
};

/**
 * How far outside the city centre the inflow ribbon starts, in degrees.
 *
 * The fires themselves are 200-300 km upwind and far off the map, so drawing
 * the ribbon from their true position would put it off-screen. It starts at the
 * edge of the view instead, on the bearing the wind is actually coming from,
 * which is the honest way to show an inflow whose origin is out of frame.
 */
const ENTRY_RADIUS_DEG = 0.34;

/** Place a point at `ENTRY_RADIUS_DEG` from the centre, on a compass bearing. */
function upwindEntry(fromDeg: number): [number, number] {
  const rad = (fromDeg * Math.PI) / 180;
  return [
    NCR_CENTER[0] + Math.cos(rad) * ENTRY_RADIUS_DEG,
    // Longitude degrees are shorter than latitude ones at this latitude, so the
    // ribbon would sit closer to the centre on an easterly than a northerly if
    // this were not widened. 111/97.5 is the same ratio the mesh uses.
    NCR_CENTER[1] + Math.sin(rad) * ENTRY_RADIUS_DEG * (111 / 97.5),
  ];
}

/**
 * The four ribbons, with the stubble one replaced by measurement when the
 * backend has both a wind direction and a fire plume to offer.
 */
export function livePlumeSources(
  windFromDeg: number | null,
  fire: FireMeta | undefined,
): LivePlumeSource[] {
  const share = fire?.smoke_share_pct;
  const canMeasure = windFromDeg != null && typeof share === 'number';

  return PLUME_SOURCES.map((src): LivePlumeSource => {
    if (src.id !== 'stubble' || !canMeasure) {
      return {
        ...src,
        measured: false,
        note: src.id === 'stubble' ? 'no fire data' : 'sector estimate',
      };
    }

    const fires = fire?.fires ?? 0;
    return {
      ...src,
      // Rounded to a tenth: the share moves with the wind hour to hour and a
      // whole number would read as steadier than it is.
      share: Math.round(share * 10) / 10,
      entry: upwindEntry(windFromDeg as number),
      target: [NCR_CENTER[0], NCR_CENTER[1]],
      // Bowing the ribbon sideways made sense for a fixed arrow. A measured one
      // should lie along the wind, so it is drawn straight.
      curve: 0,
      measured: true,
      detail:
        fires > 0
          ? `${fires} VIIRS fire${fires === 1 ? '' : 's'} upwind · ${fire?.season ?? ''}`.trim()
          : 'no active fires in the corridor',
      note: 'measured',
    };
  });
}

/** "34%" for an estimate, "1.5% measured" for the real one. */
export function shareLabel(s: LivePlumeSource): string {
  return s.measured ? `${s.share}%` : `~${s.share}% est.`;
}


/**
 * The measured wind over the basin at one forecast hour.
 *
 * Bearings are averaged as unit vectors, never as numbers: 350 and 10 average
 * to 180 - due south - for two winds that are both very nearly northerly, and
 * NCR sits where the wind crosses north often enough for that to matter. The
 * districts genuinely disagree, so this is a mean of a real field rather than a
 * single reading stretched across the domain.
 *
 * Lives here rather than in a component because the rail and the map both need
 * it and two copies would eventually disagree about the same wind.
 */
export function useMeasuredWind(offset: number): { fromDeg: number; speedKmh: number } | null {
  const liveFrames = useAppStore((st) => st.liveFrames);
  return React.useMemo(() => {
    const live = liveFrames?.[Math.min(offset, (liveFrames?.length ?? 1) - 1)];
    if (!live) return null;
    const cells = Object.values(live.districts);
    const deg = meanBearing(
      cells.map((d) => d.windDir).filter((d): d is number => typeof d === 'number'),
    );
    if (deg == null) return null;
    const speeds = cells
      .map((d) => d.windSpeed)
      .filter((v): v is number => typeof v === 'number');
    // The payload is m/s and the cards have always been labelled km/h.
    const speedKmh = speeds.length
      ? (speeds.reduce((a, b) => a + b, 0) / speeds.length) * 3.6
      : 0;
    return { fromDeg: deg, speedKmh };
  }, [liveFrames, offset]);
}
