'use client';

import { create } from 'zustand';
import {
  DEFAULT_INTERVENTIONS,
  FORECAST_HOURS,
  buildForecast,
  type Frame,
  type Interventions,
  type Pollutant,
} from '@/lib/data';
import {
  applyInterventionRatio,
  fetchLiveForecast,
  type ForecastSource,
} from '@/lib/forecastApi';

export type Screen = 'intro' | 'transition' | 'dashboard';
export type MapLayer = 'heatmap' | 'wind' | 'plume' | 'pins';
export type PlaybackSpeed = 0.5 | 1 | 2;

type AppState = {
  /* --- navigation --- */
  screen: Screen;
  /**
   * Where the scan hands off to, if not the terminal's own front page.
   *
   * "Scan NCR" always meant /terminal, so the route was written into the
   * landing page's own effect. Picking a station from the palette has to
   * arrive somewhere else - the map, with that station selected - and it should
   * get there the same way rather than cutting straight across, which skipped
   * the disperse animation and made the same journey look like two different
   * products.
   *
   * Null is the ordinary scan. Cleared on the way back to the intro so a
   * second scan does not inherit the first one's destination.
   */
  scanTarget: string | null;
  startScan: (target?: string) => void;
  completeScan: () => void;
  returnToIntro: () => void;

  /* --- forecast state --- */
  interventions: Interventions;
  frames: Frame[];
  hour: number;
  pollutant: Pollutant;
  selectedDistrict: string | null;

  /* --- data provenance ---
     `liveFrames` holds the unmodified backend forecast. `frames` may be a
     what-if variant of it, so the baseline is kept separately rather than
     recomputed. `source` is null until the backend answers, and stays null if
     it never does — the console then runs on the synthetic generator. */
  liveFrames: Frame[] | null;
  source: ForecastSource | null;
  loadingLive: boolean;
  /**
   * Whether the backend forecast actually arrived.
   *
   * `source` alone cannot answer this: it is null both before the first fetch
   * and after a failed one, so a UI reading it cannot tell "still loading"
   * from "backend is down". The console falls back to synthetic frames on
   * failure, which looks identical to a healthy demo.
   */
  liveStatus: 'idle' | 'loading' | 'live' | 'offline';
  /**
   * When the backend last answered, as epoch ms; null until it ever has.
   *
   * `liveStatus` says whether the most recent attempt succeeded, not how long
   * ago that was. A console left open since the morning holds frames from the
   * morning while the badge still reports them in the present tense. Age is
   * the missing half of the claim.
   */
  lastFetchedAt: number | null;
  loadLiveForecast: () => Promise<void>;

  setIntervention: (key: keyof Interventions, value: number) => void;
  resetInterventions: () => void;
  setHour: (h: number) => void;
  stepHour: (delta: number) => void;
  setPollutant: (p: Pollutant) => void;
  selectDistrict: (id: string | null) => void;

  /* --- playback --- */
  playing: boolean;
  speed: PlaybackSpeed;
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (s: PlaybackSpeed) => void;

  /* --- map layers --- */
  layers: Record<MapLayer, boolean>;
  toggleLayer: (l: MapLayer) => void;

  /* --- ui --- */
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
};

const initialFrames = buildForecast(DEFAULT_INTERVENTIONS);

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'intro',
  scanTarget: null,
  // `typeof target === 'string'`, not `target ?? null`. ScanButton wires this
  // straight to onClick, so the handler is called with a click event - and
  // `(target?: string) => void` is assignable to the `() => void` the button
  // declares, so nothing objected. The event became the scan's destination,
  // `navigate(<SyntheticEvent>)` ran, and the intro handed off to a black
  // screen. Guarding here rather than only at the call sites, because the next
  // caller to wire it to a handler will make the same mistake.
  startScan: (target) =>
    set({ screen: 'transition', scanTarget: typeof target === 'string' ? target : null }),
  completeScan: () => set({ screen: 'dashboard' }),
  returnToIntro: () => set({ screen: 'intro', playing: false, scanTarget: null }),

  interventions: DEFAULT_INTERVENTIONS,
  frames: initialFrames,
  hour: 0,
  pollutant: 'PM2.5',
  selectedDistrict: null,

  liveFrames: null,
  source: null,
  loadingLive: false,
  liveStatus: 'idle',
  lastFetchedAt: null,

  loadLiveForecast: async () => {
    if (get().loadingLive) return;
    // Only the very first attempt reports "loading". Once we already know the
    // answer - offline, or live - a retry keeps showing it until the retry
    // itself resolves. Otherwise the backoff made the badge oscillate: every
    // few seconds it dropped from "Demo / Synthetic" back to "Connecting",
    // which reads as progress rather than as the repeated failure it is.
    set((st) => ({
      loadingLive: true,
      liveStatus: st.liveStatus === 'idle' ? 'loading' : st.liveStatus,
    }));
    const live = await fetchLiveForecast();
    if (!live) {
      // Backend unreachable. Keep whatever frames are in place - synthetic on a
      // first failure, real ones if an earlier fetch succeeded - and record the
      // failure so the UI can say so instead of quietly pretending.
      //
      // `source` and `lastFetchedAt` are deliberately left alone. Clearing them
      // would throw away the fact that the numbers on screen came from the
      // backend, and the badge would call real measurements synthetic.
      set({ loadingLive: false, liveStatus: 'offline' });
      return;
    }
    const { interventions } = get();
    const active =
      interventions === DEFAULT_INTERVENTIONS
        ? live.frames
        : applyInterventionRatio(live.frames, interventions);
    set({
      liveFrames: live.frames,
      source: live.source,
      frames: active,
      loadingLive: false,
      liveStatus: 'live',
      lastFetchedAt: Date.now(),
    });
  },

  setIntervention: (key, value) => {
    const interventions = { ...get().interventions, [key]: value };
    const { liveFrames } = get();
    set({
      interventions,
      frames: liveFrames
        ? applyInterventionRatio(liveFrames, interventions)
        : buildForecast(interventions),
    });
  },
  resetInterventions: () => {
    const { liveFrames } = get();
    set({
      interventions: DEFAULT_INTERVENTIONS,
      frames: liveFrames ?? buildForecast(DEFAULT_INTERVENTIONS),
    });
  },

  setHour: (h) => set({ hour: Math.max(0, Math.min(FORECAST_HOURS, Math.round(h))) }),
  stepHour: (delta) => {
    const next = get().hour + delta;
    set({ hour: ((next % (FORECAST_HOURS + 1)) + FORECAST_HOURS + 1) % (FORECAST_HOURS + 1) });
  },
  setPollutant: (pollutant) => set({ pollutant }),
  selectDistrict: (selectedDistrict) => set({ selectedDistrict }),

  playing: false,
  speed: 1,
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),

  layers: { heatmap: true, wind: false, plume: true, pins: true },
  toggleLayer: (l) => set((s) => ({ layers: { ...s.layers, [l]: !s.layers[l] } })),

  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));

/** Currently-scrubbed frame. */
export const useCurrentFrame = (): Frame => {
  const frames = useAppStore((s) => s.frames);
  const hour = useAppStore((s) => s.hour);
  return frames[Math.min(hour, frames.length - 1)];
};
