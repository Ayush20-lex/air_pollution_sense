import * as React from 'react';
import { motion } from 'framer-motion';
import { aqiBandColor } from '@/lib/aqi';
import { useLiveNow } from '@/lib/useLiveNow';

/**
 * Floating sector pills scattered over the particle grid.
 *
 * One per compass sector, each sitting on the side of the cloud that sector
 * actually lies on - north near the top, south near the bottom, east to the
 * right, west to the left. The probe card reads the nearest pill to the
 * cursor, so a pill in the wrong place would name the wrong sector.
 *
 * Each shows the highest AQI reported in its sector. Before this the pill
 * carried a district's synthetic figure; the number is now a real reading from
 * a real instrument, and the worst one in that quarter of the mesh.
 *
 * The worst rather than a rotation through the sector. A landing page is read
 * for a few seconds, and in those seconds "how bad is the north" has one
 * answer; cycling through fourteen stations made the same pill say 156 then
 * 146 then 141 and left a reader with no figure to carry away. It still moves,
 * but only when the mesh does - a new worst station takes the pill when it
 * overtakes, which is the pill reporting rather than animating.
 *
 * The station is named on the face of the pill, not just in `title`. The
 * sector alone left "the worst in the north" unfalsifiable - nothing on
 * screen said which of that sector's instruments the figure came from - and
 * `title` cannot fill that gap here: the pills are `pointer-events-none` so
 * the cursor can probe the cloud beneath them, and a browser shows no title on
 * an element it cannot hit. `elementFromPoint` at a pill's centre returns the
 * header behind it.
 *
 * The name changes with the number, because it is the same fact: whichever
 * station is reporting worst holds the pill, so a new leader brings its own
 * name with it.
 *
 * Positions are hand-placed to frame the cloud rather than cover it, and are
 * bounded by the pill: each is about 295px wide, so `left` has to leave that
 * much room at the narrowest width the page is read at.
 */
export const SLOTS: {
  id: string;
  /** The mesh zone this pill draws from, and the word it shows. */
  sector: 'North' | 'East' | 'South' | 'West';
  top: string;
  left: string;
  delay: number;
}[] = [
  { id: 'ghaziabad', sector: 'North', top: '18%', left: '56%', delay: 0.5 },
  { id: 'noida', sector: 'East', top: '44%', left: '66%', delay: 0.65 },
  { id: 'faridabad', sector: 'South', top: '62%', left: '46%', delay: 0.8 },
  { id: 'gurgaon', sector: 'West', top: '30%', left: '12%', delay: 0.95 },
];

/**
 * How a sector is written on screen.
 *
 * One function so the pill and the probe readout cannot drift: the probe maps
 * the cursor to the nearest slot precisely so the two always agree.
 *
 * Worth knowing what the wording claims. The mesh's sectors cover the NCR, not
 * the municipal city - the northern quarter includes Loni and Ghaziabad, which
 * are in Uttar Pradesh. "North Delhi" is the everyday name for that side of
 * the region rather than an administrative one.
 */
export function sectorLabel(sector: string): string {
  return `${sector} Delhi`;
}

/** The sector a slot speaks for, for anything that has to agree with a pill. */
export function sectorForSlot(id: string): string | undefined {
  const s = SLOTS.find((x) => x.id === id);
  return s && sectorLabel(s.sector);
}

/**
 * Formats a station name for compact pill displays:
 * - Converts raw all-caps names into clean Title Case
 * - Replaces any multiple dot ellipsis ("...", "..") with a proper unicode ellipsis ("…")
 * - If truncated or lengthy, formats cleanly at word boundary with "…" (e.g. "National Institute…")
 */
export function formatStationPillName(raw: string): string {
  if (!raw) return '';
  let str = raw.replace(/\.{2,}/g, '…').trim();

  // If ALL CAPS: convert to Title Case preserving known monitoring acronyms
  if (str === str.toUpperCase()) {
    str = str
      .toLowerCase()
      .split(' ')
      .map((w) => {
        if (!w) return '';
        const cleanedWord = w.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '');
        if (['cpcb', 'dpcc', 'imd', 'icar', 'hspcb', 'uppcb', 'dtu', 'nsit', 'crri', 'teri', 'iit'].includes(cleanedWord)) {
          return w.toUpperCase();
        }
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  // If already ends with ellipsis
  if (str.endsWith('…')) {
    return str;
  }

  // For long names, cleanly truncate at word boundary with proper unicode ellipsis
  if (str.length > 22) {
    const sliced = str.slice(0, 20);
    const lastSpace = sliced.lastIndexOf(' ');
    if (lastSpace > 8) {
      return str.slice(0, lastSpace).trim() + '…';
    }
    return str.slice(0, 19).trim() + '…';
  }

  return str;
}

export function StatusPills() {
  // The same source the narrow-screen sector strip reads, which it did not
  // used to be. This computed its own maximum over `useMesh().stations` - the
  // whole mesh, archive included - while the strip averaged the live ones, so
  // one page reported North as 182 and 24 at two widths. Worse, every value
  // this produced came from a station stamped nine days earlier, under a
  // header reading LIVE. See the note on `sectors` in useLiveNow.
  const { sectors } = useLiveNow();

  const worstBySector = React.useMemo(
    () => Object.fromEntries(sectors.map((s) => [s.zone, s])),
    [sectors],
  );

  return (
    <>
      {SLOTS.map((slot) => {
        const station = worstBySector[slot.sector];
        // A sector with nothing reporting renders nothing. The offline curated
        // mesh has no southern station at all, and a pill reading "South — ?"
        // would be worse than the gap it leaves.
        if (!station) return null;
        const color = aqiBandColor(station.aqi);
        const displayName = formatStationPillName(station.station);

        return (
          <motion.div
            key={slot.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ delay: slot.delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute hidden md:block"
            style={{ top: slot.top, left: slot.left }}
          >
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 5 + slot.delay * 3, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/60 dark:shadow-none"
              style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
              title={`Highest in ${sectorLabel(slot.sector)}: ${displayName} — AQI ${station.aqi}, of ${station.count} reporting`}
            >
              <span className="relative flex h-2 w-2">
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
              </span>

              <span className="font-sans text-xs font-medium text-slate-900 dark:text-slate-100">
                {sectorLabel(slot.sector)}
                <span className="text-slate-400 dark:text-slate-500"> · </span>
                <span className="inline-block max-w-[170px] truncate align-bottom text-slate-600 dark:text-slate-300">
                  {displayName}
                </span>
              </span>
              <span className="text-slate-300 dark:text-slate-600">—</span>

              {/* Keyed on the station so the figure cross-fades when a new
                  worst takes the pill, instead of the number snapping under a
                  name that changed at the same moment. */}
              <motion.span
                key={station.station}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.35 }}
                className="font-mono text-xs font-semibold tabular-nums tracking-tight"
                style={{ color }}
              >
                AQI {station.aqi}
              </motion.span>
            </motion.div>
          </motion.div>
        );
      })}
    </>
  );
}
