import { motion } from 'framer-motion';

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)' },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

/** Big HUD readout: label over a monospaced value with unit. */
export function TelemetryStat({
  label,
  value,
  unit,
  accent,
  delta,
  delay = 0,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  delta?: string;
  delay?: number;
}) {
  return (
    <motion.div {...fade(delay)} className="group relative rounded-r-lg border-l border-hairline/60 px-3 py-2 transition-colors duration-300 hover:border-accent/70 hover:bg-elevated/40">
      <div className="hud-label">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-3xl font-semibold tabular-nums tracking-tight"
          style={{ color: accent ?? 'rgb(var(--as-ink))' }}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-2xs text-faint">{unit}</span>}
      </div>
      {delta && (
        <div className="mt-0.5 font-mono text-2xs tabular-nums text-faint">{delta}</div>
      )}
    </motion.div>
  );
}
