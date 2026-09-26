/**
 * Whether the corridor's smoke is coming to Delhi, and when.
 *
 * Every figure here is computed from something measured: the fires from VIIRS,
 * the wind from the station archive for the hours in question, the transit
 * from the two of them. Where a competitor puts "model confidence 78%", this
 * puts the alignment between the flow and the bearing to Delhi against the
 * threshold it is tested at - a number with a meaning and a way to be wrong.
 *
 * The path is derived, never written down. It reads the bands of the clusters
 * the flow is actually carrying, so on a day when only Haryana is upwind it
 * says so instead of drawing Punjab into the story out of habit.
 */
import * as React from 'react';
import { ChevronDown, Navigation, Wind } from 'lucide-react';
import { Label, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import type { FireCorridor } from '@/lib/terminal/firesApi';
import { cn } from '@/lib/utils';

function istClock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** The destination, and the one name that can never be a source of inflow. */
const DESTINATION = 'Delhi NCR';

/**
 * The route the carried clusters actually describe, source end first.
 *
 * Clusters inside the NCR box are dropped from the path rather than drawn into
 * it. A detection in Delhi being "carried to Delhi" is not transport - the
 * advection arithmetic will happily return four hours for a fire twenty
 * kilometres away, and printing that as `DELHI NCR -> DELHI NCR` is how a
 * local field fire gets dressed as an inbound plume from Punjab.
 */
function path(data: FireCorridor): string[] {
  const carrying = data.clusters.filter(
    (c) => c.transit.carrying === true && c.stateApprox !== DESTINATION,
  );
  if (!carrying.length) return [];
  const seen: string[] = [];
  for (const c of [...carrying].sort((a, b) => b.distKm - a.distKm)) {
    if (!seen.includes(c.stateApprox)) seen.push(c.stateApprox);
  }
  return [...seen.slice(0, 3), DESTINATION];
}

/** Carrying clusters that are genuinely upwind of the domain, not inside it. */
function inboundCount(data: FireCorridor): number {
  return data.clusters.filter(
    (c) => c.transit.carrying === true && c.stateApprox !== DESTINATION,
  ).length;
}

function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'warn' | 'calm';
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-term-outline-variant/60 bg-term-surface-low p-3">
      <Label className="block">{label}</Label>
      <div
        className={cn(
          'mt-0.5 font-display text-lg font-extrabold leading-none tabular-nums text-term-ink',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'calm' && 'text-term-primary',
        )}
      >
        {value}
      </div>
      {sub && <span className="mt-1 block font-mono text-[10px] leading-tight text-term-ink-variant">{sub}</span>}
    </div>
  );
}

