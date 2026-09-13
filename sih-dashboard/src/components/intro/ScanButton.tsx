import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The intro's primary call to action.
 *
 * Carries the conic shine defined as `.shiny-cta` in index.css. The shine is
 * decorative, so it is dropped while scanning: once the button is disabled and
 * showing a spinner, a travelling highlight reads as though it were still
 * waiting for a click.
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
      whileTap={{ scale: scanning ? 1 : 0.97 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'group relative flex h-14 items-center gap-3 rounded-full px-9',
        'font-mono text-sm font-semibold uppercase tracking-[0.28em] text-accent',
        'backdrop-blur-md transition-colors',
        'hover:text-ink focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base',
        // While scanning the button is inert, so it keeps a plain border
        // instead of the conic one — nothing about it should invite a click.
        scanning
          ? 'cursor-default overflow-hidden border border-accent/30 bg-accent/5'
          : 'shiny-cta',
        className,
      )}
    >
      {scanning ? <Loader2 className="size-4 animate-spin" /> : null}
      <span className="relative z-[1]">{scanning ? 'Initialising grid' : 'Scan NCR'}</span>
      {!scanning && (
        <ArrowRight className="relative z-[1] size-4 transition-transform duration-300 group-hover:translate-x-1" />
      )}
    </motion.button>
  );
}
