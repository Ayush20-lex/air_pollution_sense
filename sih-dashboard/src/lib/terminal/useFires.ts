/**
 * One fetch of the corridor's fires, shared by everything that draws them.
 *
 * The map, the hotspot table, the arrival strip and the NCR map's ribbons all
 * need the same answer. Built as a module-level store for the same reason
 * `useMesh` is: four components each calling `fetchFires` would be four
 * requests for one truth, and they would disagree the moment one of them
 * refreshed first.
 *
 * Two windows are selectable and the distinction is load-bearing.
 *
 * `live` follows the forecast run, and for most of the year it is nearly
 * empty - the stubble season is October and November, and in September the
 * corridor carries a few dozen scattered anomalies. That emptiness is the
 * correct reading and the panels say so.
 *
 * `episode` is a real past window: the same NASA product, the same pipeline,
 * the same code, asked for 3-5 November 2025 instead of today. Its wind comes
 * from the archive's own record of those hours, so the arrival times are what
 * the flow actually implied while those fires burned. Nothing about it is
 * simulated; the only thing that changes is the date in the request. It is
 * labelled as a past episode wherever it is shown, because a real measurement
 * from last November is still not a measurement of now.
 */
import * as React from 'react';
import { fetchFires, type FireCorridor } from './firesApi';
import { deviceTier } from '@/lib/device-tier';

export type FireWindowKind = 'live' | 'episode';

export type FireWindow = {
  kind: FireWindowKind;
  /** null for the live window: the backend picks the run's own. */
  start: string | null;
  /** What the switch and the captions call it. */
  label: string;
};

/**
 * The episode every judge of this project will be shown, and why this one.
 *
 * 3-5 November 2025 is the peak of that season's burning in the corridor: 850
 * VIIRS detections, 4,475 MW of radiative power, and a north-westerly running
 * straight down the transport axis at 25 km/h. It is the day the system was
 * built for, and it is on disk in the FIRMS cache.
 */
export const EPISODE_WINDOW: FireWindow = {
  kind: 'episode',
  start: '2025-11-03',
  label: '3-5 Nov 2025 episode',
};

export const LIVE_WINDOW: FireWindow = {
  kind: 'live',
  start: null,
  label: 'Live window',
};

export type FiresState = {
  data: FireCorridor | null;
  status: 'idle' | 'loading' | 'ready' | 'offline';
  window: FireWindow;
};

/** Fires move on satellite passes, not minutes, and the backend caches 900s. */
const REFRESH_MS = 600_000;
const RETRY_MS = [5_000, 15_000, 45_000, 120_000];

/**
 * How many pixels to ask for. A weak phone draws these as canvas circles and
 * still has to hold them; the thinning keeps the strongest per ~5 km cell, so
 * a smaller cap loses infill rather than extent.
 */
const MAX_PIXELS = deviceTier() === 'low' ? 400 : 1200;

let current: FiresState = { data: null, status: 'idle', window: LIVE_WINDOW };
const listeners = new Set<() => void>();
/** One entry per window, so switching back is instant and costs nothing. */
const cache = new Map<string, FireCorridor>();
let timer: number | undefined;
let attempt = 0;
let seq = 0;

const keyOf = (w: FireWindow) => w.start ?? 'live';

function emit(next: FiresState) {
  current = next;
  listeners.forEach((l) => l());
}

async function load(window: FireWindow, force = false): Promise<void> {
  const key = keyOf(window);
  const hit = cache.get(key);
  if (hit && !force) {
    emit({ data: hit, status: 'ready', window });
    return;
  }
  // A window switch must not be overtaken by the reply to the previous one.
  const mine = ++seq;
  emit({ data: hit ?? null, status: 'loading', window });

  const data = await fetchFires({ start: window.start, maxPixels: MAX_PIXELS });
  if (mine !== seq) return;

  if (data) {
    cache.set(key, data);
    attempt = 0;
    emit({ data, status: 'ready', window });
  } else {
    emit({ data: hit ?? null, status: 'offline', window });
  }
  schedule(window);
}

function clearTimer() {
  globalThis.clearTimeout(timer);
  timer = undefined;
}

function schedule(w: FireWindow) {
  clearTimer();
  // A past episode is finished; nothing about it will change on a poll.
  if (w.kind !== 'live') return;
  const delay =
    current.status === 'offline'
      ? RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]
      : REFRESH_MS;
  timer = globalThis.setTimeout(() => {
    // A hidden tab gets the next slot rather than the fetch: nothing is on
    // screen to go stale, and this is the poll most likely to be running when
    // a phone is in someone's pocket.
    if (document.visibilityState === 'visible') void load(w, true);
    else schedule(w);
  }, delay);
}

/** Switch which window every consumer is looking at. */
export function setFireWindow(w: FireWindow): void {
  if (keyOf(w) === keyOf(current.window) && current.status !== 'idle') return;
  clearTimer();
  void load(w);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // The first consumer to mount starts the one fetch, and only then: the
  // corridor is a section most readers never scroll to, and paying for it on
  // every page load would be a request nobody asked for.
  if (current.status === 'idle') void load(current.window);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) clearTimer();
  };
}

const snapshot = () => current;

export function useFires(): FiresState {
  return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}
