import * as React from 'react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';

/**
 * Hand-off curtain between the intro and the public terminal.
 *
 * The intro fires this the moment "Scan NCR" is pressed and it stays up until
 * the route actually changes, so the aerosol field never cuts to a blank frame
 * mid-navigation. It settles on the terminal's own ground (#040e1a) rather
 * than the intro's, so arrival reads as one continuous move.
 */

const STEPS = [
  'Linking open telemetry mesh',
  'Resolving 26 regional nodes',
  'Interpolating spatial field',
  'Terminal ready',
];

export function ScanTransition({ active }: { active: boolean }) {
  const [step, setStep] = React.useState(0);
  const reduced = usePrefersReducedMotion();

  // Driven by timers, not by render. The step is a position in a timed
  // sequence, so there is nothing to derive from props.
  // oxlint-disable-next-line react/set-state-in-effect
  React.useEffect(() => {
    if (!active) {
      // Rewinds the sequence when the curtain closes, so a second scan starts
      // from the first step rather than wherever the last one stopped.
      // oxlint-disable-next-line react/set-state-in-effect
      setStep(0);
      return;
    }
    const timers = STEPS.map((_, i) => setTimeout(() => setStep(i), i * 380));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  if (!active) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.2 : 0.55, ease: 'easeOut' }}
      // Covers the whole window and swallows input so a second press cannot
      // queue a second navigation.
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
      style={{ background: '#040e1a' }}
      role="status"
      aria-live="polite"
      aria-label="Opening live telemetry terminal"
    >
      {!reduced && (
        <>
          {/* expanding mint bloom, as if the mesh were coming online */}
          <motion.div
            initial={{ scale: 0.2, opacity: 0.5 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute size-[42vmin] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(78,222,163,0.35), transparent 70%)' }}
          />
          {/* single scan sweep down the frame */}
          <motion.div
            initial={{ y: '-40vh', opacity: 0 }}
            animate={{ y: '60vh', opacity: [0, 0.9, 0] }}
            transition={{ duration: 1.3, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-x-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, #4edea3, transparent)' }}
          />
        </>
      )}

      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        <div className="relative flex size-14 items-center justify-center rounded-2xl border border-[#4edea3]/40 bg-[#4edea3]/10 text-[#4edea3]">
          <Radio className="size-6" />
          {!reduced && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0.8 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
              className="absolute inset-0 rounded-2xl border border-[#4edea3]"
            />
          )}
        </div>

        <div className="space-y-1">
          <div className="font-mono text-sm font-bold uppercase tracking-[0.28em] text-[#4edea3]">
            AIR AQI Sense
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Public open environmental intelligence terminal
          </div>
        </div>

        {/* progress rail */}
        <div className="h-px w-56 overflow-hidden bg-[#233549]">
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: reduced ? 0.3 : 1.5, ease: 'easeInOut' }}
            className="h-full"
            style={{ background: '#4edea3' }}
          />
        </div>

        <div className="h-4 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
          {STEPS[step]}
        </div>
      </div>
    </motion.div>
  );
}
