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

/**
 * Bearing from the city centre to the fires, in compass degrees.
 *
 * This, and not the wind bearing, is where the ribbon comes from. Pointing it
 * upwind was the first thing tried and it is wrong: on 20 September the wind is
 * from about 128 degrees, so the stubble ribbon swung round to enter Delhi from
 * the south-east - from open country where nothing is burning - and asserted
 * that Punjab's smoke was arriving from the opposite direction to Punjab.
 *
 * The fires are where they are. What the wind decides is how much of their
 * smoke reaches the city, and that is already carried by the share: 0.7% on a
 * day the flow runs the wrong way, 22.7% at the November peak when it does not.
 */
function bearingToFires(lat: number, lon: number): number {
  const dLat = lat - NCR_CENTER[0];
  // Scaled to kilometres before taking the angle, or the bearing is skewed by
  // a longitude degree being shorter than a latitude one at this latitude.
  const dLon = (lon - NCR_CENTER[1]) * (97.5 / 111);
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}

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
  return closeTheBudget(rawPlumeSources(windFromDeg, fire));
}

/**
 * Scale the editorial sectors so the apportionment still sums to 100%.
 *
 * The four static shares were written as a closed budget: 34 + 26 + 22 + 18.
 * Once stubble is measured it no longer takes its 34, but the other three kept
 * theirs - so a measured 0% left the rail reading 0 + 26 + 22 + 18 = 66%, and a
 * measured 12% left it at 78%. A source apportionment that does not close
 * invites exactly one question, and it is the wrong one.
 *
 * The estimates keep their relative weights and take whatever the measured
 * share leaves. They stay marked as estimates: this makes them consistent with
 * the measurement, not more precise than they were.
 */
function closeTheBudget(sources: LivePlumeSource[]): LivePlumeSource[] {
  const measured = sources.filter((x) => x.measured);
  if (!measured.length) return sources;
  const taken = measured.reduce((a, x) => a + x.share, 0);
  const estimates = sources.filter((x) => !x.measured);
  const weight = estimates.reduce((a, x) => a + x.share, 0);
  if (weight <= 0) return sources;
  const room = Math.max(0, 100 - taken);
  return sources.map((x) =>
    x.measured ? x : { ...x, share: Math.round((x.share / weight) * room) },
  );
}

function rawPlumeSources(
  windFromDeg: number | null,
  fire: FireMeta | undefined,
): LivePlumeSource[] {
  const share = fire?.smoke_share_pct;
  const hasFires =
    typeof fire?.centroid_lat === 'number' && typeof fire?.centroid_lon === 'number';
  // The wind is still required: without it there is no measured transport
  // behind the share, and the ribbon would be a direction with no quantity.
  const canMeasure = windFromDeg != null && typeof share === 'number' && hasFires;

  // A reported zero is a measurement, not an absence.
  //
  // With no fires there is no fire centroid, so `hasFires` is false - and this
  // used to send the stubble ribbon down the editorial branch, which prints the
  // hardcoded 34%. So on a day NASA FIRMS reported zero fires in the corridor,
  // and the backend said in as many words "corridor quiet - a real zero, not a
  // missing feed", the map labelled stubble burning the single largest source
  // in the basin. The absence of a centroid was being read as the absence of
  // data. It is the opposite: it is what a measured zero looks like.
  //
  // Wind is not required for this case. There is no smoke to transport, so
  // there is no direction to measure it along.
  const measuredZero =
    typeof share === 'number' && share === 0 && (fire?.fires ?? 0) === 0;

  return PLUME_SOURCES.map((src): LivePlumeSource => {
    if (src.id === 'stubble' && measuredZero) {
      return {
        ...src,
        share: 0,
        measured: true,
        detail: fire?.season
          ? `no active fires in the corridor · ${fire.season}`
          : 'no active fires in the corridor',
        note: 'measured',
      };
    }
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
      entry: upwindEntry(bearingToFires(fire!.centroid_lat as number, fire!.centroid_lon as number)),
      target: [NCR_CENTER[0], NCR_CENTER[1]],
      // Bowing the ribbon sideways made sense for a fixed arrow. A measured one
      // should lie along the wind, so it is drawn straight.
      curve: 0,
      measured: true,
      detail:
        fires > 0
          ? `${fires} VIIRS fire${fires === 1 ? '' : 's'} · ${fire?.season ?? ''}`.trim()
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
