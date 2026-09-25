/**
 * Which frame of the forecast run is the current hour.
 *
 * The landing rail read `frames[0]` — hour zero of whatever run last landed.
 * That is the run's *origin* hour, not now. A run issued at 23:00 kept the
 * rail on its 23:00 figures for the whole of the next day, so three readouts
 * that describe the air right now never moved, whatever the clock did. A
 * reader watching them conclude, reasonably, that they are decoration.
 *
 * Frames carry `hour` as an offset from the run origin rather than a
 * timestamp, so the valid time is `origin + hour`. Hence both halves are
 * needed: the origin from `source`, the offset from the frame.
 *
 * `covers` is the other half of the honesty. A run whose horizon ended before
 * now has no current frame at all, and the nearest one is simply its last —
 * a figure from the past. The caller has to be able to say so rather than
 * print it as the present.
 */
import * as React from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { Frame } from '@/lib/data';

/** How often the hook re-reads the wall clock. */
const TICK_MS = 60_000;

const HOUR_MS = 3_600_000;

export type NowFrame = {
  frame: Frame;
  /** Index into `frames`, for callers that need to look ahead of it. */
  index: number;
  /** False when the run's horizon does not reach the current hour. */
  covers: boolean;
  /** Age of the run itself, in ms — not of the last fetch. Null offline. */
  runAgeMs: number | null;
};

/**
 * The frame whose valid time is nearest the wall clock.
 *
 * Nearest rather than the last one at or before now: frames are hourly, and
 * at 10:50 the 11:00 frame describes the air outside better than the 10:00
 * one does.
 */
export function useNowFrame(): NowFrame {
  const frames = useAppStore((s) => s.frames);
  const source = useAppStore((s) => s.source);

  // The clock is state for the same reason it is in useProvenance: read at
  // render time it would fix itself on first paint and the rail would never
  // advance, which is the bug this hook exists to fix.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return React.useMemo(() => {
    const originMs = source?.origin ? Date.parse(source.origin) : NaN;
    // No origin to measure from — a synthetic run, or a backend that did not
    // report one. Hour zero is then the only defensible answer, and the run
    // has no age to report.
    if (!Number.isFinite(originMs)) {
      return { frame: frames[0], index: 0, covers: true, runAgeMs: null };
    }

    const wanted = Math.round((now - originMs) / HOUR_MS);
    const index = Math.min(Math.max(wanted, 0), frames.length - 1);
    return {
      frame: frames[index],
      index,
      covers: wanted >= 0 && wanted <= frames.length - 1,
      runAgeMs: Math.max(now - originMs, 0),
    };
  }, [frames, source, now]);
}
