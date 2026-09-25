import * as React from 'react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { useTermPalette, useTermTheme } from '@/lib/terminal/palette';

/**
 * Hand-off curtain between the intro and the public terminal.
 *
 * The intro fires this the moment "Scan NCR" is pressed and it stays up until
 * the route actually changes, so the aerosol field never cuts to a blank frame
 * mid-navigation. It settles on the terminal's own ground rather than the
 * intro's, so arrival reads as one continuous move.
 *
 * Every colour here follows the theme, which is what makes that claim survive
 * the light one: the curtain used to hand a light-mode reader from a white
 * intro, through a near-black panel, onto a white terminal. Not through
 * terminal.css's `--t-*` tokens, though they say the same thing — that sheet
 * is imported by TerminalLayout so it ships with the terminal chunk, and the
 * curtain is the one piece of the terminal's look that is painted while the
 * reader is still on the intro and the sheet has not loaded. So the two
 * grounds are named here, and the rest comes from the palette module.
 */

/** `--t-bg` from terminal.css, which is the surface this curtain lands on. */
const GROUND = { dark: '#040e1a', light: '#f8fafc' };

const STEPS = [
  'Linking open telemetry mesh',
  'Resolving 26 regional nodes',
  'Interpolating spatial field',
  'Terminal ready',
];

export function ScanTransition({ active }: { active: boolean }) {
  const [step, setStep] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const term = useTermPalette();
  const ground = GROUND[useTermTheme()];

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
      style={{ background: ground }}
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
            style={{
              background: `radial-gradient(circle, ${term.primary}59, transparent 70%)`,
            }}
          />
          {/* single scan sweep down the frame */}
          <motion.div
            initial={{ y: '-40vh', opacity: 0 }}
            animate={{ y: '60vh', opacity: [0, 0.9, 0] }}
            transition={{ duration: 1.3, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-x-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${term.primary}, transparent)` }}
          />
        </>
      )}

      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        <div
          className="relative flex size-14 items-center justify-center rounded-2xl border"
          style={{
            borderColor: `${term.primary}66`,
            background: `${term.primary}1a`,
            color: term.primary,
          }}
        >
          <Radio className="size-6" />
          {!reduced && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0.8 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
              className="absolute inset-0 rounded-2xl border"
              style={{ borderColor: term.primary }}
            />
          )}
        </div>

        <div className="space-y-1">
          <div
            className="font-mono text-sm font-bold uppercase tracking-[0.28em]"
            style={{ color: term.primary }}
          >
            AIR AQI Sense
          </div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: term.outline }}
          >
            Public open environmental intelligence terminal
          </div>
        </div>

        {/* progress rail */}
        <div
          className="h-px w-56 overflow-hidden"
          style={{ background: term.outlineVariant }}
        >
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: reduced ? 0.3 : 1.5, ease: 'easeInOut' }}
            className="h-full"
            style={{ background: term.primary }}
          />
        </div>

        <div
          className="h-4 font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: term.inkVariant }}
        >
          {STEPS[step]}
        </div>
      </div>
    </motion.div>
  );
}
