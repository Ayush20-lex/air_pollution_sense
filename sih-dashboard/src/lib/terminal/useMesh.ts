/**
 * One source of truth for what the public terminal is showing, and where it
 * came from.
 *
 * The terminal used to render `STATIONS` directly — 26 nodes at real
 * coordinates with hand-written readings. This fetches the archive's own
 * measurements, merges them onto the curated mesh and hands every consumer the
 * same merged list, so the map, the rail, the table and the zone rollups can
 * never disagree about what a station is reading.
 *
 * When the backend is unreachable it returns the curated list unchanged, with
 * `live: false`. That is the state the page was always in; it is now labelled.
 */
import * as React from 'react';
import { STATIONS, type Station } from './stations';
import { fetchMesh, mergeMesh, type LiveStation, type MergedMesh } from './meshApi';

/** Kept in step with the console's refresh so the two pages age together. */
const REFRESH_MS = 120_000;

export type MeshState = {
  /** The stations to render. Measured when `live`, curated when not. */
  stations: (Station | LiveStation)[];
  /** True once real measurements are on screen. */
  live: boolean;
  status: 'loading' | 'live' | 'offline';
  /** The hour every reading describes. Null offline. */
  asOf: string | null;
  /** e.g. "CPCB National AQI (2014)". Null offline. */
  index: string | null;
  /** Why this AQI differs from the console's. Null offline. */
  note: string | null;
  /** Curated nodes with no counterpart in the archive. */
  dropped: string[];
  /** Pollutants withheld from the index, and why. */
  excluded: Record<string, string>;
  /** Nodes in the curated mesh, for "22 of 26" style reporting. */
  curatedCount: number;
};

const OFFLINE: MeshState = {
  stations: STATIONS,
  live: false,
  status: 'loading',
  asOf: null,
  index: null,
  note: null,
  dropped: [],
  excluded: {},
  curatedCount: STATIONS.length,
};

/**
 * Module-level so every consumer shares one fetch and one answer.
 *
 * Six components render the mesh. A hook holding its own state would give each
 * of them a separate request and, worse, a separate merge — the map could show
 * one set of readings while the table below it showed another during a refresh.
 */
let current: MeshState = OFFLINE;
const listeners = new Set<() => void>();
let started = false;

function publish(next: MeshState) {
  current = next;
  listeners.forEach((l) => l());
}

async function refresh(force = false) {
  // The recurring poll skips a hidden tab - nobody is reading it, and Render's
  // free instance has a finite number of hours. The *first* fetch is not
  // optional though: gating it meant a page opened in a background tab never
  // asked for measurements at all and sat on the hand-written mesh, labelled
  // "demo values", until something happened to make it visible.
  if (!force && document.visibilityState !== 'visible') return;
  const payload = await fetchMesh();
  if (!payload) {
    // Keep whatever is on screen. If real readings already arrived they stay —
    // stale measurements are still measurements, and reverting to the
    // hand-written list would be a step backwards, not a safe default.
    publish({ ...current, status: 'offline' });
    return;
  }
  const merged: MergedMesh = mergeMesh(payload);
  if (merged.stations.length === 0) {
    publish({ ...current, status: 'offline' });
    return;
  }
  publish({
    stations: merged.stations,
    live: true,
    status: 'live',
    asOf: merged.as_of,
    index: merged.index,
    note: merged.note,
    dropped: merged.dropped,
    excluded: merged.excluded,
    curatedCount: STATIONS.length,
  });
}

function start() {
  if (started) return;
  started = true;
  void refresh(true);
  setInterval(() => void refresh(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !current.live) void refresh(true);
  });
}

export function useMesh(): MeshState {
  const subscribe = React.useCallback((cb: () => void) => {
    start();
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () => current,
    () => OFFLINE,
  );
}
