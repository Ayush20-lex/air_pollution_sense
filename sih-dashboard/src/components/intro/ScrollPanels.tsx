import * as React from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, Layers, LineChart } from 'lucide-react';
import { MiniSparkline } from '@/components/charts/MiniSparkline';
import { Badge } from '@/components/ui/badge';
import { ALERT_COLOR, ALERT_LABEL, aqiColor } from '@/lib/aqi';
import { DISTRICTS, autoAnalysis, type Frame, type Interventions } from '@/lib/data';
import { useLiveNow } from '@/lib/useLiveNow';
import { SERIES } from '@/lib/tokens';
import { useAppStore } from '@/store/useAppStore';
import { useNowFrame } from '@/lib/useNowFrame';

const rise = (i: number) => ({
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15, margin: '0px 0px -8% 0px' },
  transition: { duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as const },
});

/**
 * Enterprise technical data cards:
 * Light mode: Pure white backgrounds (bg-white), crisp borders (border-slate-200), subtle shadows (shadow-sm),
 * dark text (text-slate-900) and medium gray sub-labels (text-slate-500).
 * Dark mode: Strictly preserved with dark:bg-slate-900/60, dark:border-slate-800, dark:text-white.
 */
export function ScrollPanels({
  frame,
  series,
  interventions,
}: {
  frame: Frame;
  series: number[];
  interventions: Interventions;
}) {
  // This card said CURRENT CONDITIONS, badged it "Now", and printed
  // `frame.avgPm25` - the forecast's first hour, which replays an archive.
  // On 3 October it read 85.6 ug/m3 directly beneath the words FORECAST
  // ENSEMBLE 85.6, while the live mesh was reading 38 and the assistant,
  // which reads the mesh, answered with a city AQI 75 points lower. A reader
  // comparing the two was right to think one of them was wrong.
  //
  // `useLiveNow` was written for exactly this and its own note records the
  // hero and the sector pills being moved off `frames[0]` for the same
  // reason; this card was missed. PM2.5 now comes from the mesh, and the
  // three model fields keep saying FC, as the hero rail already does - no
  // station measures a boundary layer.
  const now = useLiveNow();
  // The replay origin, which the backend has always sent as `source.origin`
  // and the page never read. It matters: the frame labelled NOW carries
  // validTime 2026-09-28T23:00Z with localHour 4, so the three model rows below
  // describe 4am on 29 September, not this hour and not a forecast ahead of it.
  // "FC" was true and incomplete - it reads as "forecast", meaning "later than
  // now" - so the rows now say which hour they replay.
  // `covers` is false once the wall clock has run past the end of the run's
  // 72-hour window. useNowFrame has always computed it and nothing ever read
  // it, so a run whose window had expired looked exactly like a current one:
  // the hook clamps to the last frame and the card kept saying "Now".
  const { covers } = useNowFrame();
  const origin = useAppStore((st) => st.source?.origin);
  const replayed = React.useMemo(() => {
    if (!origin) return null;
    const t = new Date(origin);
    if (Number.isNaN(t.getTime())) return null;
    t.setUTCHours(t.getUTCHours() + frame.hour);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(t);
  }, [origin, frame.hour]);
  const analysis = autoAnalysis(frame, interventions)[0];
  const ranked = [...DISTRICTS]
    .map((d) => ({ d, s: frame.districts[d.id] }))
    .sort((a, b) => b.s.pm25 - a.s.pm25)
    .slice(0, 3);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* --- current telemetry / conditions ----------------------------- */}
      <motion.div
        {...rise(0)}
        className="rounded-md border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:-translate-y-1 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Activity className="size-3 text-cyan-600 dark:text-cyan-400" />
            CURRENT CONDITIONS
          </span>
          <Badge color={now.loading ? undefined : aqiColor(now.pm25 ?? frame.avgPm25)}>
            {now.loading ? 'Reading' : now.live ? 'Now' : 'Forecast'}
          </Badge>
        </div>
        <dl className="mt-3 space-y-2.5">
          {/* Never the forecast under a live label, not even for the length
              of a fetch - see useLiveNow.loading. */}
          <Row
            label={now.live ? `PM2.5 · MEAN OF ${now.stations} LIVE` : now.loading ? 'PM2.5 · READING MESH' : 'PM2.5 AVERAGE · FC'}
            value={now.loading ? '—' : (now.pm25 ?? frame.avgPm25).toFixed(1)}
            unit={now.loading ? '' : 'µg/m³'}
            color={now.loading ? undefined : aqiColor(now.pm25 ?? frame.avgPm25)}
          />
          <Row label="BOUNDARY LAYER HEIGHT · FC" value={String(frame.avgPbl)} unit="m" />
          <Row label="TEMPERATURE · FC" value={frame.avgTemp.toFixed(1)} unit="°C" />
          {/* Solar is one side of the aerosol-PBL loop (PM2.5 -> AOD ->
              shortwave -> PBL), so it stays - it runs to 778 W/m2 at midday
              and is nonzero for 39 of the 72 forecast hours. But at 22:00 a
              bare "0" reads as a broken field rather than as night, so the
              zero says what it means. */}
          <Row
            label="SOLAR · FC"
            value={String(frame.avgSolar)}
            unit={frame.avgSolar === 0 ? 'W/m² · before sunrise' : 'W/m²'}
          />
        </dl>
        {replayed && (
          <p className="mt-2.5 border-t border-slate-100 pt-2 font-mono text-[10px] leading-tight text-slate-500 dark:border-slate-800/60 dark:text-slate-400">
            FC rows replay {replayed} IST
            {covers ? ', from the archive’s latest origin' : ' — the end of this run’s 72h window, which the clock has already passed'}
            . PM2.5 above is measured now.
          </p>
        )}
      </motion.div>

      {/* --- 72-hour forecast -------------------------------------------- */}
      <motion.div
        {...rise(1)}
        className="flex flex-col rounded-md border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:-translate-y-1 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <LineChart className="size-3 text-cyan-600 dark:text-cyan-400" />
            72-HOUR FORECAST
          </span>
          <span className="font-mono text-2xs text-slate-500 dark:text-slate-400">µg/m³</span>
        </div>
        <div className="mt-4 flex-1">
          <MiniSparkline values={series} width={320} height={92} className="w-full" />
        </div>
        <div className="mt-1 flex justify-between font-mono text-2xs tabular-nums text-slate-500 dark:text-slate-400">
          <span>NOW</span>
          <span>+24h</span>
          <span>+48h</span>
          <span>+72h</span>
        </div>
      </motion.div>

      {/* --- coupling ----------------------------------------------------- */}
      <motion.div
        {...rise(2)}
        className="rounded-md border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:-translate-y-1 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30"
      >
        <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Layers className="size-3 text-cyan-600 dark:text-cyan-400" />
          {analysis.title}
        </span>
        <p className="mt-3 text-pretty text-xs leading-relaxed text-slate-600 dark:text-slate-300">{analysis.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {['Aerosol', 'Extinction', 'Cooling', 'PBL', 'Trapping'].map((step, i, a) => (
            <React.Fragment key={step}>
              <span className="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700 transition-colors hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-600">
                {step}
              </span>
              {i < a.length - 1 && <span className="text-cyan-600 dark:text-cyan-400 font-bold">→</span>}
            </React.Fragment>
          ))}
        </div>
      </motion.div>

      {/* --- inversion risk ----------------------------------------------- */}
      <motion.div
        {...rise(3)}
        className="rounded-md border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:-translate-y-1 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <AlertTriangle className="size-3 text-amber-500 dark:text-amber-400" />
            INVERSION RISK
          </span>
          <span className="font-mono text-2xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            RISK INDEX {frame.inversionIndex.toFixed(2)}
          </span>
        </div>
        <div className="mt-3 space-y-1.5">
          {ranked.map(({ d, s }) => (
            <div
              key={d.id}
              className="flex items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800/80 dark:bg-slate-950/60"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: ALERT_COLOR[s.alert] }}
              />
              <span className="flex-1 truncate font-mono text-2xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {d.zone}
              </span>
              <span
                className="font-mono text-2xs font-bold uppercase tabular-nums tracking-wider"
                style={{ color: ALERT_COLOR[s.alert] }}
              >
                {ALERT_LABEL[s.alert] ?? s.alert}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function Row({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0 dark:border-slate-800/60">
      <dt className="font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span
          className="font-mono text-lg font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-100"
          style={{ color: color ?? undefined }}
        >
          {value}
        </span>
        <span className="font-mono text-2xs text-slate-500 dark:text-slate-400">{unit}</span>
      </dd>
    </div>
  );
}

/** Section heading that slides in from the left as the row arrives. */
export function ScrollSectionHead({ frame }: { frame: Frame }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
      <motion.h2
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="font-sans text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100"
      >
        Local 72-Hour <span className="text-cyan-600 dark:text-cyan-400 font-semibold">Forecast</span>
      </motion.h2>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="flex flex-wrap items-center gap-3 sm:gap-4 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400"
      >
        <span>
          FORECAST ENSEMBLE <span className="font-semibold text-slate-900 dark:text-slate-100">{frame.avgPm25.toFixed(1)} µg/m³</span>
        </span>
        <span>
          PBL <span className="font-semibold text-slate-900 dark:text-slate-100">{frame.avgPbl} m</span>
        </span>
        <span style={{ color: SERIES.wind }} className="font-semibold">{frame.avgWind} m/s</span>
      </motion.div>
    </div>
  );
}
