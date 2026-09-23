/**
 * Synthetic two-way coupled meteorology-chemistry forecast engine.
 *
 * This is a deliberately transparent stand-in for a WRF-Chem style online
 * coupling. It reproduces the qualitative feedback the dashboard is meant to
 * communicate:
 *
 *   aerosol load  ->  attenuates incoming shortwave (direct effect)
 *                 ->  cooler surface, weaker buoyancy
 *                 ->  shallower planetary boundary layer
 *                 ->  smaller ventilation volume
 *                 ->  higher aerosol load  (loop closes)
 *
 * Everything is deterministic (no Math.random) so server and client renders
 * agree and the timeline scrubs reproducibly.
 */
import { alertLevel, pm25ToAqi, type AlertLevel } from './aqi';
import { clamp, seeded } from './utils';

/**
 * Loading scale for the synthetic field, so the offline console describes the
 * same air as the live one.
 *
 * These coefficients were tuned to a moderate Delhi day and produce about
 * 110 ug/m3 unscaled. What the backend replays is a real window, and its level
 * depends entirely on which window: the December 2025 archive averages 330 at
 * hour 0, the mid-September 2026 one averages 40. Left unscaled the offline console
 * would claim a different city from the live one - and in December it claimed a
 * far cleaner one, which is the more dangerous direction.
 *
 * This tracks the season in backend/api_server.py (`baseline_season`), and it
 * has to be re-derived whenever that moves, alongside the station snapshot in
 * ./terminal/stations.ts. Both are frozen views of one replayed window; a
 * mismatch between them and the backend is silent, which is why they are
 * regenerated together and the season is named here rather than left implicit.
 *
 * Season 2026, origin 2026-09-17T13:00:00Z: target ~50 ug/m3 at hour 0.
 *
 * Only the loading is scaled. The physics is untouched - ventilation, the
 * aerosol-radiation feedback, the diurnal shape and the intervention sliders
 * all still do the work.
 */
export const REGIME = 0.451;

export const FORECAST_HOURS = 72;
export const STEP_HOURS = 1;

export type Pollutant = 'PM2.5' | 'WIND' | 'PBL' | 'PLUME' | 'O3' | 'NOx';
export const POLLUTANTS: Pollutant[] = ['PM2.5', 'WIND', 'PBL', 'PLUME', 'O3', 'NOx'];

export type District = {
  id: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  /** Relative emission strength (traffic + industry + residual burning). */
  emission: number;
  /** Share of emissions attributable to each intervention lever. */
  mix: { stubble: number; traffic: number; industry: number };
  population: string;
};

export const DISTRICTS: District[] = [
  {
    id: 'delhi',
    name: 'Delhi',
    zone: 'DELHI-NCR-CENTRAL',
    lat: 28.6139,
    lng: 77.209,
    emission: 1.12,
    mix: { stubble: 0.32, traffic: 0.4, industry: 0.28 },
    population: '16.8M',
  },
  {
    id: 'noida',
    name: 'Noida',
    zone: 'DELHI-NCR-EAST',
    lat: 28.5355,
    lng: 77.391,
    emission: 0.86,
    mix: { stubble: 0.24, traffic: 0.34, industry: 0.42 },
    population: '0.9M',
  },
  {
    id: 'gurgaon',
    name: 'Gurugram',
    zone: 'DELHI-NCR-WEST',
    lat: 28.4595,
    lng: 77.0266,
    emission: 0.78,
    mix: { stubble: 0.2, traffic: 0.52, industry: 0.28 },
    population: '1.2M',
  },
  {
    id: 'faridabad',
    name: 'Faridabad',
    zone: 'DELHI-NCR-SOUTH',
    lat: 28.4089,
    lng: 77.3178,
    emission: 0.92,
    mix: { stubble: 0.18, traffic: 0.3, industry: 0.52 },
    population: '1.4M',
  },
  {
    id: 'ghaziabad',
    name: 'Ghaziabad',
    zone: 'DELHI-NCR-NORTH',
    lat: 28.6692,
    lng: 77.4538,
    emission: 0.97,
    mix: { stubble: 0.38, traffic: 0.26, industry: 0.36 },
    population: '1.7M',
  },
];

export type Interventions = {
  /** % reduction in upwind stubble-burning emission flux. */
  stubble: number;
  /** % of private vehicle fleet removed by odd-even enforcement. */
  traffic: number;
  /** % cap applied to industrial stack emissions. */
  industry: number;
};

export const DEFAULT_INTERVENTIONS: Interventions = { stubble: 0, traffic: 0, industry: 0 };

