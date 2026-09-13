import * as React from 'react';
import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import { Delta, Label, SectionHead, Spark, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { AnimatedNumber, useRollDuration } from '@/components/terminal/MeshOdometer';
import { COVERAGE_KPIS, INCIDENTS } from '@/lib/terminal/content';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { DISPERSION, nodeSeries, type TerminalFrame } from '@/lib/terminal/field';
import { STATIONS, STATIONS_BY_SEVERITY, ZONE_SUMMARY } from '@/lib/terminal/stations';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/store/useTerminalStore';
import { TERM, TERM_SEVERITY } from '@/lib/terminal/palette';

/** Everything below the map on the geo page. */
export function GeoSections({ frame }: { frame: TerminalFrame }) {
  return (
    <>
      <ZoneStrip />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <MeshRanking frame={frame} />
        <TrappingProfile />
      </div>
      <NodeLedger frame={frame} />
      <SpatialAlerts />
      <CoverageStrip />
    </>
  );
}

function ZoneStrip() {
  return (
    <div className="space-y-3">
      <SectionHead
        title="Zone Severity Index"
        right={
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-slate-400">
            <span className="size-2 rounded-full bg-term-primary" />
            {STATIONS.length} nodes aggregated
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {ZONE_SUMMARY.map((z) => {
          const color = aqiColor(z.mean);
          const band = bandForAqi(z.mean);
          return (
            <TelemetryCard key={z.zone} className="relative space-y-2 overflow-hidden rounded-xl p-4">
              <Label className="block">{z.zone} zone</Label>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-extrabold" style={{ color }}>
                  {z.mean}
                </span>
                <span className="font-mono text-[10px] font-bold uppercase" style={{ color }}>
                  {band.label}
                </span>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="rounded border border-term-outline-variant/60 bg-term-surface-high px-1.5 py-0.5 text-slate-300">
                  {z.dominant}
                </span>
                <Delta value={z.delta} />
              </div>
              <Label className="block">
                {z.count} {z.count === 1 ? 'node' : 'nodes'}
              </Label>
              <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: color }} />
            </TelemetryCard>
          );
        })}
      </div>
    </div>
  );
}

/** Worst-to-best node list. Clicking a row selects it on the map. */
function MeshRanking({ frame }: { frame: TerminalFrame }) {
  const selectedId = useTerminalStore((s) => s.selectedId);
  const select = useTerminalStore((s) => s.select);
  const query = useTerminalStore((s) => s.query).trim().toLowerCase();
  const rollMs = useRollDuration();

  const rows = query
    ? STATIONS_BY_SEVERITY.filter(
        (s) => s.name.toLowerCase().includes(query) || s.zone.toLowerCase().includes(query),
      )
    : STATIONS_BY_SEVERITY;

  return (
    <TelemetryCard className="p-5 lg:col-span-7">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold tracking-tight text-white">Mesh Ranking — Worst to Best</h3>
        <Label>Click a row to locate</Label>
      </div>

      <div className="max-h-[430px] space-y-0.5 overflow-y-auto pr-1">
        {rows.map((s, i) => {
          const sample = frame.nodes[s.id];
          const color = aqiColor(sample.aqi);
          const active = selectedId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-pressed={active}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-left transition-colors',
                active ? 'border-orange-500 bg-term-surface-high' : 'border-transparent hover:bg-term-surface-c/60',
              )}
            >
              <span className="w-6 shrink-0 font-mono text-[10px] text-slate-500">#{i + 1}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-white">{s.name}</span>
                <Label className="block">
                  {s.zone} • {s.agency}
                </Label>
              </span>
              <Spark
                values={nodeSeries(i + 7, sample.aqi)}
                color={color}
                width={48}
                height={16}
                className="hidden h-4 w-12 shrink-0 sm:block"
              />
              <span className="w-10 shrink-0 text-right font-mono text-sm font-bold" style={{ color }}>
                <AnimatedNumber value={sample.aqi} duration={rollMs} />
              </span>
              <span className="w-14 shrink-0 text-right text-[10px]">
                <Delta value={s.delta} />
              </span>
            </button>
          );
        })}
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-xs text-slate-500">
            No node matches “{query}”.
          </p>
        ) : null}
      </div>
    </TelemetryCard>
  );
}

/**
 * Side elevation of the basin. The Aravalli range to the south-west and the
 * Himalayan foothills to the north-east close the bowl; the winter inversion
 * caps vertical mixing.
 */
