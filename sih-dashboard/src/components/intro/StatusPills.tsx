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
 * Each names the worst-reading station in its sector and shows that station's
 * own AQI. Before this the pill carried a district's synthetic figure under a
 * "DELHI-NCR-NORTH" label, which named a region and measured nothing in it -
 * there is no instrument at "NCR North".
 *
 * The worst rather than a rotation through the sector. A landing page is read
 * for a few seconds, and in those seconds "how bad is the north" has one
 * answer; cycling through fourteen stations made the same pill say 156 then
 * 146 then 141 and left a reader with no figure to carry away. It still moves,
 * but only when the mesh does - a new worst station takes the pill when it
 * overtakes, which is the pill reporting rather than animating.
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

/** The sector a slot speaks for, for anything that has to agree with a pill. */
export function sectorForSlot(id: string): string | undefined {
  return SLOTS.find((s) => s.id === id)?.sector;
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
            >
              <span className="relative flex h-2 w-2">
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
              </span>

              <span className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-ink">
                {slot.sector}
                <span className="text-faint"> — </span>
                {station.name}
              </span>

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
