import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Enterprise-grade CTA button for exploring the terminal.
 * In light mode: pure white default that smoothly transitions to dark slate on hover.
 * In dark mode: dark slate with glowing cyan accents.
 */
export function ScanButton({
  onScan,
  scanning,
  className,
}: {
  onScan: () => void;
  scanning: boolean;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onScan}
      disabled={scanning}
      whileTap={{ scale: scanning ? 1 : 0.98 }}
      transition={{ duration: 0.12 }}
      className={cn(
        'group relative overflow-hidden flex h-11 w-full sm:w-auto items-center justify-center rounded-md px-6',
        // Light mode: white background with crisp border
        'border border-slate-300 bg-white text-slate-900 shadow-sm',
        'hover:border-slate-900 hover:shadow-md',
        // Dark mode: dark slate background with cyan border
        'dark:border-cyan-500/50 dark:bg-slate-900/90 dark:text-slate-100 dark:shadow-none',
        'dark:hover:border-cyan-300 dark:hover:shadow-lg dark:hover:shadow-cyan-950/40',
        'font-mono text-xs font-semibold uppercase tracking-wider',
        'transition-all duration-300 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50',
        scanning && 'cursor-default opacity-70',
        className,
      )}
    >
      {/* Sliding color fill coming in from the right:
          Dark mode -> fills with light (white)
          Light mode -> opposite: fills with dark (slate-900) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-slate-900 dark:bg-white transition-transform duration-300 ease-out-expo translate-x-full group-hover:translate-x-0"
      />

      {scanning ? (
        <span className="relative z-10 flex items-center justify-center gap-2">
          <Loader2 className="size-3.5 animate-spin text-cyan-600 transition-colors duration-300 dark:text-cyan-400" />
          <span>Opening Terminal…</span>
        </span>
      ) : (
        <span className="relative z-10 flex items-center justify-center gap-2.5 transition-colors duration-300 text-slate-900 group-hover:text-white dark:text-slate-100 dark:group-hover:text-slate-950">
          <span>EXPLORE AIR QUALITY TERMINAL</span>
          <ArrowRight className="size-3.5 text-cyan-600 transition-all duration-300 group-hover:translate-x-1 group-hover:text-cyan-300 dark:text-cyan-400 dark:group-hover:text-cyan-700" />
        </span>
      )}
    </motion.button>
  );
}
