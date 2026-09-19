/**
 * Named colour tokens.
 *
 * Everything that needs a colour as a *value* — Recharts series, Leaflet
 * vectors, Three.js materials, inline SVG — reads it from here. Components
 * never write a raw hex. The CSS-facing half of the same system lives in
 * `app/globals.css` (`--as-*`) and `tailwind.config.ts`.
 */

/** Air-quality severity. Identical in both themes so severity never shifts meaning. */
export const SEVERITY = {
  good: '#34C759',
  fair: '#A3E635',
  moderate: '#FFCC00',
  poor: '#FF9500',
  bad: '#FF3B30',
  severe: '#A855F7',
} as const;

/** Non-severity measurement series. */
export const SERIES = {
  wind: '#22D3EE',
  pbl: '#A78BFA',
  solar: '#FFCC00',
  baseline: '#64748B',
  inactive: '#94A3B8',
} as const;

/** One colour per policy lever, reused by slider, label and legend. */
export const LEVER = {
  stubble: SEVERITY.poor,
  traffic: SERIES.wind,
  industry: SEVERITY.severe,
} as const;

/**
 * Aerosol-parcel pigments for the intro canvas. The neon set greys out against
 * a white ground, so light mode gets deeper equivalents.
 */
export const PARTICLE = {
  dark: {
    good: SEVERITY.good,
    warn: SEVERITY.moderate,
    bad: SEVERITY.bad,
    cool: SERIES.wind,
    hot: '#FFFFFF',
    // Deep and desaturated on purpose. The globe blends additively in dark
    // mode, so ocean covers 70% of the sphere and any chroma here sums into
    // a solid disc that swallows the land.
    ocean: '#0E2A44',
    /** Base colour of clean land — most of the globe, so it must stay quiet. */
    calm: '#5EC8E8',
    /** The globe's edge. Brighter than the surface — it is the outline. */
    rim: '#BFEFFF',
  },
  light: {
    good: '#15803D',
    warn: '#CA8A04',
    bad: '#DC2626',
    cool: '#0369A1',
    hot: '#0F172A',
    /** Light mode draws normally, so ocean needs value rather than restraint. */
    ocean: '#94A3B8',
    /** Base colour of clean land in light mode. */
    calm: '#0E7490',
    /** The globe's edge in light mode, where it must darken rather than glow. */
    rim: '#164E63',
  },
} as const;
