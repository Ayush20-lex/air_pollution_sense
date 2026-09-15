import * as React from 'react';
import { columnKeys, rollDuration, toDigits, tween } from '@/lib/terminal/rolling';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/store/useTerminalStore';

/**
 * Smooth AQI readouts for timeline playback.
 *
 * Runs every instance off a single shared rAF ticker, because GeoSections
 * renders these across a 26-row table and 26 independent frame loops is not
 * the same cost as one.
 *
 * It had a twin — `@/components/ui/rolling-number`, the console's hero
 * odometer, which drove framer MotionValues per digit with a colour tween and
 * a fixed column count. Both were called RollingNumber, which made the wrong
 * import a plausible mistake; this one was renamed to end that. The twin was
 * deleted with the console, so the name is now simply its own.
 *
 * Two treatments, because one size does not fit both jobs:
 *   `MeshOdometer`   — odometer digit columns, for the hero readout.
 *   `AnimatedNumber` — value tween as plain text, for the 50+ list and table
 *                      cells where rolling columns would be noise.
 *
 * Both are driven by one shared animation frame loop. Fifty independent rAF
 * loops would each schedule their own frame; a single ticker walking a
 * subscriber set costs one.
 */

/* ------------------------------------------------------------------ ticker */

type Tick = (now: number) => boolean;

const subscribers = new Set<Tick>();
let frame = 0;

function pump(now: number) {
  frame = 0;
  // Copy first: a subscriber may unsubscribe itself while we iterate.
  for (const tick of [...subscribers]) {
    if (!tick(now)) subscribers.delete(tick);
  }
  if (subscribers.size) frame = requestAnimationFrame(pump);
}

function subscribe(tick: Tick): () => void {
  subscribers.add(tick);
  if (!frame) frame = requestAnimationFrame(pump);
  return () => {
    subscribers.delete(tick);
  };
}

/* -------------------------------------------------------------- duration */

/** Roll duration for the current transport state. */
export function useRollDuration(): number {
  const playing = useTerminalStore((s) => s.playing);
  const rate = useTerminalStore((s) => s.rate);
  const reduced = usePrefersReducedMotion();
  return rollDuration(rate, playing, reduced);
}

/* ---------------------------------------------------------------- tween */

/**
 * Integer that eases toward `value`.
 *
 * Re-targets mid-flight from whatever is on screen rather than queueing, which
 * matters at 4x where the next frame lands before the previous roll ends. Only
 * commits state when the rounded value actually changes, so a 520ms roll over
 * five units causes five renders, not thirty.
 */
export function useAnimatedNumber(value: number, duration: number): number {
  const [shown, setShown] = React.useState(value);
  const shownRef = React.useRef(value);
  const from = React.useRef(value);
  const start = React.useRef(0);

  // The effect subscribes to the shared rAF ticker, which is exactly the
  // external system effects are for. The value cannot be derived during
  // render: it depends on elapsed time.
  // oxlint-disable-next-line react/set-state-in-effect
  React.useEffect(() => {
    if (duration <= 0) {
      shownRef.current = value;
      // Reduced motion and 12x playback both set duration to 0, where the
      // readout should jump rather than roll. Still a subscription to the
      // transport, not a value derivable from props.
      // oxlint-disable-next-line react/set-state-in-effect
      setShown(value);
      return;
    }
    if (Math.round(shownRef.current) === Math.round(value)) return;

    from.current = shownRef.current;
    start.current = performance.now();

    return subscribe((now) => {
      const t = (now - start.current) / duration;
      const next = t >= 1 ? value : tween(from.current, value, t);
      shownRef.current = next;
      const rounded = Math.round(next);
      setShown((prev) => (prev === rounded ? prev : rounded));
      return t < 1;
    });
  }, [value, duration]);

  return Math.round(shown);
}

export function AnimatedNumber({
  value,
  duration,
  className,
}: {
  value: number;
  duration: number;
  className?: string;
}) {
  const shown = useAnimatedNumber(value, duration);
  return (
    <span className={cn('tabular-nums', className)} suppressHydrationWarning>
      {shown}
    </span>
  );
}

/* ------------------------------------------------------------- odometer */

const STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Odometer readout: each digit is a 0-9 strip translated under a clipped
 * window, so changing 2 to 7 scrolls through 3-4-5-6 on the way.
 *
 * Columns are keyed from the right (`columnKeys`), so 98 -> 104 mounts a new
 * hundreds column and leaves the tens and units rolling from where they were.
 */
export function MeshOdometer({
  value,
  duration,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  duration: number;
  className?: string;
  'aria-label'?: string;
}) {
  const digits = toDigits(value);
  const keys = columnKeys(digits.length);

  return (
    <span
      className={cn('term-odo tabular-nums', className)}
      role="img"
      aria-label={ariaLabel ?? String(Math.max(0, Math.round(value)))}
    >
      {digits.map((digit, i) => (
        <span key={keys[i]} className="term-odo-col" aria-hidden="true">
          <span
            className="term-odo-strip"
            style={{
              transform: `translateY(-${digit}em)`,
              transitionDuration: `${duration}ms`,
            }}
          >
            {STRIP.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
