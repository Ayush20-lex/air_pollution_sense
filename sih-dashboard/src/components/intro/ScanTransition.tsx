import * as React from 'react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { motion } from 'framer-motion';
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
  const theme = useTermTheme();
  const ground = GROUND[theme];

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
        {/* The brand mark, in place of the generic radio tile and the two
            lines of type that stood in for it. One image rather than an icon
            plus text, because the lockup already carries the name, the region
            and the subtitle in the proportions it was drawn in - rebuilding
            that out of a Lucide glyph and two <div>s only produced something
            that had to be kept in step with it by hand.

            Two files, picked by theme. The wordmark's blue reads on either
            ground, but the "NCR Region" line is rgb(49,70,91) and measures
            1.99:1 on this curtain's near-black, which is not a subtitle so
            much as a rumour of one. The dark variant lifts exactly those
            pixels - selected by saturation, so the brand blue at S~0.97 and
            every green are untouched - to slate-300, which measures 13:1.

            Width-capped rather than sized in px: the lockup is wide, and on a
            narrow phone a fixed width would either overflow the curtain or
            leave the mark too small to read. */}
        <motion.img
          src={theme === 'dark' ? '/logo-airlytics-dark.png' : '/logo-airlytics.png'}
          alt="AirLytics — NCR Region"
          initial={reduced ? undefined : { opacity: 0, scale: 0.96 }}
          animate={reduced ? undefined : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="h-auto w-[min(82vw,420px)] select-none"
          draggable={false}
        />

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
