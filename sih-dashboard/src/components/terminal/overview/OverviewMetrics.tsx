import * as React from 'react';
import { Delta, Label, Meter, SectionHead, Spark, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { KPI_CARDS, POLLUTANTS } from '@/lib/terminal/content';
import { livePollutants, type LivePollutant } from '@/lib/terminal/livePollutants';
import { isLive, useHubStation, useMesh } from '@/lib/terminal/useMesh';
import { TERM } from '@/lib/terminal/palette';
import { cn } from '@/lib/utils';
import { MeasuredTrend } from './MeasuredTrend';
import { PollutantDetail } from './PollutantDetail';

/** Six KPI micro-cards + the eight-channel chemical grid. */
export function OverviewMetrics() {
  const { station, live } = useHubStation();
  const { asOf } = useMesh();
  // Measured cards when the archive answered for this node, the static grid
  // when it did not. Either way every card goes through the same component.
  const readings: LivePollutant[] = isLive(station)
    ? livePollutants(station)
    : POLLUTANTS.map((p) => ({
        ...p,
        measured: false,
        series: [] as (number | null)[],
        caption: null,
      }));
  const measuredCount = readings.filter((r) => r.measured).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {KPI_CARDS.map((k) => (
          <TelemetryCard key={k.label} className="space-y-2 p-4">
            <Label className="block">{k.label}</Label>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-2xl font-extrabold text-term-ink">{k.value}</span>
              <span className="font-mono text-[10px] text-term-ink-variant">{k.unit}</span>
            </div>
            <Spark values={k.series} color={k.color} className="h-8 w-full" fill />
            <Delta value={k.delta} className="text-[10px]" />
          </TelemetryCard>
        ))}
      </div>

      <div id="matrices" className="space-y-3">
        <SectionHead
          title="8-Pollutant Chemical Telemetry Grid"
          sub="Continuous spectrometry • Hover any card for its 24-hour trajectory, sampled every 2 hours"
          right={
            <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-term-ink-variant">
              <span className={cn('size-2 rounded-full', live ? 'bg-term-primary' : 'bg-amber-400')} />
              {live
                ? `CPCB National AQI · ${measuredCount} of ${readings.length} measured`
                : 'CPCB National AQI · demo values'}
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {readings.map((p) => (
            <PollutantCard key={p.id} reading={p} stationName={station.name} asOf={asOf} />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Resting state shows one number; hover or keyboard focus reveals the 24-hour
 * trajectory drawer. The drawer is focusable so it is reachable without a
 * pointer — the original HTML was hover-only.
 */
function PollutantCard({
  reading: p,
  stationName,
  asOf,
}: {
  reading: LivePollutant;
  stationName: string;
  asOf: string | null;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
    <TelemetryCard
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${p.symbol} ${p.name}. Open CPCB derivation.`}
      onClick={() => setOpen(true)}
      // Enter and Space so the card is operable without a pointer; the drawer
      // it used to reveal on focus is now a chart, and the numbers behind it
      // need a route that does not depend on hovering.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        'pollutant-card group relative cursor-pointer overflow-hidden border-l-4 p-4 outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-term-primary/60',
        !p.measured && 'opacity-60',
      )}
      style={{ borderLeftColor: p.measured ? p.color : TERM.outlineVariant }}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-xs font-bold" style={{ color: p.color }}>
              {p.symbol}
            </div>
            <div className="text-sm font-semibold text-term-ink">{p.name}</div>
          </div>
          <span
            className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold"
            style={
              p.measured
                ? { color: p.color, borderColor: `${p.color}66`, background: `${p.color}1f` }
                : { color: TERM.inkVariant, borderColor: `${TERM.outlineVariant}99` }
            }
          >
            {p.measured ? p.status : 'Not reported'}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="font-display text-3xl font-extrabold text-term-ink">
            {p.measured ? p.value.toFixed(p.value < 10 ? 1 : 0) : '—'}
          </span>
          <span className="font-mono text-xs text-term-ink-variant">
            {p.unit} <span className="font-normal text-term-outline">(Ref: {p.reference})</span>
          </span>
        </div>

        <Meter pct={p.measured ? p.pct : 0} color={p.measured ? p.color : TERM.outlineVariant} />

        <div className="flex items-center justify-between pt-1 font-mono text-xs">
          {/* The payload carries no per-pollutant 24h change, only a
              station-level one, so a delta here would be asserting something
              the backend never said. The sub-index is what it did say. */}
          {p.measured ? (
            <span className="text-term-ink-variant">
              Sub-index <strong style={{ color: p.color }}>{p.subIndex}</strong>
            </span>
          ) : p.delta !== 0 ? (
            // Offline the whole grid is the demo set and its deltas belong to
            // it. Live, an unmeasured card has none — see livePollutants.
            <Delta value={p.delta} />
          ) : (
            <span className="text-term-outline">—</span>
          )}
          <span className="text-term-ink-variant">{p.measured ? p.note : 'No archive reading'}</span>
        </div>
      </div>

      {/* Hover shows the shape of the window; clicking the card opens the
          derivation. A glance wants the trend, a decision wants the numbers. */}
      <div className="pollutant-graph-overlay absolute inset-0 z-20 flex flex-col justify-between rounded-2xl bg-term-surface-lowest/95 p-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span
              className="font-mono text-xs font-bold"
              style={{ color: p.measured ? p.color : TERM.inkVariant }}
            >
              {p.symbol}
            </span>
            <Label>{p.measured ? `${p.series.length}h measured` : '24h Trend (2h bins)'}</Label>
          </div>
          <span
            className="font-mono text-xs font-bold"
            style={{ color: p.measured ? p.color : TERM.inkVariant }}
          >
            {p.measured ? `${p.value.toFixed(1)} ${p.unit}` : `${p.trend[p.trend.length - 1]} ${p.unit}`}
          </span>
        </div>

        {p.measured ? (
          <MeasuredTrend values={p.series} color={p.color} height={68} endsAt={asOf}
            emptyNote={p.emptyNote} caption={p.caption} />
        ) : (
          <TrendChart values={p.trend} color={p.color} />
        )}

        <div className="flex items-center justify-between border-t border-term-outline-variant/40 pt-1 font-mono text-[10px] text-term-ink-variant">
          {p.measured ? (
            <>
              <span>
                {p.validHours} of {p.windowHours}h reported
              </span>
              <span className="font-bold" style={{ color: p.color }}>
                Click for CPCB detail
              </span>
            </>
          ) : (
            <>
              <span>T-22h</span>
              <span>T-12h</span>
              <span className="font-bold" style={{ color: p.color }}>
                Now
              </span>
            </>
          )}
        </div>
      </div>
    </TelemetryCard>
    <PollutantDetail
      reading={p}
      stationName={stationName}
      asOf={asOf}
      open={open}
      onClose={() => setOpen(false)}
    />
    </>
  );
}

/** Area + line + point markers, matching the drawer in the source design. */
function TrendChart({ values, color }: { values: number[]; color: string }) {
  const id = React.useId();
  const w = 220;
  const h = 60;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 6 - ((v - min) / span) * (h - 14);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="my-1 h-20 w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`pg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#pg-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r={i === values.length - 1 ? 3.5 : 2}
          fill={color}
          stroke={i === values.length - 1 ? TERM.ink : 'none'}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
