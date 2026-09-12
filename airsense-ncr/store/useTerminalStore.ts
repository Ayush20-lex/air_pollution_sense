'use client';

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
  stepFrame: (delta: number) => void;

  playing: boolean;
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;

  rate: PlaybackRate;
  setRate: (r: PlaybackRate) => void;

  selectedId: string;
  select: (id: string) => void;

  query: string;
  setQuery: (q: string) => void;
};

const LAST_FRAME = FRAME_COUNT - 1;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  layers: { heatmap: true, contours: true, tracks: true, wind: true, pins: true },
  toggleLayer: (l) => set((s) => ({ layers: { ...s.layers, [l]: !s.layers[l] } })),

  field: 'PM2.5',
  setField: (field) => set({ field }),

  frameIndex: LAST_FRAME,
  setFrameIndex: (i) => set({ frameIndex: Math.max(0, Math.min(LAST_FRAME, Math.round(i))) }),
  stepFrame: (delta) => get().setFrameIndex(get().frameIndex + delta),

  playing: false,
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPlaying: (playing) => set({ playing }),

  rate: 1,
  setRate: (rate) => set({ rate }),

  selectedId: MASTER_STATION.id,
  select: (selectedId) => set({ selectedId }),

  query: '',
  setQuery: (query) => set({ query }),
}));
