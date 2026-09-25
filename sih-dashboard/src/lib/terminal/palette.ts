import * as React from 'react';

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
  primary: '#047857',
  secondary: '#0369a1',
  tertiary: '#7c3aed',
  bgDeep: '#f8fafc',
  surfaceLowest: '#f1f5f9',
  surfaceLow: '#e2e8f0',
  surfaceRaised: '#e8ecf2',
  surfaceHigh: '#f1f5f9',
  outline: '#64748b',
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

/**
 * Subscribes a component to theme changes and hands back the live palette.
 *
 * `TERM` resolves per read, so any render after a theme flip already picks up
 * the right hexes. The gap was that nothing told these components to render:
 * a Tailwind class restyles itself when `dark` leaves `<html>`, but an SVG
 * `stroke="#162335"` written at the last render just stays there. That left
 * the AQI dial, the donut and the rail rings drawn in dark-surface navy on a
 * white card until some unrelated state change happened to repaint them —
 * which is why the breakage looked intermittent.
 *
 * Watching the class on `<html>` rather than reading next-themes' hook: the
 * class is what `getTermPalette` itself reads, so observer and resolver cannot
 * disagree, and the subscription holds for any component regardless of where
 * it sits relative to the provider.
 */
function subscribeToTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

/**
 * The active theme, as a word. A string snapshot rather than the palette
 * object because useSyncExternalStore compares snapshots by identity, and a
 * fresh object each read would look like a change on every render and loop.
 */
export function useTermTheme(): 'light' | 'dark' {
  return React.useSyncExternalStore(
    subscribeToTheme,
    () => (isDark() ? 'dark' : 'light'),
    () => 'dark',
  );
}

export function useTermPalette(): TermPalette {
  return useTermTheme() === 'dark' ? TERM_DARK : TERM_LIGHT;
}

/**
 * Light-mode ink for the severity ramps.
 *
 * The band colours are a published convention — CPCB's yellow for Moderate,
 * orange for Poor — so the swatches, arcs, pins and heat field keep them
 * exactly in both themes, and `TERM_SEVERITY`'s note above still holds. But a
 * convention chosen to be read as a *fill* does not survive being used as
 * *ink*: measured on the light surface, #FFCC00 as text came out at 1.5:1 and
 * #A3E635 at 1.5, against the 4.5 that body text wants. The figure the whole
 * card exists to report was the least legible thing on it.
 *
 * So text and icon glyphs get a darkened step of the same hue — still
 * recognisably the Moderate yellow, now readable on white. Fills are left
 * alone, which is why this maps `color` and never `fill`, `stroke` or
 * `background`. In dark mode it is the identity function.
 */
const SEVERITY_INK: Record<string, string> = {
  // @/lib/tokens SEVERITY
  '#34c759': '#15803d',
  '#a3e635': '#4d7c0f',
  '#ffcc00': '#a16207',
  '#ff9500': '#c2410c',
  '#ff3b30': '#b91c1c',
  '#a855f7': '#7e22ce',
  // TERM_SEVERITY
  '#facc15': '#a16207',
  '#f59e0b': '#b45309',
  '#f97316': '#c2410c',
  '#fb923c': '#c2410c',
  '#ef4444': '#b91c1c',
  // @/lib/tokens SERIES
  '#22d3ee': '#0e7490',
  '#a78bfa': '#6d28d9',
  '#64748b': '#475569',
  '#94a3b8': '#64748b',
  // The plume map's "no CPCB index this hour" amber, written inline there.
  '#f0b429': '#a16207',
  // GRAP_STAGE and INVERSION_TIER, which carry their own hexes.
  '#22c55e': '#15803d',
  '#eab308': '#a16207',
};

/**
 * Returns a mapper from a ramp colour to one readable as text in the current
 * theme. A colour it does not know is passed through untouched, so a caller
 * handing it an already-dark hex or a CSS variable is safe.
 */
export function useSeverityInk(): <T extends string | undefined>(color: T) => T {
  const theme = useTermTheme();
  // `undefined` passes through as itself — a call site uses it to mean "no
  // colour of its own, inherit", and mapping it would invent one.
  return React.useCallback(
    <T extends string | undefined>(color: T): T =>
      theme === 'dark' || color === undefined
        ? color
        : ((SEVERITY_INK[color.toLowerCase()] ?? color) as T),
    [theme],
  );
}
