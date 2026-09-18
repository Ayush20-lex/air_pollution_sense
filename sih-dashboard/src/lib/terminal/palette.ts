/**
 * Terminal palette as JS values.
 *
 * Used for SVG `fill`/`stroke` attributes and canvas 2D contexts where CSS
 * variables can't reach directly. The palette now comes in light and dark
 * variants, with a resolver function that reads the current theme.
 */

const TERM_DARK = {
  primary: '#4edea3',
  secondary: '#7bd0ff',
  tertiary: '#a855f7',
  bgDeep: '#04101d',
  surfaceLowest: '#010f1f',
  surfaceLow: '#101f30',
  surfaceRaised: '#162335',
  surfaceHigh: '#1c2b3c',
  outline: '#64748b',
  outlineVariant: '#233549',
  ink: '#f1f5f9',
  inkVariant: '#94a3b8',
} as const;

const TERM_LIGHT = {
  primary: '#059669',
  secondary: '#0284c7',
  tertiary: '#7c3aed',
  bgDeep: '#f8fafc',
  surfaceLowest: '#f1f5f9',
  surfaceLow: '#e2e8f0',
  surfaceRaised: '#e8ecf2',
  surfaceHigh: '#f1f5f9',
  outline: '#94a3b8',
  outlineVariant: '#cbd5e1',
  ink: '#0f172a',
  inkVariant: '#475569',
} as const;

/**
 * Keys come from the dark palette, values widen to `string`. Without the
 * widening `as const` pins each value to its own literal type, so the light
 * palette — same keys, different hexes — fails to satisfy it.
 */
export type TermPalette = { readonly [K in keyof typeof TERM_DARK]: string };

/** Returns true if the page is currently in dark mode. */
function isDark(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark');
}

/**
 * Resolves the current terminal palette based on the active theme.
 * Call at render time in components that pass colours to SVG/canvas.
 */
export function getTermPalette(): TermPalette {
  return isDark() ? TERM_DARK : TERM_LIGHT;
}

/**
 * Legacy export — kept for call sites that only need a snapshot.
 * Reads the current theme at import time. Prefer `getTermPalette()` in
 * components that need to react to theme changes.
 */
export const TERM = new Proxy({} as TermPalette, {
  get(_target, prop: string) {
    const palette = getTermPalette();
    return palette[prop as keyof TermPalette];
  },
});

/**
 * Severity ramp for the plume and dispersion views. Distinct from the console's
 * SEVERITY in @/lib/tokens — these are the raw values the SVG and canvas layers
 * need, and they must stay identical in both themes so a reading never changes
 * meaning with the surface it sits on.
 */
export const TERM_SEVERITY = {
  caution: '#facc15',
  elevated: '#f59e0b',
  high: '#f97316',
  highSoft: '#fb923c',
  severe: '#ef4444',
} as const;
