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
  startScan: () => void;
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
  startScan: () => set({ screen: 'transition' }),
  completeScan: () => set({ screen: 'dashboard' }),
  returnToIntro: () => set({ screen: 'intro', playing: false }),

  interventions: DEFAULT_INTERVENTIONS,
  frames: initialFrames,
  hour: 0,
  pollutant: 'PM2.5',
  selectedDistrict: null,

  liveFrames: null,
  source: null,
  loadingLive: false,

  loadLiveForecast: async () => {
    if (get().loadingLive) return;
    set({ loadingLive: true });
    const live = await fetchLiveForecast();
    if (!live) {
      // Backend unreachable. Keep the synthetic frames already in place.
      set({ loadingLive: false });
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
