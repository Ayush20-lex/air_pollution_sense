import * as React from 'react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { BAND_ORDER, fetchCityHistory, type CityHistory } from '@/lib/historyApi';
import { SEVERITY } from '@/lib/tokens';
import { isLive, useFreshStations } from '@/lib/terminal/useMesh';
import { POLLUTANTS } from '@/lib/terminal/content';
import { cn } from '@/lib/utils';
import { ForecastTrack, type ForecastPoint } from './ForecastTrack';
import { useAppStore } from '@/store/useAppStore';
import { TERM, TERM_SEVERITY } from '@/lib/terminal/palette';

const TIMEFRAMES = ['24H', '7D', '30D', '90D'] as const;

/**
 * The archive's daily city history, shared by the exposure histogram and the
 * temporal trend so the two cannot describe different months.
 */
function useCityHistory(days = 30): CityHistory | null {
  const [data, setData] = React.useState<CityHistory | null>(null);
  React.useEffect(() => {
    let alive = true;
    void fetchCityHistory(days).then((d) => {
      if (alive && d) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [days]);
  return data;
}



/** Temporal trend + stressor donut, then the multi-pollutant correlator. */
export function OverviewAnalytics() {
  return (
    <>
      {/* The forecast leads, because it is the only panel here whose numbers
          come from the model. `TemporalTrend` charted twenty-four constants
          under four timeframe buttons that all drew the same line; it is kept
          below and labelled, not passed off as a record. */}
      <ForecastPanel />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <TemporalTrend />
        <StressorDonut />
      </div>
      <Correlator />
    </>
  );
}

/** The backend's 72-hour forecast, at 12-hour marks. */
function ForecastPanel() {
  const liveFrames = useAppStore((st) => st.liveFrames);
  const source = useAppStore((st) => st.source);
  const load = useAppStore((st) => st.loadLiveForecast);

  // The console loads this on its own; the terminal is a separate entry point
  // and can be opened without ever passing through it.
  React.useEffect(() => {
    if (!liveFrames) void load();
  }, [liveFrames, load]);

  const points: ForecastPoint[] = React.useMemo(
    () => (liveFrames ?? []).map((f, i) => ({ hour: i, aqi: Math.round(f.avgAqi) })),
    [liveFrames],
  );

  return <ForecastTrack points={points} source={source} />;
}

/** How many days of archive each timeframe asks for. */
const RANGE_DAYS: Record<string, number> = { '24H': 7, '7D': 7, '30D': 30, '90D': 90 };

function TemporalTrend() {
  const [range, setRange] = React.useState<(typeof TIMEFRAMES)[number]>('30D');

  // The buttons used to redraw the same twenty-four constants whatever was
  // pressed. Each now asks the archive for its own window, so they differ.
  const history = useCityHistory(RANGE_DAYS[range] ?? 30);
  const series = (history?.days ?? [])
    .map((d) => d.aqi)
    .filter((v): v is number => v != null);

  const w = 720;
  const h = 260;
  // Scaled to the data with a floor at the Moderate boundary, so a calm month
  // does not fill the card and look alarming.
  const max = Math.max(200, ...series);
  const x = (i: number) => (i / Math.max(series.length - 1, 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastIdx = series.length - 1;

  // Six evenly spaced day labels across the window, the last one marked.
  const axisDates = (() => {
    const days = history?.days ?? [];
    if (days.length < 2) return [];
    const picks = 6;
    return Array.from({ length: picks }, (_, k) => {
      const d = days[Math.round((k / (picks - 1)) * (days.length - 1))];
      if (!d) return '';
      const dt = new Date(d.date);
      return Number.isNaN(dt.getTime())
        ? d.date
        : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(dt);
    });
  })();

  if (series.length < 2) {
    return (
      <TelemetryCard className="flex h-64 items-center justify-center p-5 lg:col-span-8">
        <span className="font-mono text-xs text-term-outline">
          {history ? 'Not enough archived days to draw a trend' : 'Reading the archive…'}
        </span>
      </TelemetryCard>
    );
  }

  return (
    <TelemetryCard className="space-y-3 p-5 lg:col-span-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">
            Continuous Temporal AQI Gradient
          </h3>
          {/* It is now a record of one: daily city AQI from the archive, each
              day the mean across stations of that station's own 24-hour mean. */}
          <Label>
            Daily city AQI · {series.length} archived days ·{' '}
            {history?.days[0]?.date} to {history?.days[lastIdx]?.date}
          </Label>
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
                  : 'border-term-outline-variant/60 bg-term-surface-c/80 text-term-ink-variant hover:text-term-ink',
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
        <circle cx={x(lastIdx)} cy={y(series[lastIdx])} r="5" fill={TERM_SEVERITY.high} stroke="#fff" strokeWidth="2">
          <animate attributeName="r" values="5;9;5" dur="2.2s" repeatCount="indefinite" />
        </circle>
      </svg>

      {/* Dates, not hours. The axis read 00:00 to 20:00 under a series that
          was twenty-four constants; now that each point is a day, hour labels
          would be describing a different quantity from the line above them. */}
      <div className="flex justify-between border-t border-term-outline-variant/40 pt-2 font-mono text-[10px] text-term-ink-variant">
        {axisDates.map((d, i) => (
          <span
            key={`${d}-${i}`}
            className={cn(i === axisDates.length - 1 && 'font-bold text-orange-400')}
          >
            {d}
          </span>
        ))}
      </div>
    </TelemetryCard>
  );
}

/**
 * Which pollutant is driving the index, measured across the mesh.
 *
 * STRESSORS in ./content was five literals - 38/24/14/11/13 - summing neatly
 * to a hundred under a heading that said "share of composite index". The mesh
 * has said which pollutant sets each station's AQI all along: CPCB's index is
 * the worst of the sub-indices, and `prominent_pollutant` names the one
 * responsible. Counting stations by that is the same question, answered.
 *
 * It is a share of STATIONS, not a share of the index, and the label says so.
 * Sub-indices are not additive - three pollutants at 100 do not make 300 - so
 * a percentage "of the composite index" was never a quantity that existed.
 */
function useStressors(): { label: string; share: number; color: string; count: number }[] {
  const stations = useFreshStations();
  return React.useMemo(() => {
    const live = stations.filter(isLive);
    if (!live.length) return [];
    const counts = new Map<string, number>();
    for (const st of live) counts.set(st.dominant, (counts.get(st.dominant) ?? 0) + 1);
    const palette: Record<string, string> = {
      'PM2.5': TERM_SEVERITY.high,
      PM10: TERM_SEVERITY.caution,
      O3: TERM.secondary,
      NO2: TERM.tertiary,
      SO2: TERM.outline,
    };
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        share: (count / live.length) * 100,
        color: palette[label] ?? TERM.outline,
      }));
  }, [stations]);
}

function StressorDonut() {
  const stressors = useStressors();
  const total = stressors.reduce((sum, s) => sum + s.share, 0) || 1;
  const r = 62;
  const c = 2 * Math.PI * r;

  if (!stressors.length) {
    return (
      <TelemetryCard className="flex items-center justify-center p-5 lg:col-span-4">
        <span className="font-mono text-xs text-term-outline">
          No indexable stations — nothing to attribute
        </span>
      </TelemetryCard>
    );
  }

  return (
    <TelemetryCard className="space-y-4 p-5 lg:col-span-4">
      <div>
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Dominant Stressor</h3>
        <Label>Share of reporting stations each pollutant leads</Label>
      </div>

      <div className="flex items-center justify-center">
        <div className="relative size-44">
          <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="80" cy="80" r={r} fill="none" stroke={TERM.surfaceRaised} strokeWidth="18" />
            {stressors.map((s, i) => {
              const len = (s.share / total) * c;
              const dash = `${len} ${c - len}`;
              // Offset is the arc length of everything before this segment.
              // Derived rather than accumulated into a closure variable: a
              // render that runs the map twice would otherwise double every
              // offset and scramble the ring.
              const offset = -stressors.slice(0, i).reduce((a, x) => a + (x.share / total) * c, 0);
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
            <span className="font-display text-3xl font-extrabold text-term-ink">
              {stressors[0].share.toFixed(0)}%
            </span>
            <Label>{stressors[0].label} leads</Label>
          </div>
        </div>
      </div>

      <ul className="space-y-1.5 border-t border-term-outline-variant/40 pt-3">
        {stressors.map((s) => (
          <li key={s.label} className="flex items-center justify-between font-mono text-xs">
            <span className="flex items-center gap-2 text-term-ink-variant">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-bold tabular-nums" style={{ color: s.color }}>
              {s.count} · {s.share.toFixed(0)}%
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

  // The exposure histogram shares this card's grid row, so it reads the archive
  // here rather than fetching a second copy.
  const history = useCityHistory(30);
  const bandColor: Record<string, string> = {
    Good: SEVERITY.good,
    Satisfactory: SEVERITY.fair,
    Moderate: TERM_SEVERITY.caution,
    Poor: TERM_SEVERITY.high,
    'Very Poor': TERM_SEVERITY.severe,
    Severe: TERM.tertiary,
  };
  const bands = history
    ? BAND_ORDER.filter((b) => (history.band_days[b] ?? 0) > 0).map((b) => ({
        label: b,
        days: history.band_days[b],
        color: bandColor[b] ?? TERM.outline,
      }))
    : [];
  const total = bands.reduce((a, b) => a + b.days, 0);
  // CPCB's sensitive-group advice begins at Moderate.
  const aboveSensitive = bands
    .filter((b) => b.label !== 'Good' && b.label !== 'Satisfactory')
    .reduce((a, b) => a + b.days, 0);

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
                  on ? 'text-term-ink' : 'border-term-outline-variant/60 bg-term-surface-c/80 text-term-ink-variant',
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
          <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">
            {history ? `${history.window_days}-Day Exposure Frequency` : 'Exposure Frequency'}
          </h3>
          <Label>Days spent in each CPCB band, from the archive</Label>
        </div>
        {/* Was five literals - 2/6/13/7/2 - summing to thirty under a heading
            that promised thirty days of history nothing had. Bands with no days
            in them are not listed: a row reading "Severe 0d" implies the band
            was checked and nearly reached, and it was simply absent. */}
        <ul className="space-y-2.5 pt-1">
          {bands.length === 0 ? (
            <li className="font-mono text-xs text-term-outline">
              {history ? 'No indexable days in the window' : 'Reading the archive…'}
            </li>
          ) : (
            bands.map((e) => (
              <li key={e.label} className="space-y-1">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="flex items-center gap-2 text-term-ink-variant">
                    <span className="size-2.5 rounded-full" style={{ background: e.color }} />
                    {e.label}
                  </span>
                  <span className="font-bold tabular-nums" style={{ color: e.color }}>
                    {e.days}d
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-term-surface-high">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(e.days / Math.max(total, 1)) * 100}%`, background: e.color }}
                  />
                </div>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-term-outline-variant/40 pt-3 font-mono text-[10px] text-term-ink-variant">
          {history
            ? `${aboveSensitive} of ${total} days above the sensitive-group threshold` +
              (history.days_excluded_thin
                ? ` · ${history.days_excluded_thin} day${history.days_excluded_thin === 1 ? '' : 's'} excluded for thin coverage`
                : '')
            : 'Waiting for the archive'}
        </div>
      </TelemetryCard>
    </div>
  );
}
