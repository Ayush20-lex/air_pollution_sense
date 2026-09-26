/**
 * What is burning upwind, by region and by cluster.
 *
 * Everything in the table is either a measurement or a distance computed from
 * one. FRP is VIIRS's own radiative power; the confidence letters are VIIRS's
 * own per-pixel flag, not a score invented here; the type column is FIRMS's
 * classification, which is why a window of near-real-time detections reports
 * them as untyped rather than quietly calling them all crop fires.
 *
 * The region names carry "approx." wherever they appear, and the method that
 * produced them is printed under the table rather than left to be discovered -
 * a rectangle cannot follow the Punjab-Haryana border, and a reader comparing
 * these counts with a state bulletin deserves to know that before they do.
 */
import * as React from 'react';
import { Flame } from 'lucide-react';
import { Label, Meter, Pill } from '@/components/terminal/TerminalPrimitives';
import type { FireCorridor } from '@/lib/terminal/firesApi';
import { cn } from '@/lib/utils';

const CONFIDENCE_WORD: Record<string, string> = { l: 'low', n: 'nominal', h: 'high' };

function frpColor(frp: number): string {
  if (frp >= 40) return '#FFF3B0';
  if (frp >= 20) return '#FFC24A';
  if (frp >= 8) return '#FF8A3D';
  return '#F2552C';
}

function ageLabel(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return '<1h';
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/** The dominant confidence flag, as a word rather than a letter. */
function topConfidence(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (!entries.length) return '—';
  const [k, n] = entries.sort((a, b) => b[1] - a[1])[0];
  return `${n} ${CONFIDENCE_WORD[k] ?? k}`;
}

export function FireHotspots({ data }: { data: FireCorridor }) {
  const [all, setAll] = React.useState(false);
  const rows = all ? data.clusters : data.clusters.slice(0, 8);
  const strongest = data.clusters[0]?.frpTotalMw ?? 1;
  const types = Object.entries(data.totals.types);

  if (!data.totals.pixels) {
    return (
      <div className="rounded-2xl border border-term-outline-variant/60 bg-term-surface-low p-5">
        <Label className="block">Regional sources</Label>
        <p className="mt-2 font-body text-xs leading-relaxed text-term-ink-variant">
          NASA FIRMS reports no thermal anomalies over the corridor for{' '}
          {data.window.start} to {data.window.end ?? data.window.start}. The burning season
          runs from mid-October to late November; outside it, an empty corridor is the
          measurement, not a gap in the feed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Regions first, because the question a reader arrives with is "where",
          and a rollup answers it in one line where a table of 24 clusters does
          not. */}
      <div className="flex flex-wrap gap-1.5" title={data.regionMethod}>
        {data.regions.slice(0, 6).map((r) => (
          <Pill key={`${r.band}-${r.stateApprox}`} color={frpColor(r.frpMaxMw)}>
            {r.stateApprox} <span className="opacity-60">approx.</span> · {r.pixels} ·{' '}
            {Math.round(r.frpTotalMw)} MW
          </Pill>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-term-ink-variant">
        <span className="flex items-center gap-1 font-semibold text-term-ink">
          <Flame className="size-3 text-amber-500" />
          {data.totals.pixels.toLocaleString()} detections
        </span>
        {types.map(([k, n]) => (
          <span key={k}>
            {n} {k}
          </span>
        ))}
        <span>{Math.round(data.totals.frpTotalMw)} MW total</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-term-outline-variant/60">
        <table className="w-full border-collapse text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b border-term-outline-variant/60 bg-term-surface-low text-term-ink-variant">
              <th className="px-2.5 py-2 font-semibold uppercase tracking-wider">Cluster</th>
              <th className="px-2.5 py-2 text-right font-semibold uppercase tracking-wider">FRP</th>
              <th className="px-2.5 py-2 text-right font-semibold uppercase tracking-wider">
                From Delhi
              </th>
              <th className="hidden px-2.5 py-2 text-right font-semibold uppercase tracking-wider sm:table-cell">
                Arrival
              </th>
              <th className="hidden px-2.5 py-2 text-right font-semibold uppercase tracking-wider md:table-cell">
                Newest
              </th>
              <th className="hidden px-2.5 py-2 text-right font-semibold uppercase tracking-wider lg:table-cell">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                className="border-b border-term-outline-variant/30 last:border-0 hover:bg-term-surface-c/50"
              >
                <td className="px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-term-ink">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: frpColor(c.frpMaxMw) }}
                    />
                    <span className="truncate">{c.stateApprox}</span>
                    <span className="text-term-outline">approx.</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-term-ink-variant">
                    {c.band} · {c.pixels} px
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right align-top">
                  <div className="font-semibold text-term-ink">{Math.round(c.frpTotalMw)} MW</div>
                  <div className="mt-1 w-16 shrink-0">
                    <Meter pct={(c.frpTotalMw / strongest) * 100} color={frpColor(c.frpMaxMw)} />
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right align-top text-term-ink">
                  {Math.round(c.distKm)} km
                  <div className="text-[10px] text-term-ink-variant">{c.fromDelhiCompass}</div>
                </td>
                <td
                  className={cn(
                    'hidden px-2.5 py-2 text-right align-top sm:table-cell',
                    c.transit.carrying === true
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-term-ink-variant',
                  )}
                >
                  {c.transit.carrying === true ? (
                    <>
                      +{Math.round(c.transit.hours ?? 0)} h
                      <div className="text-[10px] opacity-80">
                        align {c.transit.alignment?.toFixed(2)}
                      </div>
                    </>
                  ) : (
                    <span className="text-[10px]">not carrying</span>
                  )}
                </td>
                <td className="hidden px-2.5 py-2 text-right align-top text-term-ink-variant md:table-cell">
                  {ageLabel(c.ageH)}
                </td>
                <td className="hidden px-2.5 py-2 text-right align-top text-term-ink-variant lg:table-cell">
                  {topConfidence(c.confidence)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {data.clusters.length > 8 && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="font-mono text-[10px] font-semibold uppercase tracking-wider text-term-ink-variant transition-colors hover:text-term-primary"
          >
            {all ? 'Show top 8' : `All ${data.clusters.length} clusters`}
          </button>
        )}
        {data.clustersOther.clusters > 0 && (
          <Label>
            + {data.clustersOther.clusters} smaller cells · {data.clustersOther.pixels} detections
          </Label>
        )}
      </div>

      <p className="font-body text-[10px] leading-relaxed text-term-ink-variant">
        {data.regionMethod}. {data.clusterMethod}.{' '}
        {data.pixels.returned < data.pixels.total &&
          `Map shows ${data.pixels.returned.toLocaleString()} of ${data.pixels.total.toLocaleString()} detections — ${data.pixels.method}, dropping ${data.pixels.droppedFrpSharePct}% of the radiative power.`}
      </p>
    </div>
  );
}
