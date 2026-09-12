# AirSense NCR

Two-way coupled meteorology–chemistry air quality forecasting console for the Delhi National
Capital Region.

**Problem Statement ID26082 — NCMRWF / Ministry of Earth Sciences.**

> All data in this build is **synthetic**. `lib/data.ts` implements a transparent stand-in for a
> WRF-Chem style online coupling so the interface can be evaluated without a live model feed.

---

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with fast refresh |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |

---

## The two screens

### 1. Intro — interactive aerosol canvas

A Three.js particle field (`@react-three/fiber`) renders ~7,400 aerosol parcels as a **stratified
slab**: dense and red near the surface, thinning to cool tones above the inversion cap. The field
tilts toward the cursor, and a translucent disc marks the capping layer.

Overlaid on it: live `PM2.5 AVG`, `PBL HEIGHT` and `INVERSION INDEX` readouts, floating
zone-alert pills (`DELHI-NCR-CENTRAL: EMERGENCY`, `DELHI-NCR-NORTH: WARNING`), an auto-analysis
card explaining the coupling, and a 72 h sparkline.

**SCAN NCR →** (or scroll / Enter) dollies the camera into the cloud while the particles blast
outward, then hands off to the dashboard.

### 2. Dashboard — the forecasting console

```
┌───────────────────────────────────────────────────────────────────────┐
│ header: logo · variable tabs (PM2.5 WIND PBL PLUME O3 NOx) · theme    │
├───────────────┬───────────────────────────────────┬───────────────────┤
│ telemetry     │ spatial map + plume viewer        │ coupling analysis │
│ · AQI + band  │ · concentration raster            │ · drivers         │
│ · 4 metrics   │ · plume iso-contours              │ · feedback chain  │
│ · 72h chart   │ · wind vectors                    │ · auto-analysis   │
│ · stations    │ · district AQI pins               │ · inversion risk  │
│               │ · timeline transport +0h…+72h     │ · data lineage    │
└───────────────┴───────────────────────────────────┴───────────────────┘
```

- **Timeline** — scrub 0–72 h, play/pause, 0.5×/1×/2× speed, step ±1 h. Keyboard: `Space`,
  `←`, `→`. The strip under the track is coloured by forecast concentration.
- **Map layers** — concentration raster, plume envelope, wind barbs and station pins toggle
  independently. Pins hover and select; selecting one re-scopes the whole left rail to that
  district.
- **What-if simulator** — the header's `What-if` button opens a drawer with three policy levers.
  Moving one **rebuilds the entire coupled forecast**, so the map, both charts, the analysis prose
  and the alert badges all update together, against a pinned baseline for comparison.

---

## The coupling model

`lib/data.ts` closes the aerosol–radiation–boundary-layer loop each forecast hour:

```
aerosol load ──▶ shortwave extinction (Beer–Lambert)
             ──▶ reduced surface heating
             ──▶ shallower PBL
             ──▶ smaller ventilation volume
             ──▶ higher aerosol load  ↺
```

Concretely, per district per hour: optical depth from the previous step attenuates clear-sky
irradiance; the boundary layer grows from that residual heating; a ventilation coefficient
(PBL × wind) divides the emission flux into a concentration; and the resulting load relaxes into
the next step's optical depth. The **inversion index** blends layer depth, wind slack, aerosol
load and a nocturnal radiative term.

The model is fully deterministic — noise comes from a seeded hash (`lib/utils.ts#seeded`), never
`Math.random` — so server and client renders agree and scrubbing is reproducible.

Policy levers scale each district's emission mix (`stubble` / `traffic` / `industry` shares), which
is why the response is **non-linear**: a lighter column lets more shortwave through, deepens the
PBL, and dilutes the same source into a larger volume.

Calibration targets at T+0 (19:00 IST): PM2.5 ≈ 111 µg/m³, PBL ≈ 275 m, inversion index ≈ 0.85.

---

## Structure

```
app/
  layout.tsx           fonts, metadata, theme provider
  page.tsx             screen switch (intro ⇄ dashboard) + boot splash
  providers.tsx        next-themes + Radix tooltip provider
  globals.css          both palettes, glass surfaces, Leaflet + pin styling
components/
  intro/               ParticleField, IntroScreen, TelemetryOverlay, StatusPills, ScanButton
  dashboard/           Dashboard, Header, LeftPanel, RightPanel, MetricCard,
                       TimelineBar, InterventionDrawer
  map/                 MapPanel (chrome, layers, legend), NCRMap (Leaflet)
  charts/              TrajectoryChart (Recharts), MiniSparkline (plain SVG)
  ui/                  button, card, slider, badge, tooltip, theme-toggle
lib/
  data.ts              coupled forecast engine, plume + wind fields, auto-analysis
  aqi.ts               CPCB breakpoints, colour ramp, alert levels
  utils.ts             cn(), seeded noise, formatting
store/
  useAppStore.ts       Zustand: screen, forecast, hour, playback, layers, interventions
```

---

## Design system

Both themes are driven by CSS custom properties on `:root` / `.dark`, so every component reads the
same tokens.

| | Dark | Light |
| --- | --- | --- |
| Base | `#0B0F17` deep onyx | `#F8FAFC` clean slate |
| Panels | `rgba(18,24,38,0.7)` glass | `rgba(255,255,255,0.8)` glass |
| Accent | cyan `#22D3EE` | sky `#0284C7` |

AQI semantics stay **fixed across themes** so severity never changes meaning:
`#34C759` good · `#FFCC00` warning · `#FF9500` poor · `#FF3B30` emergency · `#A855F7` severe.

Type is Inter for prose and JetBrains Mono for every instrument readout, uppercase and letter-spaced.

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Three.js via
`@react-three/fiber` + `drei` · Framer Motion · Recharts · Leaflet + react-leaflet ·
Radix UI primitives (shadcn-style components in `components/ui`) · Zustand · next-themes ·
lucide-react.

Basemap tiles are keyless OpenStreetMap raster tiles; the dark cartography is a CSS filter on the
tile pane rather than a second, API-keyed provider. For production traffic, swap `TILE_URL` in
`components/map/NCRMap.tsx` for a provider whose usage policy covers your load.

---

## Notes for wiring up a real feed

Everything the UI needs comes from one shape: `Frame[]` (see `lib/data.ts`). Replace
`buildForecast()` with a fetch against the NCMRWF product server, keep the field names, and the
rest of the console works unchanged. `MODEL_META` drives the data-lineage panel.