export type CellSample = {
  districtId: string;
  pm25: number;
  aqi: number;
  pbl: number;
  temp: number;
  /** Relative humidity, %. Present once the backend carries it. */
  rh?: number;
  solar: number;
  windSpeed: number;
  windDir: number;
  o3: number;
  nox: number;
  inversion: number;
  alert: AlertLevel;
};

export type Frame = {
  hour: number;
  label: string;
  /** Hours since local midnight, for the diurnal cycle. */
  localHour: number;
  districts: Record<string, CellSample>;
  avgPm25: number;
  avgAqi: number;
  avgPbl: number;
  avgTemp: number;
  /** Mean relative humidity across the districts, %. */
  avgRh?: number;
  avgSolar: number;
  avgWind: number;
  inversionIndex: number;
  alert: AlertLevel;
};

/** Emission scaling once policy levers are applied. */
function emissionFactor(d: District, iv: Interventions) {
  const { mix } = d;
  return (
    mix.stubble * (1 - iv.stubble / 100) +
    mix.traffic * (1 - iv.traffic / 100) +
    mix.industry * (1 - iv.industry / 100)
  );
}

/** Clear-sky shortwave at the surface (W/m^2) for a given local hour. */
export function clearSkySolar(localHour: number) {
  const x = (localHour - 6.2) / 11.6; // sunrise ~06:12, sunset ~17:48 (Nov, 28.6N)
  if (x <= 0 || x >= 1) return 0;
  return 720 * Math.sin(Math.PI * x);
}

const START_LOCAL_HOUR = 19; // scenario opens at 19:00 IST - post-sunset build-up

export function buildForecast(iv: Interventions = DEFAULT_INTERVENTIONS): Frame[] {
  const frames: Frame[] = [];

  // Previous-step aerosol optical depth per district drives the feedback term.
  const prevAod: Record<string, number> = {};
  DISTRICTS.forEach((d) => {
    prevAod[d.id] = 0.55 * emissionFactor(d, iv) + 0.2;
  });

  for (let h = 0; h <= FORECAST_HOURS; h += STEP_HOURS) {
    const localHour = (START_LOCAL_HOUR + h) % 24;
    const day = Math.floor((START_LOCAL_HOUR + h) / 24);
    const districts: Record<string, CellSample> = {};

    DISTRICTS.forEach((d, di) => {
      const ef = emissionFactor(d, iv);
      const jitter = seeded(h * 7.31 + di * 3.77) - 0.5;

      // --- Synoptic wind: weak north-westerly, slack overnight --------------
      const windSpeed = clamp(
        1.5 +
          1.9 * Math.max(0, Math.sin(((localHour - 8) / 24) * Math.PI * 2)) +
          0.7 * Math.sin((h / 19) * Math.PI) +
          jitter * 0.6 +
          day * 0.35,
        0.3,
        7.5,
      );
      const windDir = (312 + 26 * Math.sin(h / 11) + jitter * 18 + 360) % 360;

      // --- Aerosol direct effect: attenuate incoming shortwave --------------
      const aod = prevAod[d.id];
      const attenuation = Math.exp(-0.62 * aod); // Beer-Lambert style extinction
      const clear = clearSkySolar(localHour);
      const solar = clear * attenuation;

      // --- Boundary layer responds to available surface heating -------------
      const nocturnal = 236 + 96 * seeded(di * 5.1 + day);
      const convective = 1750 * Math.pow(solar / 720, 0.85);
      // Feedback: suppressed irradiance directly caps PBL growth.
      const pbl = clamp(nocturnal + convective * (0.55 + 0.45 * attenuation), 60, 1900);

      // --- Temperature follows heating, damped by aerosol dimming -----------
      const temp =
        13.4 +
        8.6 * (solar / 720) +
        2.2 * Math.sin(((localHour - 4) / 24) * Math.PI * 2) -
        1.8 * aod +
        jitter * 0.7;

      // --- Ventilation-limited concentration --------------------------------
      // Ventilation coefficient, floored: a collapsed layer still exchanges a little.
      const ventilation = clamp((pbl / 900) * (0.42 + windSpeed / 4.5), 0.45, 1.15);
      const regionalBg = REGIME * (12 + 7 * Math.sin(h / 17));
      const pm25 = clamp((REGIME * 41 * d.emission * ef + regionalBg) / ventilation, 6, 780);

      // --- Inversion trap index: shallow layer + calm air + heavy load ------
      const inversion = clamp(
        0.55 * (1 - pbl / 1600) +
          0.32 * (1 - windSpeed / 6) +
          0.18 * clamp(pm25 / 200, 0, 1) +
          (solar < 5 ? 0.08 : 0), // nocturnal radiative inversion
        0,
        1,
      );

      // --- Secondary chemistry ----------------------------------------------
      const nox = clamp(28 + 62 * ef * d.emission * (1 - solar / 1400) + jitter * 6, 4, 240);
      const o3 = clamp(8 + 96 * Math.pow(solar / 720, 1.3) - 0.16 * nox + jitter * 5, 2, 190);

      // Advance the optical-depth state for the next step (relaxation).
      prevAod[d.id] = clamp(prevAod[d.id] * 0.62 + (pm25 / 210) * 0.38, 0.05, 2.2);

      districts[d.id] = {
        districtId: d.id,
        pm25: round(pm25, 1),
        aqi: pm25ToAqi(pm25),
        pbl: Math.round(pbl),
        temp: round(temp, 1),
        solar: Math.round(solar),
        windSpeed: round(windSpeed, 1),
        windDir: Math.round(windDir),
        o3: round(o3, 1),
        nox: round(nox, 1),
        inversion: round(inversion, 2),
        alert: alertLevel(pm25, inversion),
      };
    });

    const vals = Object.values(districts);
    const avg = (pick: (c: CellSample) => number) =>
      vals.reduce((s, c) => s + pick(c), 0) / vals.length;

    const avgPm25 = round(avg((c) => c.pm25), 1);
    const inversionIndex = round(avg((c) => c.inversion), 2);

    frames.push({
      hour: h,
      label: h === 0 ? 'NOW' : `+${h}h`,
      localHour,
      districts,
      avgPm25,
      avgAqi: pm25ToAqi(avgPm25),
      avgPbl: Math.round(avg((c) => c.pbl)),
      avgTemp: round(avg((c) => c.temp), 1),
      avgSolar: Math.round(avg((c) => c.solar)),
      avgWind: round(avg((c) => c.windSpeed), 1),
      inversionIndex,
      alert: alertLevel(avgPm25, inversionIndex),
    });
  }

  return frames;
}

