import * as React from 'react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { EXPOSURE_HISTORY, STRESSORS, TEMPORAL_TRACE } from '@/lib/terminal/content';
import { POLLUTANTS } from '@/lib/terminal/content';
import { cn } from '@/lib/utils';
import { TERM, TERM_SEVERITY } from '@/lib/terminal/palette';

const TIMEFRAMES = ['24H', '7D', '30D', '90D'] as const;

/** Temporal trend + stressor donut, then the multi-pollutant correlator. */
export function OverviewAnalytics() {
  return (
    <>
      <div id="analytics" className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <TemporalTrend />
        <StressorDonut />
      </div>
      <Correlator />
    </>
  );
}

function TemporalTrend() {
  const [range, setRange] = React.useState<(typeof TIMEFRAMES)[number]>('24H');

  const w = 720;
  const h = 260;
  const max = 200;
  const x = (i: number) => (i / (TEMPORAL_TRACE.length - 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  const line = TEMPORAL_TRACE.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastIdx = TEMPORAL_TRACE.length - 1;

  return (
    <TelemetryCard className="space-y-3 p-5 lg:col-span-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold tracking-tight text-white">
            Continuous Temporal AQI Gradient
          </h3>
          <Label>Composite index · rolling window</Label>
        </div>
        <div className="flex gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setRange(t)}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                range === t
                  ? 'border-orange-500/50 bg-orange-500/20 text-orange-300'
                  : 'border-term-outline-variant/60 bg-term-surface-c/80 text-slate-400 hover:text-white',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="h-64 w-full" role="img" aria-label="24-hour composite AQI trace">
        <defs>
          <linearGradient id="tt-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TERM_SEVERITY.high} stopOpacity="0.45" />
            <stop offset="100%" stopColor={TERM_SEVERITY.high} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* severity bands behind the trace */}
        <rect x="0" y={y(200)} width={w} height={y(150) - y(200)} fill={TERM_SEVERITY.severe} opacity="0.07" />
        <rect x="0" y={y(150)} width={w} height={y(100) - y(150)} fill={TERM_SEVERITY.high} opacity="0.07" />
        <rect x="0" y={y(100)} width={w} height={y(50) - y(100)} fill={TERM_SEVERITY.caution} opacity="0.05" />

        {[50, 100, 150, 200].map((v) => (
          <g key={v}>
            <line x1="0" y1={y(v)} x2={w} y2={y(v)} stroke={TERM.outlineVariant} strokeWidth="1" strokeDasharray="4 6" />
            <text x="4" y={y(v) - 4} fill={TERM.outline} fontSize="10" fontFamily="var(--font-mono), monospace">
              {v}
            </text>
          </g>
        ))}

        <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#tt-area)" />
        <path d={line} fill="none" stroke={TERM_SEVERITY.high} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(lastIdx)} cy={y(TEMPORAL_TRACE[lastIdx])} r="5" fill={TERM_SEVERITY.high} stroke="#fff" strokeWidth="2">
          <animate attributeName="r" values="5;9;5" dur="2.2s" repeatCount="indefinite" />
        </circle>
      </svg>

      <div className="flex justify-between border-t border-term-outline-variant/40 pt-2 font-mono text-[10px] text-slate-400">
        {['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', 'NOW'].map((t) => (
          <span key={t} className={cn(t === 'NOW' && 'font-bold text-orange-400')}>
            {t}
          </span>
        ))}
      </div>
    </TelemetryCard>
  );
}

