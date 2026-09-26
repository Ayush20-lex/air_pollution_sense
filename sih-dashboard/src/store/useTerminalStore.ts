import { create } from 'zustand';
import type { TerminalField } from '@/lib/terminal/bands';
import { FRAME_COUNT } from '@/lib/terminal/field';
import { MASTER_STATION } from '@/lib/terminal/stations';

/**
 * State for the public terminal surface.
 *
 * Deliberately separate from `useAppStore`: the console's store carries the
 * intro screen machine, the 72-hour forecast and the intervention levers,
 * none of which this read-only public surface has.
 */

export type TerminalLayer = 'heatmap' | 'contours' | 'tracks' | 'wind' | 'pins';
export type PlaybackRate = 1 | 4 | 12;

type TerminalState = {
  layers: Record<TerminalLayer, boolean>;
  toggleLayer: (l: TerminalLayer) => void;

  field: TerminalField;
  setField: (f: TerminalField) => void;

  frameIndex: number;
  setFrameIndex: (i: number) => void;

  playing: boolean;
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;

  rate: PlaybackRate;
  setRate: (r: PlaybackRate) => void;

  selectedId: string;
  select: (id: string) => void;

  query: string;
  setQuery: (q: string) => void;

  /**
   * Bumped to re-anchor the 24-frame window on the current wall clock.
   *
   * The frames are built by `buildFrames(now)` and owned by GeoMapView, but
   * the control that rebuilds them lives in the shell, so the signal has to be
   * shared. GeoMapView rebuilds whenever this changes.
   */
  refreshedAt: number;
  refresh: () => void;

  /**
   * Bumped by `resetView`, so the map can put its camera back too.
   *
   * The reset restores the selection, and the map now flies to whatever is
   * selected - which would have left "reset" zoomed in on the master station
   * rather than framing NCR. The map watches this and re-fits instead.
   */
  resetAt: number;

  /** Restores layers, field, playback and frame position to their defaults. */
  resetView: () => void;
};

const DEFAULT_LAYERS: Record<TerminalLayer, boolean> = {
  heatmap: true,
  contours: true,
  tracks: true,
  wind: true,
  pins: true,
};

const LAST_FRAME = FRAME_COUNT - 1;

/**
 * The frame the map opens on, and the one "NOW" returns to.
 *
 * Index 0 is the present: the window used to run backwards and end at now, so
 * the default sat at the last frame. It now runs forwards from now, and the
 * default moved with it.
 */
const NOW_FRAME = 0;

export const useTerminalStore = create<TerminalState>((set) => ({
  layers: { ...DEFAULT_LAYERS },
  toggleLayer: (l) => set((s) => ({ layers: { ...s.layers, [l]: !s.layers[l] } })),

  field: 'PM2.5',
  setField: (field) => set({ field }),

  frameIndex: NOW_FRAME,
  setFrameIndex: (i) => set({ frameIndex: Math.max(0, Math.min(LAST_FRAME, Math.round(i))) }),
  playing: false,
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPlaying: (playing) => set({ playing }),

  rate: 1,
  setRate: (rate) => set({ rate }),

  selectedId: MASTER_STATION.id,
  select: (selectedId) => set({ selectedId }),

  query: '',
  setQuery: (query) => set({ query }),

  refreshedAt: 0,
  refresh: () => set({ refreshedAt: Date.now() }),

  resetAt: 0,

  resetView: () =>
    set({
      resetAt: Date.now(),
      layers: { ...DEFAULT_LAYERS },
      field: 'PM2.5',
      frameIndex: NOW_FRAME,
      playing: false,
      rate: 1,
      selectedId: MASTER_STATION.id,
      query: '',
    }),
}));
