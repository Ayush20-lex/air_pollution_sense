'use client';

import * as React from 'react';
import { Delta, Label, Meter, SectionHead, Spark, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { KPI_CARDS, POLLUTANTS, type PollutantReading } from '@/lib/terminal/content';

/** Six KPI micro-cards + the eight-channel chemical grid. */
export function OverviewMetrics() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {KPI_CARDS.map((k) => (
          <TelemetryCard key={k.label} className="space-y-2 p-4">
            <Label className="block">{k.label}</Label>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-2xl font-extrabold text-white">{k.value}</span>
              <span className="font-mono text-[10px] text-slate-400">{k.unit}</span>
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
            <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-slate-400">
              <span className="size-2 rounded-full bg-term-primary" />
              ISO/WHO/EPA standards aligned
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {POLLUTANTS.map((p) => (
            <PollutantCard key={p.id} reading={p} />
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
function PollutantCard({ reading: p }: { reading: PollutantReading }) {
  const last = p.trend[p.trend.length - 1];

  return (
    <TelemetryCard
      tabIndex={0}
      className="pollutant-card group relative overflow-hidden border-l-4 p-4 outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-term-primary/60"
      style={{ borderLeftColor: p.color }}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-xs font-bold" style={{ color: p.color }}>
              {p.symbol}
            </div>
            <div className="text-sm font-semibold text-white">{p.name}</div>
          </div>
          <span
            className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold"
            style={{ color: p.color, borderColor: `${p.color}66`, background: `${p.color}1f` }}
          >
            {p.status}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="font-display text-3xl font-extrabold text-white">
            {p.value.toFixed(p.value < 10 ? 1 : 0)}
          </span>
          <span className="font-mono text-xs text-slate-400">
            {p.unit} <span className="font-normal text-slate-500">(Ref: {p.reference})</span>
          </span>
        </div>

        <Meter pct={p.pct} color={p.color} />

        <div className="flex items-center justify-between pt-1 font-mono text-xs">
          <Delta value={p.delta} />
          <span className="text-slate-400">{p.note}</span>
        </div>
      </div>

      {/* 24h trajectory drawer */}
      <div className="pollutant-graph-overlay absolute inset-0 z-20 flex flex-col justify-between rounded-2xl bg-term-surface-lowest/95 p-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold" style={{ color: p.color }}>
              {p.symbol}
            </span>
            <Label>24h Trend (2h bins)</Label>
          </div>
          <span className="font-mono text-xs font-bold" style={{ color: p.color }}>
            {last} {p.unit}
          </span>
        </div>

        <TrendChart values={p.trend} color={p.color} />

        <div className="flex items-center justify-between border-t border-term-outline-variant/40 pt-1 font-mono text-[10px] text-slate-400">
          <span>T-22h</span>
          <span>T-12h</span>
          <span className="font-bold" style={{ color: p.color }}>
            Now
          </span>
        </div>
      </div>
    </TelemetryCard>
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
          stroke={i === values.length - 1 ? '#ffffff' : 'none'}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