function StressorDonut() {
  const total = STRESSORS.reduce((sum, s) => sum + s.share, 0);
  const r = 62;
  const c = 2 * Math.PI * r;

  return (
    <TelemetryCard className="space-y-4 p-5 lg:col-span-4">
      <div>
        <h3 className="font-display text-sm font-bold tracking-tight text-white">Stressor Contribution</h3>
        <Label>Share of composite index</Label>
      </div>

      <div className="flex items-center justify-center">
        <div className="relative size-44">
          <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="80" cy="80" r={r} fill="none" stroke={TERM.surfaceRaised} strokeWidth="18" />
            {STRESSORS.map((s, i) => {
              const len = (s.share / total) * c;
              const dash = `${len} ${c - len}`;
              // Offset is the arc length of everything before this segment.
              // Derived rather than accumulated into a closure variable: a
              // render that runs the map twice would otherwise double every
              // offset and scramble the ring.
              const offset = -STRESSORS.slice(0, i).reduce((a, x) => a + (x.share / total) * c, 0);
              return (
                <circle
                  key={s.label}
                  cx="80"
                  cy="80"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="18"
                  strokeDasharray={dash}
                  strokeDashoffset={offset}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-3xl font-extrabold text-white">{STRESSORS[0].share}%</span>
            <Label>PM2.5 lead</Label>
          </div>
        </div>
      </div>

      <ul className="space-y-1.5 border-t border-term-outline-variant/40 pt-3">
        {STRESSORS.map((s) => (
          <li key={s.label} className="flex items-center justify-between font-mono text-xs">
            <span className="flex items-center gap-2 text-slate-300">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-bold tabular-nums" style={{ color: s.color }}>
              {s.share}%
            </span>
          </li>
        ))}
      </ul>
    </TelemetryCard>
  );
}

/**
 * Multi-pollutant correlator. Each chemical is a toggleable curve — the
 * checkbox drives the series visibility directly through React state rather
 * than mutating SVG nodes.
 */
function Correlator() {
  const [active, setActive] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(POLLUTANTS.map((p, i) => [p.id, i < 4])),
  );

  const w = 720;
  const h = 240;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <TelemetryCard className="space-y-3 p-5 lg:col-span-8">
        <SectionHead title="Multi-Pollutant Correlator" sub="Normalised channels over the last 24 hours" />

        <div className="flex flex-wrap gap-1.5">
          {POLLUTANTS.map((p) => {
            const on = active[p.id];
            return (
              <label
                key={p.id}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                  on ? 'text-white' : 'border-term-outline-variant/60 bg-term-surface-c/80 text-slate-400',
                )}
                style={on ? { borderColor: `${p.color}80`, background: `${p.color}1f` } : undefined}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setActive((a) => ({ ...a, [p.id]: !a[p.id] }))}
                  className="size-3 cursor-pointer rounded border-term-outline bg-transparent text-term-primary focus:ring-0 focus:ring-offset-0"
                />
                <span className="size-2 rounded-full" style={{ background: p.color }} />
                {p.symbol}
              </label>
            );
          })}
        </div>

        <svg viewBox={`0 0 ${w} ${h}`} className="h-60 w-full" role="img" aria-label="Correlated pollutant channels">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" y1={h * f} x2={w} y2={h * f} stroke={TERM.outlineVariant} strokeWidth="1" strokeDasharray="4 6" />
          ))}
          {POLLUTANTS.filter((p) => active[p.id]).map((p) => {
            const min = Math.min(...p.trend);
            const max = Math.max(...p.trend);
            const span = max - min || 1;
            const d = p.trend
              .map((v, i) => {
                const px = (i / (p.trend.length - 1)) * w;
                // Each channel is normalised so shapes can be compared.
                const py = h - 16 - ((v - min) / span) * (h - 36);
                return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
              })
              .join(' ');
            return (
              <path
                key={p.id}
                d={d}
                fill="none"
                stroke={p.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            );
          })}
        </svg>
      </TelemetryCard>

      <TelemetryCard className="space-y-3 p-5 lg:col-span-4">
        <div>
          <h3 className="font-display text-sm font-bold tracking-tight text-white">30-Day Exposure Frequency</h3>
          <Label>Days spent in each band</Label>
        </div>
        <ul className="space-y-2.5 pt-1">
          {EXPOSURE_HISTORY.map((e) => (
            <li key={e.label} className="space-y-1">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="size-2.5 rounded-full" style={{ background: e.color }} />
                  {e.label}
                </span>
                <span className="font-bold tabular-nums" style={{ color: e.color }}>
                  {e.days}d
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-term-surface-high">
                <div className="h-full rounded-full" style={{ width: `${(e.days / 30) * 100}%`, background: e.color }} />
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-term-outline-variant/40 pt-3 font-mono text-[10px] text-slate-400">
          20 of 30 days above the sensitive-group threshold
        </div>
      </TelemetryCard>
    </div>
  );
}
