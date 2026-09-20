import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react';
import { Delta, Label, SectionHead, Spark, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { GrapPanel } from './GrapPanel';
import { InversionPanel } from './InversionPanel';
import { INCIDENTS, POLLUTANTS } from '@/lib/terminal/content';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { bySeverity } from '@/lib/terminal/stations';
import { useMesh } from '@/lib/terminal/useMesh';
import { cn } from '@/lib/utils';
import { TERM, TERM_SEVERITY } from '@/lib/terminal/palette';

/** Regional station cards, incident banners and the spectrometry ledger. */
export function OverviewMesh() {
  return (
    <>
      <StationMesh />
      <IncidentBanners />
      <SpectrometryLedger />
    </>
  );
}

/** The six worst nodes, as telemetry cards. */
function StationMesh() {
  const top = bySeverity(useMesh().stations).slice(0, 6);

  return (
    <div id="grid" className="space-y-3">
      <SectionHead
        title="Regional Telemetry Stations Mesh"
        sub="Six highest-load nodes of the 26-station regional array"
        right={
          <Link
            to="/terminal/geo-map"
            className="rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-term-ink transition-colors hover:border-term-primary/60"
          >
            Open geo map
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {top.map((s) => {
          const color = aqiColor(s.aqi);
          const band = bandForAqi(s.aqi);
          return (
            <TelemetryCard
              key={s.id}
              className={cn('space-y-3 p-5', s.master && 'border-2 border-orange-500/70 shadow-[0_0_20px_rgba(249,115,22,0.15)]')}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn('size-2.5 rounded-full', s.master && 'animate-ping')}
                      style={{ background: color }}
                    />
                    <h4 className="text-base font-bold text-term-ink">{s.name}</h4>
                  </div>
                  <Label className="block">
                    {s.zone} zone • {s.agency}
                  </Label>
                </div>
                <div className="text-right">
                  <span className="font-display text-2xl font-extrabold" style={{ color }}>
                    {s.aqi}
                  </span>
                  <div className="font-mono text-[10px] font-bold uppercase" style={{ color }}>
                    {band.label}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 border-y border-term-outline-variant/40 py-2 text-center font-mono text-xs">
                <div>
                  <Label className="block">Dominant</Label>
                  <span className="font-bold text-term-ink">{s.dominant}</span>
                </div>
                <div>
                  <Label className="block">Uptime</Label>
                  <span className="font-bold text-term-primary">{s.uptime}</span>
                </div>
                <div>
                  <Label className="block">Δ24h</Label>
                  <Delta value={s.delta} />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="flex items-center gap-1 font-mono text-xs font-bold text-term-primary">
                  <CheckCircle2 className="size-3.5" />
                  {s.sensors} sensors active
                </span>
                <span className="rounded bg-term-surface-high px-2 py-0.5 font-mono text-[10px] text-term-ink-variant">
                  {s.status}
                </span>
              </div>
            </TelemetryCard>
          );
        })}
      </div>
    </div>
  );
}

const LEVEL_STYLE = {
  CRITICAL: { border: 'border-l-red-500', color: TERM_SEVERITY.severe, icon: CircleAlert, pill: 'bg-red-500/20 text-red-300 border-red-500/40' },
  WARNING: { border: 'border-l-amber-500', color: TERM_SEVERITY.elevated, icon: AlertTriangle, pill: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  ADVISORY: { border: 'border-l-term-secondary', color: TERM.secondary, icon: Info, pill: 'bg-term-secondary/20 text-term-secondary border-term-secondary/40' },
} as const;

function IncidentBanners() {
  return (
    <div id="alerts" className="space-y-3">
      {/* The real advisory first. Everything below it is a hand-written
          scenario: INCIDENTS in lib/terminal/content carries fixed timestamps
          and a fixed affected area, and it is what the "3 PENDING" badge
          counts. It stays for now because the panel would otherwise be bare,
          and it is labelled so it cannot be read as a live feed. */}
      <GrapPanel />

      {/* The mechanism behind the stage above it: GRAP says what to do, this
          says why the air is about to do what it does. */}
      <InversionPanel />

      <SectionHead
        title="Real-Time Incident &amp; Anomaly Warnings"
        right={
          <span className="rounded border border-term-outline-variant/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-term-outline">
            illustrative scenarios
          </span>
        }
      />
      <div className="space-y-3">
        {INCIDENTS.map((a) => {
          const style = LEVEL_STYLE[a.level];
          const Icon = style.icon;
          return (
            <TelemetryCard
              key={a.text}
              className={cn('flex flex-col justify-between gap-3 rounded-xl border-l-4 p-4 sm:flex-row sm:items-center', style.border)}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0" style={{ color: style.color }} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold', style.pill)}>
                      {a.level}
                    </span>
                    <span className="font-mono text-[10px] text-term-ink-variant">{a.time}</span>
                    <span className="rounded border border-term-outline-variant/60 bg-term-surface-high px-1.5 py-0.5 font-mono text-[10px] text-term-ink-variant">
                      {a.zone}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-term-ink">{a.text}</p>
                </div>
              </div>
              <Link
                to={`/terminal/geo-map?station=${a.station}`}
                className="shrink-0 rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-3 py-1.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-term-ink transition-colors hover:border-term-primary"
              >
                Locate on map
              </Link>
            </TelemetryCard>
          );
        })}
      </div>
    </div>
  );
}

function SpectrometryLedger() {
  return (
    <div id="ledger" className="space-y-3">
      <SectionHead
        title="Pollutant Master Spectrometry Ledger"
        sub="The eight channels the CPCB National AQI indexes"
      />
      <TelemetryCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="bg-term-surface-high">
              <tr className="font-mono text-[10px] uppercase tracking-wider text-term-ink-variant">
                {['Channel', 'Formula', 'Reading', 'Threshold', 'Status', 'Δ24h', 'Trajectory', 'Calibration', ''].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POLLUTANTS.map((p) => (
                <tr key={p.id} className="border-b border-term-outline-variant/40 transition-colors hover:bg-term-surface-c/60">
                  <td className="px-4 py-2.5 text-xs font-semibold text-term-ink">{p.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: p.color }}>
                    {p.symbol}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm font-bold text-term-ink">
                    {p.value} <span className="text-[10px] font-normal text-term-ink-variant">{p.unit}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-term-ink-variant">{p.reference}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold"
                      style={{ color: p.color, borderColor: `${p.color}66`, background: `${p.color}1f` }}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <Delta value={p.delta} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Spark values={p.trend} color={p.color} width={72} height={22} className="h-5 w-20" />
                  </td>
                  {/* Was "VERIFIED" on every row — a calibration state this
                      project cannot attest to for readings it did not measure. */}
                  <td className="px-4 py-2.5 font-mono text-xs text-term-ink-variant">SYNTHETIC</td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      className="rounded border border-term-outline-variant/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-term-ink-variant transition-colors hover:border-term-primary hover:text-term-ink"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TelemetryCard>
    </div>
  );
}