function round(v: number, dp: number) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

/* ------------------------------------------------------------------ */
/* Spatial plume field                                                  */
/* ------------------------------------------------------------------ */

export type PlumeCell = { lat: number; lng: number; value: number };

export const NCR_BOUNDS = {
  south: 28.28,
  north: 28.92,
  west: 76.82,
  east: 77.62,
};

const GRID = 18;

/**
 * Gaussian superposition of district sources, advected downwind.
 * Produces the raster the map paints as a PM2.5 / plume heat field.
 */
export function plumeField(frame: Frame, intensity = 1): PlumeCell[] {
  const cells: PlumeCell[] = [];
  const dLat = (NCR_BOUNDS.north - NCR_BOUNDS.south) / GRID;
  const dLng = (NCR_BOUNDS.east - NCR_BOUNDS.west) / GRID;

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const lat = NCR_BOUNDS.south + dLat * (i + 0.5);
      const lng = NCR_BOUNDS.west + dLng * (j + 0.5);
      let v = 0;

      for (const d of DISTRICTS) {
        const s = frame.districts[d.id];
        const rad = (s.windDir * Math.PI) / 180;
        // Advect the source centroid downwind (windDir = direction it blows from).
        const drift = (s.windSpeed / 5) * 0.12;
        const cx = d.lat - Math.cos(rad) * drift;
        const cy = d.lng - Math.sin(rad) * drift;
        const sigma = 0.1 + 0.055 * (1 - s.inversion) + s.windSpeed * 0.012;
        const r2 = ((lat - cx) ** 2 + (lng - cy) ** 2) / (2 * sigma * sigma);
        v += s.pm25 * Math.exp(-r2);
      }

      cells.push({ lat, lng, value: (v / 1.9) * intensity });
    }
  }
  return cells;
}

