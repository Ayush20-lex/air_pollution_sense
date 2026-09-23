import { motion } from 'framer-motion';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { ALERT_COLOR, aqiColor, type AlertLevel } from '@/lib/aqi';
import type { Frame } from '@/lib/data';
import { DISTRICTS } from '@/lib/data';

/**
 * Floating zone pills scattered over the particle grid.
 *
 * One per compass sector, and each sits on the side of the cloud its district
 * actually lies on - north near the top, south near the bottom, east to the
 * right, west to the left. The probe card reads the nearest pill to the cursor,
 * so a pill in the wrong place would name the wrong zone.
 *
 * This used to be three: Ghaziabad, Delhi and Gurugram, which is north, centre
 * and west. South and east were in the data and never drawn, so half the mesh
 * was invisible on the page that introduces it - and Delhi, the one labelled
 * CENTRAL, sat at the lower left where a reader would take it for the
 * south-west.
 *
 * Positions are hand-placed to frame the cloud rather than cover it, and the
 * ordering is by bearing from Delhi: Ghaziabad is the only district north of it
 * (28.669 against 28.614), Faridabad the southernmost, Noida east, Gurugram
 * west.
 */
//
// The percentages are bounded by the pill, not just by taste: each is about
// 295px wide, so `left` has to leave that much room at the narrowest width the
// page is read at. At 74% a 1024px window put the east pill's right edge at
// 1048 and it wrapped against the frame; 66% clears it and still reads as the
// east side at 1560. `top` for the south pill is held above the headline for
// the same reason - at 72% it landed on "TWO-WAY COUPLED" on a 768px-tall
// window.
export const SLOTS: { id: string; top: string; left: string; delay: number }[] = [
  { id: 'ghaziabad', top: '18%', left: '56%', delay: 0.5 },
  { id: 'noida', top: '44%', left: '66%', delay: 0.65 },
  { id: 'faridabad', top: '62%', left: '46%', delay: 0.8 },
  { id: 'gurgaon', top: '30%', left: '12%', delay: 0.95 },
];

export function StatusPills({ frame }: { frame: Frame }) {
  return (
    <>
      {SLOTS.map((slot) => {
        const d = DISTRICTS.find((x) => x.id === slot.id)!;
        const s = frame.districts[d.id];
        const level: AlertLevel = s.alert;
        const color = ALERT_COLOR[level];

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
                {level === 'EMERGENCY' && (
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                    style={{ background: color }}
                  />
                )}
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
              </span>
              <span className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-ink">
                {d.zone}
              </span>
              <span
                className="flex items-center gap-1 font-mono text-2xs font-bold uppercase tracking-[0.14em]"
                style={{ color }}
              >
                {level === 'EMERGENCY' ? (
                  <ShieldAlert className="size-3" />
                ) : (
                  <AlertTriangle className="size-3" />
                )}
                {level}
              </span>
              {/* AQI leads, in its own band's colour rather than the pill's
                  alert colour - those are two different scales and a pill
                  reading ADVISORY in amber over an AQI of 91 should not paint
                  the 91 amber too. The concentration stays behind it, dimmed:
                  it is the measurement, AQI is what is derived from it, and
                  dropping it would leave the pill with no measured quantity
                  on it at all. */}
              <span className="flex items-baseline gap-1.5 font-mono text-2xs tabular-nums">
                <strong className="font-bold" style={{ color: aqiColor(s.aqi) }}>
                  AQI {s.aqi}
                </strong>
                <span className="text-muted">{s.pm25.toFixed(0)} µg/m³</span>
              </span>
            </motion.div>
          </motion.div>
        );
      })}
    </>
  );
}
