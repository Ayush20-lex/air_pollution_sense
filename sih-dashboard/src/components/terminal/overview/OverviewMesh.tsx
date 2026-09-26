import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react';
import { Delta, Label, SectionHead, SeeAll, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { GrapPanel } from './GrapPanel';
import { InversionPanel } from './InversionPanel';
import { MetSourcePanel } from './MetSourcePanel';
import { useAdvisories } from '@/lib/terminal/advisories';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { bySeverity } from '@/lib/terminal/stations';
import { useMesh } from '@/lib/terminal/useMesh';
import { cn } from '@/lib/utils';
import { TERM, TERM_SEVERITY, useTermPalette, useSeverityInk } from '@/lib/terminal/palette';

/** Regional station cards and the incident banners. */
export function OverviewMesh() {
  return (
    <>
      <StationMesh />
      {/* Previews. Each of these has a page now; Live Telemetry shows enough to
          say whether it is worth opening. */}
      <IncidentBanners limit={2} />
    </>
  );
}

/** The six worst nodes, as telemetry cards. */
function StationMesh() {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
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
                  <span className="font-display text-2xl font-extrabold" style={{ color: ink(color) }}>
                    {s.aqi}
                  </span>
                  <div className="font-mono text-[10px] font-bold uppercase" style={{ color: ink(color) }}>
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
  CRITICAL: { border: 'border-l-red-500', color: TERM_SEVERITY.severe, icon: CircleAlert, pill: 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40' },
  WARNING: { border: 'border-l-amber-500', color: TERM_SEVERITY.elevated, icon: AlertTriangle, pill: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40' },
  ADVISORY: { border: 'border-l-term-secondary', get color() { return TERM.secondary; }, icon: Info, pill: 'bg-term-secondary/20 text-term-secondary border-term-secondary/40' },
} as const;

/**
 * Warnings, whole or as a preview.
 *
 * `limit` shows only the first few. The panels above the list - GRAP, the
 * inversion scoring, the meteorology source - are dropped entirely in a
 * preview rather than truncated: each is a single indivisible statement, and
 * half of one is worse than a link to it.
 */
export function IncidentBanners({ limit }: { limit?: number } = {}) {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  const { items: all, loading } = useAdvisories();
  const items = limit ? all.slice(0, limit) : all;
  return (
    <div id="alerts" className="space-y-3">
      {!limit && (
        <>
          <GrapPanel />

          {/* The mechanism behind the stage above it: GRAP says what to do,
              this says why the air is about to do what it does. */}
          <InversionPanel />

          {/* The meteorology the project reads but does not forecast from.
              Renders only while the committed cycle still covers future hours;
              expired or missing, it draws nothing. It feeds no forecast, so its
              staleness moves no figure here, and a dead panel on the overview
              only spends a reader's confidence in numbers it does not touch.
              /api/v1/status reports the source in either state. */}
          <MetSourcePanel />
        </>
      )}

      <SectionHead
        title="Incident &amp; Anomaly Warnings"
        sub="Derived from the inversion scoring, the GRAP stage and the mesh's own health"
        right={
          limit ? (
            <SeeAll to="/terminal/warnings">
              {all.length === 0 ? 'Open warnings' : `All ${all.length} active`}
            </SeeAll>
          ) : (
            <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
              {all.length === 0 ? 'nothing active' : `${all.length} active`}
            </span>
          )
        }
      />
      {items.length === 0 ? (
        <TelemetryCard className="p-5">
          <div className="flex items-center gap-3">
            <Info className="size-5 shrink-0 text-term-primary" />
            <div>
              <div className="font-display text-base font-bold text-term-primary">
                {loading ? 'Checking the forecast…' : 'No active warnings'}
              </div>
              <div className="mt-0.5 font-mono text-xs text-term-ink-variant">
                {loading
                  ? 'Reading the inversion scoring and the policy engine.'
                  : 'No GRAP stage in force, no zone trapping below the threshold, and the mesh is reporting in full.'}
              </div>
            </div>
          </div>
        </TelemetryCard>
      ) : (
      <div className="space-y-3">
        {items.map((a) => {
          const style = LEVEL_STYLE[a.level];
          const Icon = style.icon;
          return (
            <TelemetryCard
              key={a.id}
              className="flex flex-col justify-between gap-3 rounded-xl p-4 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0" style={{ color: ink(style.color) }} />
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
              {/* The old rows carried a hand-picked station id to deep-link
                  to. These advisories are regional - an inversion covers a
                  basin and a GRAP stage covers the city - so the link goes to
                  the map itself rather than inventing a station to blame. */}
              <Link
                to="/terminal/geo-map"
                className="shrink-0 rounded-lg border border-term-outline-variant/60 bg-term-surface-high px-3 py-1.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-term-ink transition-colors hover:border-term-primary"
              >
                Open map
              </Link>
            </TelemetryCard>
          );
        })}
      </div>
      )}
    </div>
  );
}
