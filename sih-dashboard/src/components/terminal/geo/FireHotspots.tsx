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

  const byState = React.useMemo(() => {
    const m = new Map<string, { stateApprox: string; pixels: number; frpTotalMw: number; frpMaxMw: number }>();
    for (const r of data.regions) {
      const e = m.get(r.stateApprox) ?? {
        stateApprox: r.stateApprox, pixels: 0, frpTotalMw: 0, frpMaxMw: 0,
      };
      e.pixels += r.pixels;
      e.frpTotalMw += r.frpTotalMw;
      e.frpMaxMw = Math.max(e.frpMaxMw, r.frpMaxMw);
      m.set(r.stateApprox, e);
    }
    return [...m.values()].sort((a, b) => b.frpTotalMw - a.frpTotalMw);
  }, [data.regions]);

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
          and a rollup answers it in one line where a table of clusters does
          not. Rolled up by state and not by (band, state): Punjab spans two
          latitude bands, so the unrolled list printed PUNJAB twice with two
          different counts, which reads as two findings about one place. */}
      <div className="flex flex-wrap gap-1.5" title={data.regionMethod}>
        {byState.slice(0, 5).map((r) => (
          <Pill key={r.stateApprox} color={frpColor(r.frpMaxMw)}>
            {r.stateApprox} · {r.pixels} · {Math.round(r.frpTotalMw)} MW
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

      {/* Three columns, and no responsive column hiding.
          It had six, revealed at `sm:` / `md:` / `lg:` - and those are
          *viewport* breakpoints while this table lives in a four-column grid
          cell. On a 1302px desktop every column therefore rendered into a
          311px container: 629px of table in 310px of space, with the right
          half simply cut off. Anything that will not fit a narrow column at
          any viewport belongs in the row, not in a column of its own. */}
      <div className="overflow-hidden rounded-xl border border-term-outline-variant/60">
        <table className="w-full table-fixed border-collapse text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b border-term-outline-variant/60 bg-term-surface-low text-term-ink-variant">
              <th className="w-[46%] px-2.5 py-2 font-semibold uppercase tracking-wider">Cluster</th>
              <th className="w-[27%] px-2.5 py-2 text-right font-semibold uppercase tracking-wider">FRP</th>
              <th className="w-[27%] px-2.5 py-2 text-right font-semibold uppercase tracking-wider">
                Distance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                className="border-b border-term-outline-variant/30 last:border-0 hover:bg-term-surface-c/50"
              >
                <td className="px-2.5 py-2 align-top">
                  <div className="flex items-center gap-1.5 text-term-ink">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: frpColor(c.frpMaxMw) }}
                    />
                    <span className="truncate" title={`${c.stateApprox} (approximate)`}>
                      {c.stateApprox}
                    </span>
                  </div>
                  {/* Age and VIIRS confidence sit here rather than in columns
                      of their own - they are qualifiers on the row, and a
                      qualifier does not need a header. */}
                  <div className="mt-0.5 truncate text-[10px] text-term-ink-variant">
                    {c.pixels} px · {ageLabel(c.ageH)} · {topConfidence(c.confidence)}
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right align-top">
                  <div className="font-semibold text-term-ink">{Math.round(c.frpTotalMw)} MW</div>
                  <div className="mt-1">
                    <Meter pct={(c.frpTotalMw / strongest) * 100} color={frpColor(c.frpMaxMw)} />
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right align-top text-term-ink">
                  {Math.round(c.distKm)}
                  <span className="text-[10px] text-term-ink-variant"> km {c.fromDelhiCompass}</span>
                  <div
                    className={cn(
                      'mt-0.5 text-[10px]',
                      c.transit.carrying === true
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-term-ink-variant',
                    )}
                  >
                    {c.transit.carrying === true
                      ? `+${Math.round(c.transit.hours ?? 0)} h · align ${c.transit.alignment?.toFixed(2)}`
                      : 'not carrying'}
                  </div>
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
        {data.clustersOther.pixels > 0 && (
          <Label>
            + {data.clustersOther.pixels} isolated detection
            {data.clustersOther.pixels === 1 ? '' : 's'}, drawn on the map but too scattered to
            group
          </Label>
        )}
      </div>

      <p className="font-body text-[10px] leading-relaxed text-term-ink-variant">
        State names are approximate: {data.regionMethod}. {data.clusterMethod}.{' '}
        {data.pixels.returned < data.pixels.total &&
          `Map shows ${data.pixels.returned.toLocaleString()} of ${data.pixels.total.toLocaleString()} detections — ${data.pixels.method}, dropping ${data.pixels.droppedFrpSharePct}% of the radiative power.`}
      </p>
    </div>
  );
}
