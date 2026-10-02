import { motion } from 'framer-motion';

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 14, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(4px)' },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
});

/** Big HUD readout: Pure white in light mode, preserved dark:bg-slate-900/60 in dark mode. */
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
    <motion.div
      {...fade(delay)}
      className="group relative rounded-md border-l-2 border-slate-300 bg-white px-3.5 py-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-600 hover:shadow-md hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none dark:hover:-translate-y-0.5 dark:hover:border-cyan-400 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30"
    >
      <div className="font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-100"
          style={{ color: accent ?? undefined }}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{unit}</span>}
      </div>
      {delta && (
        <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">{delta}</div>
      )}
    </motion.div>
  );
}
