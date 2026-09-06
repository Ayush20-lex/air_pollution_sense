
import { motion } from 'framer-motion';
import { ALERT_COLOR, type AlertLevel } from '@/lib/aqi';
import { AlertIcon } from '@/components/ui/alert-icon';
import type { Frame } from '@/lib/data';
import { DISTRICTS } from '@/lib/data';

/**
 * Floating zone pills scattered over the particle grid.
 * Positions are hand-placed so they frame the cloud rather than cover it.
 *
 * They are placed as a percentage from the top while the masthead is anchored
 * to the bottom, so the two close on each other as the viewport gets shorter.
 * Keeping every slot inside the upper ~45% leaves the headline its own band:
 * `delhi` used to sit at 57% and landed on top of the title at ~700px tall.
 */
export const SLOTS: { id: string; top: string; left: string; delay: number }[] = [
  { id: 'ghaziabad', top: '21%', left: '61%', delay: 0.5 },
  { id: 'delhi', top: '43%', left: '30%', delay: 0.65 },
  { id: 'gurgaon', top: '25%', left: '17%', delay: 0.8 },
];

/** The zone ids the intro pins, in the order they appear above. */
export const PILL_IDS = SLOTS.map((s) => s.id);

export function StatusPills({
  frame,
  activeId = null,
}: {
  frame: Frame;
  /** Zone currently probed on the aerosol cloud; its pill lifts, others recede. */
  activeId?: string | null;
}) {
  return (
    <>
      {SLOTS.map((slot) => {
        const d = DISTRICTS.find((x) => x.id === slot.id)!;
        const s = frame.districts[d.id];
        const level: AlertLevel = s.alert;
        const color = ALERT_COLOR[level];

        const probed = activeId === slot.id;
        const dimmed = activeId !== null && !probed;

        return (
          <motion.div
            key={slot.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{
              opacity: dimmed ? 0.28 : 1,
              scale: probed ? 1.06 : 1,
            }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={
              activeId !== null
                ? { duration: 0.22, ease: 'easeOut' }
                : { delay: slot.delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }
            }
            className="pointer-events-none absolute z-30 hidden md:block"
            style={{ top: slot.top, left: slot.left }}
          >
            <motion.div
              // The idle bob is distracting while a band is being probed.
              animate={probed ? { y: 0 } : { y: [0, -6, 0] }}
              transition={
                probed
                  ? { duration: 0.2 }
                  : { duration: 5 + slot.delay * 3, repeat: Infinity, ease: 'easeInOut' }
              }
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-md"
              style={{
                borderColor: probed ? color : `${color}55`,
                background: probed ? `${color}26` : `${color}14`,
                boxShadow: probed ? `0 0 0 1px ${color}66, 0 8px 26px -10px ${color}` : undefined,
              }}
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
                <AlertIcon level={level} />
                {level}
              </span>
              <span className="font-mono text-2xs tabular-nums text-muted">
                {s.pm25.toFixed(0)} µg/m³
              </span>
            </motion.div>
          </motion.div>
        );
      })}
    </>
  );
}
