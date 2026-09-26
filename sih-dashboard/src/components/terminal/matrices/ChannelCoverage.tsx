/**
 * How much of the network is actually measuring each channel.
 *
 * Split into the two cohorts the mesh is made of, and never summed. The live
 * WAQI feed carries this hour for about two dozen stations; the archive
 * carries the rest of the network roughly 42 hours behind. Adding them gives a
 * bigger number and a worse one: they are counts of different things measured
 * at different times.
 *
 * The valid-hours column is the part worth reading twice. CPCB will not
 * publish a 24-hour mean built from fewer than 16 valid hours, and this shows
 * how close each cohort sits to that line. A live station always reads exactly
 * 24 of 24 - not because it is perfectly instrumented but because WAQI ships a
 * pre-averaged product and the hour count is a property of that product. The
 * archive's counts are real and they vary. The panel says which is which.
 */
import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Label, Meter, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { channelCoverage, shortfalls, type ChannelCoverage as Coverage } from '@/lib/terminal/channels';
import { isLive, useMesh } from '@/lib/terminal/useMesh';
import type { LiveStation } from '@/lib/terminal/meshApi';
import { TERM } from '@/lib/terminal/palette';
import { cn } from '@/lib/utils';

function CoverageRow({ c }: { c: Coverage }) {
  const pct = c.of ? (c.reporting / c.of) * 100 : 0;
  const short = c.minValid != null && c.minValid < c.minValidHours;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="font-semibold text-term-ink">{c.key}</span>
        <span className="text-term-ink-variant">
          <span className="font-bold text-term-ink">{c.reporting}</span>/{c.of} stations
        </span>
      </div>
      <Meter pct={pct} color={c.reporting ? TERM.primary : TERM.outline} />
      <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-term-ink-variant">
        <span>
          {c.windowHours}h window · needs {c.minValidHours} valid
        </span>
        {c.medianValid != null && (
          <span className={cn(short && 'text-amber-600 dark:text-amber-400')}>
            · median {c.medianValid}
            {c.minValid != null && c.minValid !== c.medianValid ? `, low ${c.minValid}` : ''}
          </span>
        )}
        {c.uniformWindow && <span className="text-term-outline">· pre-averaged</span>}
      </div>
    </div>
  );
}

function Cohort({
  title,
  note,
  stations,
  show,
}: {
  title: string;
  note: string;
  stations: LiveStation[];
  /** Channels to print, chosen across both cohorts - see the note below. */
  show: Set<string>;
}) {
  const rows = React.useMemo(() => channelCoverage(stations), [stations]);
  // Rows are chosen from the union of both cohorts rather than per-cohort, so
  // a channel one of them carries and the other does not shows up as a zero
  // instead of silently vanishing. That absence is the most interesting thing
  // on this panel: the live bulletin publishes no NO2 at all, which is why
  // NO2 can never be the deciding channel on a live station.
  const present = rows.filter((r) => show.has(r.key));
  return (
    <TelemetryCard className="space-y-3 p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">{title}</h3>
        <Label>{stations.length} stations</Label>
      </div>
      <p className="font-body text-[11px] leading-relaxed text-term-ink-variant">{note}</p>
      {present.length ? (
        <div className="space-y-2.5 border-t border-term-outline-variant/40 pt-3">
          {present.map((c) => (
            <CoverageRow key={c.key} c={c} />
          ))}
        </div>
      ) : (
        <p className="border-t border-term-outline-variant/40 pt-3 font-mono text-[11px] text-term-ink-variant">
          No stations in this cohort right now.
        </p>
      )}
    </TelemetryCard>
  );
}

export function ChannelCoverage() {
  const mesh = useMesh();
  const live = React.useMemo(
    () => mesh.stations.filter((s): s is LiveStation => isLive(s) && s.freshness === 'live'),
    [mesh.stations],
  );
  const archive = React.useMemo(
    () => mesh.stations.filter((s): s is LiveStation => isLive(s) && s.freshness === 'archive'),
    [mesh.stations],
  );
  const missed = React.useMemo(() => shortfalls(mesh.unindexed), [mesh.unindexed]);
  const show = React.useMemo(() => {
    const keys = new Set<string>();
    for (const c of [...channelCoverage(live), ...channelCoverage(archive)]) {
      if (c.reporting > 0) keys.add(c.key);
    }
    return keys;
  }, [live, archive]);

  return (
    <div className="space-y-3">
      <SectionHead
        title="Channel Coverage"
        sub="How many stations carry each channel, and how close they sit to CPCB's validity rule"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {live.length} live · {archive.length} archived
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Cohort
          title="Live feed, this hour"
          note="CPCB stations reporting to the real-time bulletin. Every valid-hour count here is the full window because the feed publishes a ready-made average, so it measures the product and not the instrumentation."
          stations={live}
          show={show}
        />
        <Cohort
          title="Archive window"
          note="Stations that report to CPCB but not to the live bulletin, carried about 42 hours behind so the network is not three quarters empty. These hour counts are real observations and they vary."
          stations={archive}
          show={show}
        />
      </div>

      {missed.length > 0 && (
        <TelemetryCard className="space-y-2 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">
              Kept out of the index by the validity rule
            </h3>
          </div>
          <p className="font-body text-[11px] leading-relaxed text-term-ink-variant">
            These stations reported. CPCB&rsquo;s rule is that a window average built from too
            few valid hours is not publishable, so they carry no AQI — they are drawn on the
            map and counted in nothing.
          </p>
          <div className="space-y-2 border-t border-term-outline-variant/40 pt-3">
            {missed.map((m) => (
              <div key={m.station}>
                <div className="font-mono text-[11px] font-semibold text-term-ink">
                  {m.station}
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {Object.entries(m.channels).map(([ch, why]) => (
                    <div key={ch} className="font-mono text-[10px] text-term-ink-variant">
                      <span className="text-amber-600 dark:text-amber-400">{ch}</span> — {why}
                    </div>
                  ))}
                  {!Object.keys(m.channels).length &&
                    m.reasons.map((r) => (
                      <div key={r} className="font-mono text-[10px] text-term-ink-variant">
                        {r}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </TelemetryCard>
      )}
    </div>
  );
}
