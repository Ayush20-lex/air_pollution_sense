
import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      whileHover={{ scale: scanning ? 1 : 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        'group relative flex h-14 items-center gap-3 overflow-hidden rounded-full border border-accent/50 bg-accent/10 px-9 font-mono text-sm font-semibold uppercase tracking-[0.28em] text-accent backdrop-blur-md transition-colors',
        'hover:bg-accent/20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base',
        !scanning && 'animate-pulse-glow',
        className,
      )}
    >
      {/* sweeping highlight */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-accent/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      {scanning ? <Loader2 className="size-4 animate-spin" /> : null}
      <span className="relative">{scanning ? 'Initialising grid' : 'Scan NCR'}</span>
      {!scanning && (
        <ArrowRight className="relative size-4 transition-transform duration-300 group-hover:translate-x-1" />
      )}
    </motion.button>
  );
}
