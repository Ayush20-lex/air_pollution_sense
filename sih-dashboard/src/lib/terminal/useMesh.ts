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
import { useTerminalStore } from '@/store/useTerminalStore';

/** Kept in step with the console's refresh so the two pages age together. */
const REFRESH_MS = 120_000;

/**
 * Backoff after a failed attempt, before settling back to REFRESH_MS. Same
 * curve and same reason as forecast-status: a cold Render instance takes about
 * 90 seconds to wake and the fetch gives up after 8, so the first request of
 * the day always fails and a flat two-minute poll leaves the mesh on
 * hand-written values for the whole of that window.
 */
const RETRY_MS = [4_000, 8_000, 15_000, 30_000, 60_000];

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
  /**
   * Which feed answered: "waqi_live" for the real-time CPCB stations,
   * "archive" for the replayed window. The distinction is the whole point of
   * carrying it - the archive publishes about 42 hours behind, and a page that
   * cannot say which one it is showing is making the stronger claim by default.
   */
  feed: 'waqi_live' | 'archive' | null;
  /**
   * Stations carried from the archive to fill out the map, because only about
   * 24 of the network's 56 indexable sites report to the live feed in a given
   * hour. They are drawn differently and excluded from every aggregate; see
   * `freshStations`.
   */
  supplemented: number;
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
  feed: null,
  supplemented: 0,
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
    feed: merged.source === 'waqi_live' ? 'waqi_live' : 'archive',
    supplemented: merged.supplemented,
  });
}

function start() {
  if (started) return;
  started = true;

  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Self-scheduling rather than a fixed interval, so the delay can depend on
  // whether the last attempt actually worked.
  const tick = async (force = false) => {
    await refresh(force);
    const ok = current.live && current.status === 'live';
    failures = ok ? 0 : failures + 1;
    const wait = ok
      ? REFRESH_MS
      : RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
    // Retries run even in a hidden tab; see forecast-status for why. Once a
    // fetch succeeds the schedule drops back to the visibility-gated poll.
    timer = setTimeout(() => void tick(failures > 0), wait);
  };

  void tick(true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !current.live) {
      if (timer) clearTimeout(timer);
      void tick(true);
    }
  });
}

/**
 * The stations an aggregate may be computed from.
 *
 * A blended mesh carries two clocks: live stations at this hour and archived
 * ones at the archive's, about 42 hours back. Showing both on a map is honest
 * because each pin says which it is, but averaging across them is not - a
 * range, a zone mean or an interpolated plume surface would silently be a
 * mixture of two times, and nothing on screen could reveal it.
 *
 * So anything derived from more than one station uses this. When no station is
 * marked live - the pure archive, or the offline curated list - every station
 * shares one clock and they are all returned.
 */
export function freshStations(
  stations: (Station | LiveStation)[],
): (Station | LiveStation)[] {
  const live = stations.filter((s) => 'freshness' in s && s.freshness === 'live');
  return live.length ? live : stations;
}

/** Hook form of `freshStations`, for the map's field and contour layers. */
export function useFreshStations(): (Station | LiveStation)[] {
  const { stations } = useMesh();
  return React.useMemo(() => freshStations(stations), [stations]);
}

/** True when this station is speaking for the archive's hour, not this one. */
export function isStale(s: Station | LiveStation): boolean {
  return 'freshness' in s && s.freshness === 'archive';
}

/** True when this station carries the archive's own measurements. */
export function isLive(s: Station | LiveStation): s is LiveStation {
  return 'meshId' in s;
}

/**
 * The node the overview reports against.
 *
 * `master` marks it in the curated list, so the hero follows the same station
 * whether the readings are measured or the offline fallback. Falls back to the
 * worst node if the master has no counterpart in the archive that hour —
 * better a real station than an empty gauge.
 */
export function useHubStation(): { station: Station | LiveStation; live: boolean } {
  const { live } = useMesh();
  // The hero reports one station's number as the city's, so it has to be one
  // of the current ones - an archived master would headline a two-day-old AQI.
  const stations = useFreshStations();
  const selectedId = useTerminalStore((s) => s.selectedId);

  // The header's picker and the map's selection are the same choice, so they
  // share one id. Falling through rather than pinning to it: the curated
  // master is the default and does not exist in every feed, and a selection
  // made against one feed can be gone after a refresh against another.
  const chosen = stations.find((s) => s.id === selectedId);
  const master = stations.find((s) => s.master);
  const station =
    chosen ?? master ?? [...stations].sort((a, b) => b.aqi - a.aqi)[0] ?? STATIONS[0];
  return { station, live: live && isLive(station) };
}

/**
 * Every current station, worst first, for the header's picker.
 *
 * Worst first because that is the order someone scanning for a problem wants,
 * and because the list is long enough - 79 on the CPCB feed - that alphabetical
 * would bury the one station anybody is looking for.
 */
export function useStationOptions(): { id: string; label: string; aqi: number }[] {
  const stations = useFreshStations();
  return React.useMemo(
    () =>
      [...stations]
        .sort((a, b) => b.aqi - a.aqi)
        .map((s) => ({ id: s.id, label: `${s.name} — ${s.zone}`, aqi: s.aqi })),
    [stations],
  );
}

/** Lowest and highest index across the mesh this hour. Measured when live. */
export function useMeshRange(): { low: number; high: number; count: number } {
  const stations = useFreshStations();
  const values = stations.map((s) => s.aqi);
  return {
    low: values.length ? Math.min(...values) : 0,
    high: values.length ? Math.max(...values) : 0,
    count: values.length,
  };
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
