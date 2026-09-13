import { motion } from 'framer-motion';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { ALERT_COLOR, type AlertLevel } from '@/lib/aqi';
import type { Frame } from '@/lib/data';
import { DISTRICTS } from '@/lib/data';

/**
 * Floating zone pills scattered over the particle grid.
 * Positions are hand-placed so they frame the cloud rather than cover it.
 */
export const SLOTS: { id: string; top: string; left: string; delay: number }[] = [
  { id: 'ghaziabad', top: '21%', left: '61%', delay: 0.5 },
  { id: 'delhi', top: '57%', left: '20%', delay: 0.65 },
  { id: 'gurgaon', top: '25%', left: '17%', delay: 0.8 },
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