/** Coarse wind-vector lattice for the WIND layer. */
export function windField(frame: Frame) {
  const out: { lat: number; lng: number; dir: number; speed: number }[] = [];
  const N = 9;
  const dLat = (NCR_BOUNDS.north - NCR_BOUNDS.south) / N;
  const dLng = (NCR_BOUNDS.east - NCR_BOUNDS.west) / N;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const lat = NCR_BOUNDS.south + dLat * (i + 0.5);
      const lng = NCR_BOUNDS.west + dLng * (j + 0.5);
      // Inverse-distance blend of the district wind samples.
      let wsum = 0;
      let dirX = 0;
      let dirY = 0;
      let spd = 0;
      for (const d of DISTRICTS) {
        const s = frame.districts[d.id];
        const w = 1 / (0.01 + (lat - d.lat) ** 2 + (lng - d.lng) ** 2);
        const rad = (s.windDir * Math.PI) / 180;
        dirX += Math.cos(rad) * w;
        dirY += Math.sin(rad) * w;
        spd += s.windSpeed * w;
        wsum += w;
      }
      out.push({
        lat,
        lng,
        dir: (Math.atan2(dirY / wsum, dirX / wsum) * 180) / Math.PI,
        speed: spd / wsum,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Narrative auto-analysis                                              */
/* ------------------------------------------------------------------ */

export type Analysis = { title: string; body: string; tone: 'info' | 'warn' | 'danger' };

export function autoAnalysis(frame: Frame, iv: Interventions): Analysis[] {
  const out: Analysis[] = [];
  const clear = clearSkySolar(frame.localHour);
  const dimming = Math.round(clamp((1 - frame.avgSolar / Math.max(1, clear)) * 100, 0, 96));
  const daylight = clear > 40;

  out.push({
    title: 'TWO-WAY COUPLING',
    tone: frame.avgPm25 > 120 ? 'danger' : 'info',
    body: daylight
      ? `Aerosol load suppresses solar irradiance by ${dimming}%, lowering the PBL to ${frame.avgPbl} m and trapping more pollution in a shrinking mixing volume.`
      : `Radiative cooling has collapsed the mixing layer to ${frame.avgPbl} m. No shortwave input, so the direct effect is dormant and accumulation depends on ventilation at ${frame.avgWind} m/s.`,
  });

  out.push({
    title: 'INVERSION TRAP',
    tone: frame.inversionIndex > 0.75 ? 'danger' : frame.inversionIndex > 0.55 ? 'warn' : 'info',
    body: `Index ${frame.inversionIndex.toFixed(2)}. A ${
      frame.inversionIndex > 0.75 ? 'strong' : frame.inversionIndex > 0.55 ? 'moderate' : 'weak'
    } capping layer sits over the NCR basin, so vertical exchange is ${
      frame.inversionIndex > 0.75 ? 'effectively shut off' : 'reduced'
    }.`,
  });

  const total = iv.stubble + iv.traffic + iv.industry;
  if (total > 0) {
    out.push({
      title: 'INTERVENTION RESPONSE',
      tone: 'info',
      body: `Stubble -${iv.stubble}%, odd-even -${iv.traffic}%, industrial cap -${iv.industry}%. Ensemble mean moves to ${frame.avgPm25} µg/m³. The gain exceeds the emission cut itself, because a lighter column deepens the PBL.`,
    });
  }

  return out;
}

/**
 * What this system actually is.
 *
 * Every field here was a claim about a system nobody built. It read
 * "WRF-CHEM COUPLED V4.2 ... ARW / RADM2-MADE-SORGAM ... 3 km x 3 km nested
 * (d03) ... NCUM-G 12 km + IMD AWS assimilation", with a confidence of 91% and
 * 1,284 observations assimilated - and it was printed on the landing panel,
 * which is the first thing anyone reads.
 *
 * None of it was true. There is no WRF-Chem run, no nested domain, no
 * assimilation, and the two numbers were invented. The problem statement asks
 * for exactly that model, so the page was claiming the one thing the project
 * does not have, to the people best placed to ask about it.
 *
 * What it does have is a blend baseline scored at RMSE 62.23 ug/m3 over a
 * held-out window, on a 1 km grid, with a real aerosol-radiation-PBL diagnostic
 * and real VIIRS fire input. That is a weaker claim and a defensible one, and
 * the numbers below can be checked against /api/v1/status.
 *
 * `latencyMs`, `confidence` and `assimilated` are gone rather than corrected:
 * there is nothing to correct them to, and leaving plausible keys in place is
 * how an invented number ends up back on screen.
 */
export const MODEL_META = {
  model: 'BLEND BASELINE · DIURNAL PERSISTENCE + BIAS-CORRECTED CAMS',
  core: 'Aerosol-radiation-PBL coupling diagnostic (SAFAR constants)',
  resolution: '1 km × 1 km (70 × 80 cells)',
  ic: 'CPCB/OpenAQ observations + CAMS reanalysis + archived ERA5 meteorology',
  emissions: 'NASA VIIRS active fire detections (Punjab/Haryana corridor)',
  validatedRmse: 62.23,
};
