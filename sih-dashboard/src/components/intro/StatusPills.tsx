import * as React from 'react';
import { motion } from 'framer-motion';
import { aqiBandColor } from '@/lib/aqi';
import { useMesh } from '@/lib/terminal/useMesh';

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
 * The station's name is not on the pill. The label is the sector, so nothing
 * on screen says which of that sector's instruments the figure came from -
 * worth knowing, because "the worst in the north" is otherwise an unfalsifiable
 * claim. It is on `title` for inspection and for assistive tech, but that is
 * not a hover tooltip: these pills are `pointer-events-none` so the cursor can
 * probe the cloud beneath them, and a browser shows no title on an element it
 * cannot hit. Checked - `elementFromPoint` at a pill's centre returns the
 * header behind it, not the pill.
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

export function StatusPills() {
  const { stations } = useMesh();

  // The worst station per sector, recomputed only when the mesh changes. A
  // single pass rather than a sort: only the maximum is wanted, and four
  // sectors over eighty stations is not worth ordering all of.
  const worstBySector = React.useMemo(() => {
    const out: Record<string, (typeof stations)[number]> = {};
    for (const s of stations) {
      const held = out[s.zone];
      if (!held || s.aqi > held.aqi) out[s.zone] = s;
    }
    return out;
  }, [stations]);

  return (
    <>
      {SLOTS.map((slot) => {
        const station = worstBySector[slot.sector];
        // A sector with nothing reporting renders nothing. The offline curated
        // mesh has no southern station at all, and a pill reading "South — ?"
        // would be worse than the gap it leaves.
        if (!station) return null;
        const color = aqiBandColor(station.aqi);

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
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-md"
              style={{ borderColor: `${color}55`, background: `${color}14` }}
              title={`Highest in ${sectorLabel(slot.sector)}: ${station.name} — AQI ${station.aqi}`}
            >
              <span className="relative flex h-2 w-2">
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
              </span>

              <span className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-ink">
                {sectorLabel(slot.sector)}
              </span>
              <span className="text-faint">—</span>

              {/* Keyed on the station so the figure cross-fades when a new
                  worst takes the pill, instead of the number snapping under a
                  name that changed at the same moment. */}
              <motion.span
                key={station.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.35 }}
                className="font-mono text-2xs font-bold tabular-nums"
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
