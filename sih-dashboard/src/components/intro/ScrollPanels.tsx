import * as React from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, Layers, LineChart } from 'lucide-react';
import { MiniSparkline } from '@/components/charts/MiniSparkline';
import { Badge } from '@/components/ui/badge';
import { ALERT_COLOR, aqiColor } from '@/lib/aqi';
import { DISTRICTS, autoAnalysis, type Frame, type Interventions } from '@/lib/data';
import { SERIES } from '@/lib/tokens';

/**
 * Shared rise-from-below entrance, staggered across the row.
 *
 * `once: true`, and that is the whole point. With `once: false` the panels
 * animated out again every time they left the viewport and back in on the way
 * past, so scrolling up the page - or stopping with a card half off the bottom
 * edge, which at `amount` 0.35 is below the trigger - left cards sitting at
 * their `initial` opacity of zero. Three of them were measured at 0.05, 0.53
 * and 0.59 while off screen. An entrance is something a panel does once; after
 * that the reader is just trying to read it.
 *
 * `amount` is lower to match, so a card entering from the bottom commits
 * earlier rather than waiting to be a third on screen.
 */
const rise = (i: number) => ({
  initial: { opacity: 0, y: 56 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15, margin: '0px 0px -8% 0px' },
  transition: { duration: 0.65, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
});

/**
 * The panel row that rises over the pinned particle field as the intro
 * scrolls. Every figure and every sentence is the same data the terminal
 * shows — this is a preview of what Scan NCR opens, not new content.
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
  const analysis = autoAnalysis(frame, interventions)[0];
  const ranked = [...DISTRICTS]
    .map((d) => ({ d, s: frame.districts[d.id] }))
    .sort((a, b) => b.s.pm25 - a.s.pm25)
    .slice(0, 3);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* --- current telemetry ------------------------------------------ */}
      <motion.div {...rise(0)} className="glass glass-hover p-3">
        <div className="flex items-center justify-between">
          <span className="panel-title">
            <Activity className="size-3" />
            Current telemetry
          </span>
          <Badge color={aqiColor(frame.avgPm25)}>Now</Badge>
        </div>
        <dl className="mt-3 space-y-2.5">
          <Row label="PM2.5 avg" value={frame.avgPm25.toFixed(1)} unit="µg/m³" color={aqiColor(frame.avgPm25)} />
          <Row label="PBL height" value={String(frame.avgPbl)} unit="m" />
          <Row label="Temperature" value={frame.avgTemp.toFixed(1)} unit="°C" />
          <Row label="Solar" value={String(frame.avgSolar)} unit="W/m²" />
        </dl>
      </motion.div>

      {/* --- 72h trajectory ---------------------------------------------- */}
      <motion.div {...rise(1)} className="glass glass-hover flex flex-col p-3">
        <div className="flex items-center justify-between">
          <span className="panel-title">
            <LineChart className="size-3" />
            72h trajectory
          </span>
          <span className="font-mono text-2xs text-faint">µg/m³</span>
        </div>
        <div className="mt-4 flex-1">
          <MiniSparkline values={series} width={320} height={92} className="w-full" />
        </div>
        <div className="mt-1 flex justify-between font-mono text-2xs text-faint">
          <span>NOW</span>
          <span>+24h</span>
          <span>+48h</span>
          <span>+72h</span>
        </div>
      </motion.div>

      {/* --- coupling ----------------------------------------------------- */}
      <motion.div {...rise(2)} className="glass glass-hover p-3">
        <span className="panel-title">
          <Layers className="size-3" />
          {analysis.title}
        </span>
        <p className="mt-3 text-pretty text-xs leading-relaxed text-muted">{analysis.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-faint">
          {['Aerosol', 'Extinction', 'Cooling', 'PBL', 'Trapping'].map((step, i, a) => (
            <React.Fragment key={step}>
              <span className="rounded border border-hairline bg-elevated/50 px-1.5 py-0.5">{step}</span>
              {i < a.length - 1 && <span className="text-accent">→</span>}
            </React.Fragment>
          ))}
        </div>
      </motion.div>

      {/* --- inversion risk ----------------------------------------------- */}
      <motion.div {...rise(3)} className="glass glass-hover p-3">
        <div className="flex items-center justify-between">
          <span className="panel-title">
            <AlertTriangle className="size-3" />
            Inversion risk
          </span>
          <span className="font-mono text-2xs tabular-nums text-faint">
            idx {frame.inversionIndex.toFixed(2)}
          </span>
        </div>
        <div className="mt-3 space-y-1.5">
          {ranked.map(({ d, s }) => (
            <div
              key={d.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5"
              style={{ background: `${ALERT_COLOR[s.alert]}12` }}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: ALERT_COLOR[s.alert] }}
              />
              <span className="flex-1 truncate font-mono text-2xs uppercase tracking-[0.12em] text-ink">
                {d.zone}
              </span>
              <span
                className="font-mono text-2xs font-bold uppercase tracking-[0.1em]"
                style={{ color: ALERT_COLOR[s.alert] }}
              >
                {s.alert}
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
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline/40 pb-2 last:border-0 last:pb-0">
      <dt className="hud-label">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span
          className="font-mono text-lg font-semibold tabular-nums"
          style={{ color: color ?? 'rgb(var(--as-ink))' }}
        >
          {value}
        </span>
        <span className="font-mono text-2xs text-faint">{unit}</span>
      </dd>
    </div>
  );
}

/** Section heading that slides in from the left as the row arrives. */
export function ScrollSectionHead({ frame }: { frame: Frame }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline/60 pb-4">
      <motion.h2
        initial={{ opacity: 0, x: -28 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="font-mono text-xl font-bold uppercase tracking-[0.14em] text-ink sm:text-2xl"
      >
        Local forecast <span className="text-accent">coupled</span>
      </motion.h2>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="flex items-center gap-4 font-mono text-2xs uppercase tracking-[0.18em] text-faint"
      >
        <span>
          Ensemble <span className="text-ink">{frame.avgPm25.toFixed(0)} µg/m³</span>
        </span>
        <span>
          PBL <span className="text-ink">{frame.avgPbl} m</span>
        </span>
        <span style={{ color: SERIES.wind }}>{frame.avgWind} m/s</span>
      </motion.div>
    </div>
  );
}
