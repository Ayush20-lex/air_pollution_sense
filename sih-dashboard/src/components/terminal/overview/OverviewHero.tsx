import * as React from 'react';
import { HeartPulse, Hospital, Radio, Share2, Thermometer, Wind } from 'lucide-react';
import { Label, Meter, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { ADVISORY_TEXT, BIOMETRIC_IMPACTS, CPCB_SCALE, HUB } from '@/lib/terminal/content';
import { aqiColor } from '@/lib/terminal/bands';
import { cn } from '@/lib/utils';
import { TERM } from '@/lib/terminal/palette';

/** Status banner + hero gauge + public health advisory. */
export function OverviewHero() {
  return (
    <>
      <StatusBanner />
      <div id="overview" className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <AqiGauge />
        <HealthAdvisory />
      </div>
    </>
  );
}

function StatusBanner() {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-term-outline-variant/40 pb-1 lg:flex-row lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-term-ink lg:text-3xl">
            AIR Quality Overview
          </h1>
          <span className="rounded border border-orange-500/40 bg-orange-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-orange-400">
            {HUB.station}
          </span>
        </div>
        <p className="mt-1 font-body text-sm text-term-ink-variant">
          High-frequency optical spectrometry stream &amp; distributed meteorological telemetry
        </p>
      </div>
      <div className="flex items-center gap-3">
        <StatPill icon={<Radio className="size-4 text-term-primary" />} label="Mesh Stream Sync" value={HUB.sampleRate} />
        <StatPill
          icon={<Thermometer className="size-4 text-term-secondary" />}
          label="Readings"
          value="Demo values"
          valueClass="text-term-primary"
        />
      </div>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-term-outline-variant/60 bg-term-surface-c px-3 py-1.5 font-mono text-xs text-term-ink-variant">
      {icon}
      <span>
        {label}: <strong className={cn('text-term-ink', valueClass)}>{value}</strong>
      </span>
    </div>
  );
}

/** Radial composite-index gauge with the CPCB category scale beside it. */
function AqiGauge() {
  const color = aqiColor(HUB.aqi);
  const circumference = 515;
  // 0-300 maps onto the arc; the track is drawn with the same dash geometry.
  const offset = circumference - circumference * Math.min(1, HUB.aqi / 300) * 0.8;

  return (
    <TelemetryCard focus className="relative flex flex-col justify-between overflow-hidden p-6 lg:col-span-7">
      <div className="pointer-events-none absolute -right-16 -top-16 size-96 rounded-full bg-orange-500/10 blur-3xl" />

      <div className="relative z-10 flex items-start justify-between">
        <div>
          <Label>Composite Air Quality Index (CPCB National AQI)</Label>
          <div className="mt-0.5 font-display text-xl font-bold text-term-ink">{HUB.sector}</div>
          <div className="mt-1 flex items-center gap-2 font-mono text-xs text-term-ink-variant">
            <span>Updated {HUB.updatedSeconds}s ago</span>
            <span className="inline-block size-1.5 rounded-full bg-slate-600" />
            <span className="font-bold text-orange-400">↑ {HUB.delta}% Increased</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-orange-500/50 bg-orange-500/20 px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-orange-300 shadow-[0_0_15px_rgba(249,115,22,0.3)]">
          <span className="size-2.5 animate-pulse rounded-full bg-orange-500" />
          {HUB.advisoryBand}
        </div>
      </div>

      <div className="relative z-10 my-6 grid grid-cols-1 items-center gap-6 sm:grid-cols-12">
        <div className="flex flex-col items-center justify-center sm:col-span-6">
          <div className="relative flex size-60 items-center justify-center">
            <svg className="size-full -rotate-90" viewBox="0 0 200 200" aria-hidden="true">
              <circle
                cx="100"
                cy="100"
                r="82"
                fill="none"
                stroke={TERM.surfaceRaised}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset="100"
              />
              <circle
                cx="100"
                cy="100"
                r="82"
                fill="none"
                stroke={color}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                className="transition-[stroke-dashoffset] duration-1000 ease-out"
                style={{ filter: `drop-shadow(0 0 8px ${color}b3)` }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Label>Current AQI</Label>
              <span className="font-display text-6xl font-extrabold leading-none text-term-ink">
                {HUB.aqi}
              </span>
              <span className="mt-1 font-mono text-xs font-bold" style={{ color }}>
                {HUB.band}
              </span>
              <span className="font-mono text-[10px] text-term-ink-variant">PM2.5 Dominant</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 sm:col-span-6">
          <Label>CPCB National AQI Categories</Label>
          <ul className="space-y-1.5">
            {CPCB_SCALE.map((b) => {
              // Highlight the band the reading is actually in. The old scale
              // hardcoded the highlight on one row, so it stayed on Sensitive
              // Groups whatever the gauge said.
              const active = HUB.aqi >= b.from && HUB.aqi <= b.to;
              return (
                <li
                  key={b.label}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors',
                    active
                      ? 'border-term-primary/40 bg-term-primary/10 text-term-ink'
                      : 'border-transparent text-term-ink-variant',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: b.color }} />
                    <span className={cn(active && 'font-bold')}>{b.label}</span>
                  </span>
                  <span className="tabular-nums">
                    {b.range}
                    {active ? ' ★' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-3 gap-3 border-t border-term-outline-variant/40 pt-4 text-center">
        <MicroStat label="24h Min / Max" value={`${HUB.min24} / ${HUB.max24} AQI`} />
        <MicroStat label="Dominant Stressor" value={HUB.dominant} valueClass="text-orange-400" />
        <MicroStat label="Sensor Confidence" value={HUB.confidence} valueClass="text-term-primary" />
      </div>
    </TelemetryCard>
  );
}

function MicroStat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <Label className="block">{label}</Label>
      <span className={cn('font-mono text-sm font-bold text-term-ink', valueClass)}>{value}</span>
    </div>
  );
}

/** Public health guidance and the biometric impact meters. */
function HealthAdvisory() {
  const icons = [HeartPulse, Hospital, Thermometer, Wind];

  return (
    <TelemetryCard className="space-y-4 p-6 lg:col-span-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-term-ink">
          <Hospital className="size-5 text-term-secondary" />
          Air Quality Advisory
        </h2>
        <span className="rounded border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
          Level 3 Caution
        </span>
      </div>

      <p className="font-body text-xs leading-relaxed text-term-ink-variant">
        <span className="font-semibold text-term-ink">Notice: </span>
        {ADVISORY_TEXT}
      </p>

      <div className="space-y-3 border-t border-term-outline-variant/40 pt-3">
        <Label>Biometric Impact Threat Assessments</Label>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {BIOMETRIC_IMPACTS.map((b, i) => {
            const Icon = icons[i % icons.length];
            return (
              <div
                key={b.label}
                className="space-y-1.5 rounded-xl border border-term-outline-variant/60 bg-term-surface-low p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-term-ink-variant">
                    <Icon className="size-3.5" style={{ color: b.color }} />
                    {b.label}
                  </span>
                  <span className="font-mono text-[10px] font-bold" style={{ color: b.color }}>
                    {b.level}
                  </span>
                </div>
                <Meter pct={b.pct} color={b.color} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-term-outline-variant/40 pt-3">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-term-ink transition-colors hover:border-term-primary/50"
        >
          <Share2 className="size-3.5 text-term-primary" />
          Broadcast Advisory
        </button>
        <button
          type="button"
          className="rounded-lg border border-term-outline-variant/60 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-term-ink-variant transition-colors hover:text-term-ink"
        >
          Details
        </button>
      </div>
    </TelemetryCard>
  );
}