function TrappingProfile() {
  return (
    // Flex column so the cross-section absorbs whatever height the taller
    // ranking card forces on this one, instead of leaving a void at the foot.
    <TelemetryCard className="flex h-full flex-col gap-3 p-5 lg:col-span-5">
      <h3 className="font-display text-sm font-bold tracking-tight text-white">Topographic Trapping Profile</h3>
      <p className="font-body text-[11px] leading-relaxed text-slate-400">
        Cross-section looking north. The Aravalli range to the south-west and the Himalayan foothills to
        the north-east form a closed basin; the winter inversion lid caps vertical mixing at{' '}
        {DISPERSION.boundaryLayer} m.
      </p>

      <div className="flex min-h-0 flex-1 items-center">
        <svg
          viewBox="0 0 400 210"
          className="h-full max-h-[260px] w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Cross-section of the NCR basin showing the inversion lid trapping smog"
        >
        <defs>
          <linearGradient id="term-smog" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TERM_SEVERITY.high} stopOpacity="0.45" />
            <stop offset="100%" stopColor={TERM_SEVERITY.severe} stopOpacity="0.18" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="400" height="210" fill={TERM.bgDeep} />
        <line x1="0" y1="60" x2="400" y2="60" stroke={TERM.secondary} strokeOpacity="0.45" strokeWidth="2" strokeDasharray="6 5" />
        <text x="200" y="52" fill={TERM.secondary} fontSize="9" fontWeight="700" letterSpacing="1.5" textAnchor="middle" fontFamily="var(--font-mono), monospace">
          INVERSION LID — {DISPERSION.boundaryLayer} m
        </text>
        <path d="M 30,150 L 104,132 L 300,132 L 372,138 L 372,60 L 30,60 Z" fill="url(#term-smog)" />
        <path
          d="M 0,170 L 40,140 L 78,155 L 104,132 L 300,132 L 330,150 L 366,128 L 400,146 L 400,190 L 0,190 Z"
          fill={TERM.surfaceLow}
          stroke={TERM.outlineVariant}
          strokeWidth="1.5"
        />
        <g stroke={TERM_SEVERITY.high} strokeOpacity="0.5" strokeWidth="1.2" fill="none">
          <path d="M 120,120 q 20,-14 40,0 t 40,0" />
          <path d="M 150,96 q 20,-14 40,0 t 40,0" />
          <path d="M 180,144 q 20,-12 40,0 t 40,0" />
        </g>
        <text transform="translate(16,146) rotate(-38)" fill={TERM.outline} fontSize="8" fontWeight="700" fontFamily="var(--font-mono), monospace">
          ARAVALLI SW
        </text>
        <text transform="translate(338,120) rotate(-32)" fill={TERM.outline} fontSize="8" fontWeight="700" fontFamily="var(--font-mono), monospace">
          HIMALAYAN NE
        </text>
        <text x="200" y="112" fill={TERM_SEVERITY.highSoft} fontSize="9" fontWeight="700" letterSpacing="1.5" textAnchor="middle" fontFamily="var(--font-mono), monospace">
          TRAPPED SMOG LAYER
        </text>
        <text x="200" y="166" fill={TERM.inkVariant} fontSize="9" fontWeight="700" letterSpacing="1.5" textAnchor="middle" fontFamily="var(--font-mono), monospace">
          DELHI NCR BASIN FLOOR
        </text>
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-term-outline-variant/40 pt-2 text-center">
        <div>
          <Label className="block">Inversion height</Label>
          <span className="font-mono text-sm font-bold text-white">{DISPERSION.boundaryLayer} m</span>
        </div>
        <div>
          <Label className="block">Mixing depth</Label>
          <span className="font-mono text-sm font-bold text-orange-400">{DISPERSION.dispersionIndex}</span>
        </div>
        <div>
          <Label className="block">Ventilation idx</Label>
          <span className="font-mono text-sm font-bold text-white">
            {DISPERSION.ventilationIndex.toLocaleString('en-IN')}
          </span>
        </div>
      </div>
    </TelemetryCard>
  );
}

const STATUS_PILL: Record<string, string> = {
  ONLINE: 'border-term-primary/40 bg-term-primary/15 text-term-primary',
  DEGRADED: 'border-amber-500/40 bg-amber-500/20 text-amber-300',
  CALIBRATING: 'border-term-secondary/40 bg-term-secondary/20 text-term-secondary',
};

