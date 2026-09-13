import * as React from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * An odometer readout: the value glides to its target and each digit column
 * rolls with it.
 *
 * The console's hero readout, and the only caller. Its sibling is
 * `@/components/terminal/MeshOdometer`, which serves the public terminal: that
 * one runs every instance off one shared rAF ticker with CSS transitions, so a
 * 26-row table costs one frame loop rather than 26. This one drives framer
 * MotionValues per digit, which buys the colour tween and the carry gating
 * below, and is worth it for a single large readout but not for a table.
 *
 * Pick by surface: console here, terminal there. They used to share a name.
 *
 * Replaces the previous approach of keying a motion.div on its own value, which
 * remounted the element on every change and replayed the enter animation. At a
 * 900ms playback tick that re-fire read as a blink.
 *
 * Columns are driven straight from one MotionValue, so a running animation
 * never re-renders React — only the transforms update. The offset for the
 * column at 10^p is (value / 10^p) mod 10, taken continuously rather than
 * rounded, which is what makes the units column spin while the hundreds column
 * sits still and only moves as it carries.
 *
 * Sizing is in `em`, so the component inherits whatever font-size it is given.
 */

/** Digit strip: 0-9 plus a repeated 0 so the 9 -> 0 wrap has somewhere to go. */
const STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/** Fraction of a digit's span after which a higher column starts to carry. */
const CARRY_START = 0.9;

function DigitColumn({
  value,
  place,
  showFrom,
}: {
  value: MotionValue<number>;
  /** 1 for units, 10 for tens, 100 for hundreds. */
  place: number;
  /** Below this the column is a leading zero and fades out. */
  showFrom: number;
}) {
  const y = useTransform(value, (v) => {
    const scaled = Math.max(0, v) / place;

    // The units column rolls continuously — that is the motion you actually
    // read. Higher columns must NOT: at 81 a naive (v/10)%10 leaves the tens
    // column resting at 8.1, showing a tenth of a 9 under the 8 and looking
    // smeared. A real odometer holds its digit and only turns as the column
    // below it carries, so the roll is gated to the last tenth.
    if (place === 1) return `${-(scaled % 10)}em`;

    const digit = Math.floor(scaled) % 10;
    const within = scaled % 1;
    const carry = within > CARRY_START ? (within - CARRY_START) / (1 - CARRY_START) : 0;
    return `${-(digit + carry)}em`;
  });

  // Leading zeros are hidden rather than shown: an AQI of 98 should read "98",
  // not "098". The fade spans one unit of this column's place so crossing 100
  // reveals the hundreds column smoothly instead of popping it in.
  const opacity = useTransform(
    value,
    [showFrom - showFrom * 0.15, showFrom],
    [0, 1],
    { clamp: true },
  );

  return (
    <motion.span
      aria-hidden
      style={{ opacity: place === 1 ? 1 : opacity }}
      className="relative inline-block h-[1em] overflow-hidden"
    >
      <motion.span style={{ y }} className="flex flex-col">
        {STRIP.map((d, i) => (
          <span key={i} className="flex h-[1em] items-center justify-center leading-none">
            {d}
          </span>
        ))}
      </motion.span>
    </motion.span>
  );
}

export function RollingNumber({
  value,
  durationMs = 450,
  digits = 3,
  color,
  className,
  label,
}: {
  value: number;
  /** Must be shorter than the interval between updates, or the value never lands. */
  durationMs?: number;
  /** Fixed column count — keeps the readout from reflowing as it crosses 100. */
  digits?: number;
  /** Tweened alongside the number so a band change does not snap. */
  color?: string;
  className?: string;
  /** Read out to assistive tech, which should not see the digit strips. */
  label?: string;
}) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);

  React.useEffect(() => {
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, {
      duration: durationMs / 1000,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [value, durationMs, reduced, mv]);

  const places = React.useMemo(
    () => Array.from({ length: digits }, (_, i) => 10 ** (digits - 1 - i)),
    [digits],
  );

  return (
    <motion.span
      role="img"
      aria-label={label ?? String(Math.round(value))}
      animate={color ? { color } : undefined}
      transition={{ duration: durationMs / 1000, ease: 'easeOut' }}
      className={cn('inline-flex tabular-nums leading-none', className)}
      style={color && reduced ? { color } : undefined}
    >
      {places.map((place) => (
        <DigitColumn key={place} value={mv} place={place} showFrom={place} />
      ))}
    </motion.span>
  );
}
