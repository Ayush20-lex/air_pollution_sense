/**
 * Terminal palette as JS values.
 *
 * The terminal's colours live in tailwind.config.ts under the `term-` key, but
 * a Tailwind class cannot reach an SVG `fill` / `stroke` attribute or a canvas
 * 2D context. Before this module those call sites carried raw hex — 59 of them
 * across the geo views — so the palette had two sources of truth and changing
 * the accent updated only half the surface.
 *
 * These are the same values the Tailwind config declares, named the same way.
 * Change one, change the other.
 *
 * Deliberately literal rather than read from CSS custom properties: the
 * terminal is dark-only by design (see terminal.css) and does not follow the
 * console's light/dark swap, so there is nothing to resolve at runtime.
 */
export const TERM = {
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
  ink: '#ffffff',
  inkVariant: '#94a3b8',
} as const;

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