function NodeLedger({ frame }: { frame: TerminalFrame }) {
  const select = useTerminalStore((s) => s.select);
  const selectedId = useTerminalStore((s) => s.selectedId);
  const rollMs = useRollDuration();

  const columns = [
    'Node', 'Zone', 'Agency', 'Latitude', 'Longitude', 'AQI',
    'Dominant', 'Inflow source', 'Δ24h', 'Sensors', 'Uptime', 'Status',
  ];

  return (
    <div id="ledger" className="space-y-3">
      <SectionHead
        title="Regional Node Ledger"
        sub={`${STATIONS.length} active CPCB / DPCC / HSPCB / UPPCB monitoring stations across the National Capital Region`}
        right={
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-slate-400">
            <span className="size-2 rounded-full bg-amber-400" />
            CPCB National AQI · demo values
          </span>
        }
      />
      <TelemetryCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left">
            <thead className="bg-term-surface-high">
              <tr className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                {columns.map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STATIONS_BY_SEVERITY.map((s) => {
                const sample = frame.nodes[s.id];
                const color = aqiColor(sample.aqi);
                const active = selectedId === s.id;
                return (
                  <tr
                    key={s.id}
                    onClick={() => select(s.id)}
                    className={cn(
                      'cursor-pointer border-b border-term-outline-variant/40 transition-colors hover:bg-term-surface-c/60',
                      active && 'border-l-2 border-l-orange-500 bg-orange-500/5',
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-white">{s.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">{s.zone}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-slate-300">{s.agency}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{s.lat.toFixed(4)}°N</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{s.lng.toFixed(4)}°E</td>
                    <td className="px-4 py-2.5 font-mono text-sm font-bold" style={{ color }}>
                      <AnimatedNumber value={sample.aqi} duration={rollMs} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded border border-term-outline-variant/60 bg-term-surface-high px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        {s.dominant}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-body text-[11px] text-slate-400">{s.source}</td>
                    <td className="px-4 py-2.5 text-[11px]">
                      <Delta value={s.delta} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-white">{s.sensors}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-primary">{s.uptime}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold', STATUS_PILL[s.status])}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TelemetryCard>
    </div>
  );
}

const ALERT_STYLE = {
  CRITICAL: { border: 'border-l-red-500', color: TERM_SEVERITY.severe, Icon: CircleAlert, pill: 'border-red-500/40 bg-red-500/20 text-red-300' },
  WARNING: { border: 'border-l-amber-500', color: TERM_SEVERITY.elevated, Icon: AlertTriangle, pill: 'border-amber-500/40 bg-amber-500/20 text-amber-300' },
  ADVISORY: { border: 'border-l-term-secondary', color: TERM.secondary, Icon: Info, pill: 'border-term-secondary/40 bg-term-secondary/20 text-term-secondary' },
} as const;

function SpatialAlerts() {
  const select = useTerminalStore((s) => s.select);

  return (
    <div id="alerts" className="space-y-3">
      <SectionHead title="Spatial Anomaly Warnings" />
      <div className="space-y-3">
        {INCIDENTS.map((a) => {
          const style = ALERT_STYLE[a.level];
          return (
            <TelemetryCard
              key={a.text}
              className={cn('flex flex-col justify-between gap-3 rounded-xl border-l-4 p-4 sm:flex-row sm:items-center', style.border)}
            >
              <div className="flex items-start gap-3">
                <style.Icon className="mt-0.5 size-5 shrink-0" style={{ color: style.color }} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded border px-2 py-0.5 font-mono text-[10px] font-bold', style.pill)}>
                      {a.level}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{a.time}</span>
                    <span className="rounded border border-term-outline-variant/60 bg-term-surface-high px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      {a.zone}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-white">{a.text}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  select(a.station);
                  document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="shrink-0 rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:border-term-primary"
              >
                Locate on map
              </button>
            </TelemetryCard>
          );
        })}
      </div>
    </div>
  );
}

function CoverageStrip() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {COVERAGE_KPIS.map((k) => (
        <TelemetryCard key={k.label} className="space-y-2 rounded-xl p-4">
          <Label className="block">{k.label}</Label>
          <div className="font-display text-2xl font-extrabold text-white">
            {k.value}
            <span className="font-mono text-sm font-normal text-slate-400">{k.unit}</span>
          </div>
          <Spark values={k.series} color={k.color} className="h-10 w-full" />
        </TelemetryCard>
      ))}
    </div>
  );
}