export function ArrivalStrip({ data }: { data: FireCorridor }) {
  const [open, setOpen] = React.useState(false);
  const t = data.transport;
  const route = path(data);
  const carrying = t.carryingClusters;
  const inbound = inboundCount(data);
  // The earliest arrival has to come from an inbound cluster for the same
  // reason the path does: a fire already inside the domain has nothing to
  // travel, and its four hours would headline the panel over a real plume.
  // The share is recomputed over inbound clusters rather than taken from the
  // payload's `carrying_frp_share_pct`, which counts anything the flow moves
  // including fires already inside NCR - "0 inbound" beside "20.7% carried"
  // is two true numbers that cannot both be about the same thing.
  const inboundShare = Math.round(
    data.clusters
      .filter((c) => c.transit.carrying === true && c.stateApprox !== 'Delhi NCR')
      .reduce((a, c) => a + c.frpSharePct, 0) * 10,
  ) / 10;
  const inboundEtas = data.clusters
    .filter((c) => c.transit.carrying === true && c.stateApprox !== 'Delhi NCR')
    .map((c) => c.transit)
    .sort((a, b) => (a.hours ?? Infinity) - (b.hours ?? Infinity));
  const eta = inboundEtas[0]?.hours ?? null;
  const arrivesAt = inboundEtas[0]?.arrivesAt ?? null;

  return (
    <TelemetryCard className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">
          Smoke Transport &amp; Arrival
        </h3>
        <span
          className={cn(
            'rounded border px-2 py-0.5 font-mono text-[10px] font-bold',
            inbound > 0
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'border-term-primary/40 bg-term-primary/10 text-term-primary',
          )}
        >
          {inbound > 0 ? 'Advective transport active' : 'No transport into NCR'}
        </span>
      </div>

      {route.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-term-ink">
          {route.map((r, i) => (
            <React.Fragment key={r}>
              {i > 0 && <span className="text-term-outline">&rarr;</span>}
              <span className={i === route.length - 1 ? 'text-term-primary' : undefined}>{r}</span>
            </React.Fragment>
          ))}
          <span className="font-normal normal-case text-term-ink-variant">
            (state names approximate)
          </span>
        </div>
      ) : (
        <p className="font-body text-xs leading-relaxed text-term-ink-variant">
          {data.totals.pixels === 0
            ? 'No detections in the corridor for this window. Outside October and November that is the season, not a missing feed.'
            : carrying > 0
              ? `The flow is carrying ${carrying} cluster${carrying === 1 ? '' : 's'}, but every one of them is already inside the NCR domain - these are local detections, not an inbound plume.`
              : 'The flow is not carrying corridor smoke toward Delhi in this window.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Figure
          label="Wind"
          value={
            t.wind ? (
              <span className="flex items-center gap-1.5">
                <Wind className="size-4 text-term-secondary" />
                {t.wind.fromCompass} {Math.round(t.wind.speedKmh)}
                <span className="font-mono text-[10px] font-normal">km/h</span>
              </span>
            ) : (
              '—'
            )
          }
          sub={t.wind ? `from ${Math.round(t.wind.fromDeg)}° · ${t.wind.source}` : t.reason ?? 'no wind loaded'}
        />
        <Figure
          label="Earliest arrival"
          value={eta != null ? `+${Math.round(eta)} h` : '—'}
          sub={
            eta != null
              ? istClock(arrivesAt ?? null) ?? 'from the window origin'
              : carrying > 0
                ? 'the carried clusters are already inside NCR'
                : 'no cluster is being carried'
          }
          tone={eta != null ? 'warn' : undefined}
        />
        <Figure
          label="Clusters inbound"
          value={`${inbound} / ${data.clusters.length}`}
          sub={
            inbound > 0
              ? `${inboundShare}% of corridor radiative power — a share of the burning, not of Delhi's PM2.5`
              : 'nothing upwind is being carried into the domain'
          }
        />
        <Figure
          label="Detections"
          value={data.totals.pixels.toLocaleString()}
          sub={`${Math.round(data.totals.frpTotalMw)} MW total · ${data.window.start} to ${data.window.end ?? data.window.start}`}
        />
      </div>

      {/* Where a confidence percentage would go. This is the number the
          decision is actually made on, printed with the threshold it is tested
          against, so a reader can see how close the call was. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-term-outline-variant/40 pt-2 font-mono text-[11px] text-term-ink-variant">
        <span className="flex items-center gap-1.5 font-bold text-term-primary">
          <Navigation className="size-3.5" />
          {t.wind ? `FLOW BEARING ${Math.round(t.wind.toDeg)}°` : 'FLOW UNKNOWN'}
        </span>
        <span>
          alignment threshold {t.alignMin} · horizon {Math.round(t.horizonH)} h
        </span>
        {data.smoke?.sharePct != null && (
          <span title={data.smoke.note}>
            forecast smoke share {data.smoke.sharePct}%
          </span>
        )}
      </div>

      {t.assumptions.length > 0 && (
        <div className="border-t border-term-outline-variant/40 pt-2">
          {/* The load-bearing one is never folded away. The other two are one
              click down because three paragraphs of caveat above the numbers
              is how a caveat stops being read. */}
          <p className="font-body text-[11px] leading-relaxed text-term-ink-variant">
            {t.assumptions[0]}
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1 flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-term-ink-variant transition-colors hover:text-term-primary"
          >
            <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
            {open ? 'Fewer' : `All ${t.assumptions.length} assumptions`}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1 font-body text-[11px] leading-relaxed text-term-ink-variant">
              {t.assumptions.slice(1).map((a) => (
                <li key={a} className="flex gap-1.5">
                  <span className="text-term-outline">&middot;</span>
                  {a}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </TelemetryCard>
  );
}
