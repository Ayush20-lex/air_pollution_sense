import * as React from 'react';
import { AlertTriangle, CircleAlert, Info, Search } from 'lucide-react';
import { Delta, Label, SectionHead, Spark, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { AnimatedNumber, useRollDuration } from '@/components/terminal/MeshOdometer';
import { useAdvisories } from '@/lib/terminal/advisories';
import type { LiveStation } from '@/lib/terminal/meshApi';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { type TerminalFrame } from '@/lib/terminal/field';
import { useMeasuredWind } from '@/lib/terminal/plumes';
import { bySeverity, zoneSummary } from '@/lib/terminal/stations';
import { useMesh } from '@/lib/terminal/useMesh';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/store/useTerminalStore';
import { useAppStore } from '@/store/useAppStore';
import { TERM, TERM_SEVERITY, useTermPalette, useSeverityInk } from '@/lib/terminal/palette';

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
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  const { stations } = useMesh();
  const zones = zoneSummary(stations);

  return (
    <div className="space-y-3">
      <SectionHead
        title="Zone Severity Index"
        right={
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            <span className="size-2 rounded-full bg-term-primary" />
            {stations.length} nodes aggregated
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {zones.map((z) => {
          const color = aqiColor(z.mean);
          const band = bandForAqi(z.mean);
          return (
            <TelemetryCard key={z.zone} className="relative space-y-2 overflow-hidden rounded-xl p-4">
              <Label className="block">{z.zone} zone</Label>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-extrabold" style={{ color: ink(color) }}>
                  {z.mean}
                </span>
                <span className="font-mono text-[10px] font-bold uppercase" style={{ color: ink(color) }}>
                  {band.label}
                </span>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="rounded border border-term-outline-variant/60 bg-term-surface-high px-1.5 py-0.5 text-term-ink-variant">
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
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  const ranked = bySeverity(useMesh().stations);

  const selectedId = useTerminalStore((s) => s.selectedId);
  const select = useTerminalStore((s) => s.select);
  const query = useTerminalStore((s) => s.query);
  const setQuery = useTerminalStore((s) => s.setQuery);
  const rollMs = useRollDuration();

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? ranked.filter(
        (s) => s.name.toLowerCase().includes(needle) || s.zone.toLowerCase().includes(needle),
      )
    : ranked;

  return (
    <TelemetryCard className="p-5 lg:col-span-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Mesh Ranking — Worst to Best</h3>
        <div className="flex items-center gap-2">
          {/* The filter sits here rather than in the header: this list is the
              only thing it narrows, so beside the rows is the one place its
              effect is visible as you type. */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-term-ink-variant" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter nodes"
              aria-label="Filter the mesh ranking by station or zone"
              className="w-36 rounded-md border border-term-outline-variant/70 bg-term-surface-c py-1 pl-7 pr-2 font-body text-[11px] text-term-ink outline-none placeholder:text-term-outline focus:border-term-secondary focus:ring-1 focus:ring-term-secondary"
            />
          </div>
          <Label>Click a row to locate</Label>
        </div>
      </div>

      <div className="max-h-[430px] space-y-0.5 overflow-y-auto pr-1">
        {rows.map((s, i) => {
          // See GeoRail: the frame can lag the mesh by one render.
          const sample = frame.nodes[s.id];
          if (!sample) return null;
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
              <span className="w-6 shrink-0 font-mono text-[10px] text-term-outline">#{i + 1}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-term-ink">{s.name}</span>
                <Label className="block">
                  {s.zone} • {s.agency}
                </Label>
              </span>
              {/* The station's own recorded window. This was nodeSeries(i + 7,
                  aqi) - a linear congruential generator seeded on the row
                  index, so the shape of a node's "trend" was decided by where
                  it happened to sort. A station with no history yet draws
                  nothing rather than a line that means nothing. */}
              {(() => {
                const hourly = 'hourly' in s ? (s.hourly?.pm25 ?? []) : [];
                const pts = hourly.filter((v): v is number => v != null);
                return pts.length > 1 ? (
                  <Spark
                    values={pts}
                    color={color}
                    width={48}
                    height={16}
                    className="hidden h-4 w-12 shrink-0 sm:block"
                  />
                ) : (
                  <span className="hidden h-4 w-12 shrink-0 sm:block" />
                );
              })()}
              <span className="w-10 shrink-0 text-right font-mono text-sm font-bold" style={{ color: ink(color) }}>
                <AnimatedNumber value={sample.aqi} duration={rollMs} />
              </span>
              <span className="w-14 shrink-0 text-right text-[10px]">
                <Delta value={s.delta} />
              </span>
            </button>
          );
        })}
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-xs text-term-outline">
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
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  // The layer depth at the hour on the timeline, not a constant. The prose used
  // to say 412 m while the panel below reported 50.
  const live = useAppStore((st) => st.liveFrames)?.[0];
  const wind = useMeasuredWind(0);
  const pbl = live?.avgPbl ?? null;
  const inv = live?.inversionIndex ?? null;
  // Mixing depth x transport wind, the standard ventilation index in m2/s.
  const ventilation = pbl != null && wind ? pbl * (wind.speedKmh / 3.6) : null;
  return (
    // Flex column so the cross-section absorbs whatever height the taller
    // ranking card forces on this one, instead of leaving a void at the foot.
    <TelemetryCard className="flex h-full flex-col gap-3 p-5 lg:col-span-5">
      <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Topographic Trapping Profile</h3>
      <p className="font-body text-[11px] leading-relaxed text-term-ink-variant">
        Cross-section looking north. The Aravalli range to the south-west and the Himalayan foothills to
        the north-east form a closed basin; the inversion lid currently caps vertical mixing at{' '}
        {pbl == null ? 'the forecast layer depth' : `${pbl.toFixed(0)} m`}.
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
          INVERSION LID — {pbl == null ? '—' : `${pbl.toFixed(0)} m`}
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
          <Label className="block">Mixing depth</Label>
          <span className="font-mono text-sm font-bold text-term-ink">
            {pbl == null ? '—' : `${pbl.toFixed(0)} m`}
          </span>
        </div>
        <div>
          {/* This slot read "Mixing depth 0.38" - a dimensionless index under a
              label that means a height in metres. The index belongs here and
              the depth belongs beside it, which is now how they sit. */}
          <Label className="block">Inversion index</Label>
          <span className="font-mono text-sm font-bold text-orange-700 dark:text-orange-400">
            {inv == null ? '—' : inv.toFixed(2)}
          </span>
        </div>
        <div>
          <Label className="block">Ventilation idx</Label>
          <span className="font-mono text-sm font-bold text-term-ink">
            {ventilation == null ? '—' : `${Math.round(ventilation).toLocaleString('en-IN')} m²/s`}
          </span>
        </div>
      </div>
    </TelemetryCard>
  );
}

const STATUS_PILL: Record<string, string> = {
  ONLINE: 'border-term-primary/40 bg-term-primary/15 text-term-primary',
  DEGRADED: 'border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300',
  CALIBRATING: 'border-term-secondary/40 bg-term-secondary/20 text-term-secondary',
};

/** "2025-12-28T23:00:00+00:00" -> "28 Dec 04:30 IST". */
function hourLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata', hour12: false,
  })} IST`;
}

function NodeLedger({ frame }: { frame: TerminalFrame }) {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  const mesh = useMesh();
  const ranked = bySeverity(mesh.stations);

  const select = useTerminalStore((s) => s.select);
  const selectedId = useTerminalStore((s) => s.selectedId);
  const rollMs = useRollDuration();

  // Every column but one is measured once the mesh is live. "Inflow source" is
  // not - it is an editorial attribution of the upwind sector, and the archive
  // has nothing to derive it from. Marking it is the whole point: an invented
  // column sitting unlabelled beside measured ones is what this page was
  // fixing, and reintroducing it one column over would be no better.
  const columns = [
    'Node', 'Zone', 'Agency', 'Latitude', 'Longitude', 'AQI',
    'Dominant', mesh.live ? 'Inflow source †' : 'Inflow source',
    'Δ24h', 'Sensors', 'Uptime', 'Status',
  ];

  return (
    <div id="ledger" className="space-y-3">
      <SectionHead
        title="Regional Node Ledger"
        sub={
          mesh.live
            ? mesh.feed === 'waqi_live'
              ? `${mesh.stations.length} CPCB stations reporting live — PM2.5, PM10 and O₃ from each station's sensors, indexed under the National AQI`
              : `${mesh.stations.length} stations from the replayed archive — PM2.5, PM10, NO₂, O₃ and SO₂, indexed under the National AQI`
            : `${mesh.stations.length} CPCB / DPCC / HSPCB / UPPCB monitoring stations across the National Capital Region`
        }
        right={
          /* This read "demo values" for as long as it was true. The readings
             now come from the archive, so the label follows them rather than
             being pinned either way — understating measured data invites a
             reader to discount it. */
          <span
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-term-ink-variant"
            title={mesh.note ?? undefined}
          >
            <span className={`size-2 rounded-full ${mesh.live ? 'bg-term-primary' : 'bg-amber-400'}`} />
            {/* Live and archive are both measured; what differs is how long
                ago. Saying only "measured" for a reading 42 hours old, beside
                one from this hour, would flatten the distinction that matters
                most on this page. */}
            {mesh.live
              ? mesh.feed === 'waqi_live'
                ? `${mesh.index} · live ${hourLabel(mesh.asOf)}`
                : `${mesh.index} · archive ${hourLabel(mesh.asOf)}`
              : 'CPCB National AQI · demo values'}
          </span>
        }
      />
      <TelemetryCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left">
            <thead className="bg-term-surface-high">
              <tr className="font-mono text-[10px] uppercase tracking-wider text-term-ink-variant">
                {columns.map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((s) => {
                const sample = frame.nodes[s.id];
                if (!sample) return null;
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
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-term-ink">{s.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-term-ink-variant">{s.zone}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-term-ink-variant">{s.agency}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{s.lat.toFixed(4)}°N</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{s.lng.toFixed(4)}°E</td>
                    <td className="px-4 py-2.5 font-mono text-sm font-bold" style={{ color: ink(color) }}>
                      <AnimatedNumber value={sample.aqi} duration={rollMs} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded border border-term-outline-variant/60 bg-term-surface-high px-1.5 py-0.5 font-mono text-[10px] text-term-ink-variant">
                        {s.dominant}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-body text-[11px] text-term-ink-variant">{s.source}</td>
                    <td className="px-4 py-2.5 text-[11px]">
                      <Delta value={s.delta} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-ink">{s.sensors}</td>
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
        {mesh.live && (
          <p className="px-4 pb-3 pt-1 font-body text-[11px] leading-relaxed text-slate-500">
            <span className="font-mono">†</span> Inflow source is an editorial
            attribution of the upwind sector, not a measurement — the archive has
            nothing to derive it from. Every other column on this row comes from
            the station's own sensors.
            {Object.keys(mesh.excluded).length > 0 && (
              <>
                {' '}
                {Object.keys(mesh.excluded).join(', ').toUpperCase()} is excluded
                from the index:{' '}
                <span title={Object.values(mesh.excluded)[0]}>
                  its catalogued unit is contradicted by its own values
                </span>
                .
              </>
            )}
          </p>
        )}
      </TelemetryCard>
    </div>
  );
}

const ALERT_STYLE = {
  CRITICAL: { border: 'border-l-red-500', color: TERM_SEVERITY.severe, Icon: CircleAlert, pill: 'border-red-500/40 bg-red-500/20 text-red-700 dark:text-red-300' },
  WARNING: { border: 'border-l-amber-500', color: TERM_SEVERITY.elevated, Icon: AlertTriangle, pill: 'border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300' },
  ADVISORY: { border: 'border-l-term-secondary', get color() { return TERM.secondary; }, Icon: Info, pill: 'border-term-secondary/40 bg-term-secondary/20 text-term-secondary' },
} as const;

function SpatialAlerts() {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  const { items } = useAdvisories();

  return (
    <div id="alerts" className="space-y-3">
      <SectionHead
        title="Spatial Anomaly Warnings"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {items.length === 0 ? 'nothing active' : `${items.length} active`}
          </span>
        }
      />
      {items.length === 0 ? (
        <TelemetryCard className="p-5">
          <span className="font-mono text-xs text-term-ink-variant">
            No GRAP stage in force, no zone trapping below the threshold, and the mesh is
            reporting in full.
          </span>
        </TelemetryCard>
      ) : (
      <div className="space-y-3">
        {items.map((a) => {
          const style = ALERT_STYLE[a.level];
          return (
            <TelemetryCard
              key={a.id}
              className="flex flex-col justify-between gap-3 rounded-xl p-4 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-3">
                <style.Icon className="mt-0.5 size-5 shrink-0" style={{ color: ink(style.color) }} />
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
              {/* These advisories are regional, so there is no single station
                  to select; the button scrolls to the map instead of picking
                  one to blame. */}
              <button
                type="button"
                onClick={() =>
                  document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className="shrink-0 rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-term-ink transition-colors hover:border-term-primary"
              >
                Show map
              </button>
            </TelemetryCard>
          );
        })}
      </div>
      )}
    </div>
  );
}

/**
 * What the mesh actually covers.
 *
 * This strip read "Mesh Coverage 94.2%", "Interpolation Confidence 96.8%",
 * "Spatial Resolution 250 m" and "Last Full Sweep 12s ago", all four from a
 * literal with a hand-drawn sparkline under it. Invented quality claims about a
 * real system are a worse class of fabrication than an invented reading: a
 * wrong PM2.5 is one wrong number, while a confidence figure is a statement
 * about how much the other numbers can be trusted.
 *
 * Three of the four have a real counterpart and now use it. "Interpolation
 * Confidence" does not - nothing in this system scores the interpolation, the
 * leave-one-station-out work in ml_pipeline/scripts/17 is offline and produces
 * no live figure - so it is gone rather than approximated.
 *
 * The resolution claim was wrong as well as invented. The forecast grid is
 * 70x80 over a 78 km domain, which is about 1 km a cell; the map's heat canvas
 * renders at roughly 100 m a pixel, but that is a drawing detail and carries no
 * information the stations did not have. The honest figure is the grid's.
 */
function CoverageStrip() {
  const mesh = useMesh();
  // Ticks so "last sweep" ages on screen. Kept as state rather than reading
  // Date.now() during render, which is impure and was caught here once before.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const live = mesh.stations.filter((st): st is LiveStation => 'meshId' in st);
  const windows = live.map((st) => st.coveragePct).filter((v) => Number.isFinite(v));
  const meanWindow = windows.length
    ? windows.reduce((a, b) => a + b, 0) / windows.length
    : null;
  const notIndexed = mesh.dropped.length + mesh.unindexed.length;
  const sweptSecs = mesh.fetchedAt ? Math.max(0, Math.round((now - mesh.fetchedAt) / 1000)) : null;

  const cards: { label: string; value: string; unit: string; note: string }[] = [
    {
      label: 'Stations Reporting',
      value: String(live.length),
      unit: '',
      note: notIndexed > 0 ? `${notIndexed} measuring but not indexable` : 'all indexable',
    },
    {
      label: 'Window Coverage',
      value: meanWindow == null ? '—' : meanWindow.toFixed(1),
      unit: meanWindow == null ? '' : '%',
      note: 'mean share of the 24h window reported',
    },
    {
      label: 'Grid Resolution',
      value: '1.1 × 1.0',
      unit: ' km',
      note: '70 × 80 cells over the NCR domain',
    },
    {
      label: 'Last Sweep',
      value: sweptSecs == null ? '—' : sweptSecs < 90 ? String(sweptSecs) : String(Math.round(sweptSecs / 60)),
      unit: sweptSecs == null ? '' : sweptSecs < 90 ? 's ago' : 'min ago',
      note: mesh.status === 'offline' ? 'backend unreachable' : 'since the mesh last answered',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((k) => (
        <TelemetryCard key={k.label} className="space-y-2 rounded-xl p-4">
          <Label className="block">{k.label}</Label>
          <div className="font-display text-2xl font-extrabold text-term-ink">
            {k.value}
            <span className="font-mono text-sm font-normal text-term-ink-variant">{k.unit}</span>
          </div>
          {/* No sparkline: none of these four has a recorded history, and the
              ones that were drawn here were eight numbers someone chose. */}
          <Label className="block text-term-outline">{k.note}</Label>
        </TelemetryCard>
      ))}
    </div>
  );
}
