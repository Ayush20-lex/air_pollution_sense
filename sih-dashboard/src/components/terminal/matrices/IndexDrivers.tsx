/**
 * Which channel is setting the index, across the network.
 *
 * The National AQI is the maximum of a station's sub-indices, so exactly one
 * pollutant decides each station's number. Aggregate that and you get the
 * finding the eight cards cannot show on their own: what this city's air is
 * actually failing on.
 *
 * Today it is coarse particulate at nearly every station, which is worth
 * printing loudly on a site that leads with PM2.5 on every other screen. PM2.5
 * is the pollutant that hurts people most per microgram; PM10 is the one
 * setting the number Delhi is judged by this week. Both are true and the page
 * should not quietly pick one.
 *
 * One honest caveat the panel carries: NO2 is only published by the archive
 * cohort, so it can never drive a live station. A channel that is not measured
 * cannot be the maximum, and a reader comparing the two cohorts would
 * otherwise conclude NO2 had stopped mattering.
 */
import * as React from 'react';
import { Label, Meter, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { indexDrivers } from '@/lib/terminal/channels';
import { isLive, useFreshStations, useMesh } from '@/lib/terminal/useMesh';
import { SEVERITY } from '@/lib/tokens';
import { TERM } from '@/lib/terminal/palette';
import { useSeverityInk } from '@/lib/terminal/palette';

/** Stable colour per channel, so the same pollutant reads the same everywhere. */
const CHANNEL_COLOR: Record<string, string> = {
  'PM2.5': SEVERITY.bad,
  PM10: SEVERITY.poor,
  NO2: SEVERITY.severe,
  O3: SEVERITY.moderate,
  SO2: TERM.secondary,
  CO: TERM.tertiary,
  NH3: SEVERITY.fair,
  Pb: SEVERITY.good,
};

const ZONES = ['North', 'South', 'East', 'West', 'Central'] as const;

export function IndexDrivers() {
  const ink = useSeverityInk();
  const mesh = useMesh();
  // Fresh stations only: a driver is a statement about what the air is doing
  // now, and the archive cohort is speaking for a different day.
  const fresh = useFreshStations();
  const { total, drivers } = React.useMemo(() => indexDrivers(fresh), [fresh]);

  // The whole network, for the contrast the caveat is about.
  const all = React.useMemo(
    () => indexDrivers(mesh.stations.filter(isLive)),
    [mesh.stations],
  );

  if (!total) return null;

  const top = drivers[0];

  return (
    <div className="space-y-3">
      <SectionHead
        title="What Is Setting The Index"
        sub="The AQI is the worst of a station's sub-indices, so one channel decides each number. This is which one, and where"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {total} reporting stations
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <TelemetryCard className="space-y-3 p-5 lg:col-span-7">
          {/* The headline, stated rather than left to be read off a bar. */}
          <p className="font-body text-sm leading-relaxed text-term-ink">
            <span className="font-display text-lg font-extrabold" style={{ color: ink(CHANNEL_COLOR[top.pollutant] ?? TERM.primary) }}>
              {top.pollutant}
            </span>{' '}
            is the deciding channel at {top.count} of {total} stations
            {top.pct >= 50 ? ` — ${top.pct}% of the reporting network` : ''}.
          </p>

          <div className="space-y-2.5 border-t border-term-outline-variant/40 pt-3">
            {drivers.map((d) => (
              <div key={d.pollutant} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                  <span className="font-semibold text-term-ink">{d.pollutant}</span>
                  <span className="text-term-ink-variant">
                    <span className="font-bold text-term-ink">{d.count}</span> station
                    {d.count === 1 ? '' : 's'} · {d.pct}%
                  </span>
                </div>
                <Meter pct={d.pct} color={CHANNEL_COLOR[d.pollutant] ?? TERM.primary} />
              </div>
            ))}
          </div>
        </TelemetryCard>

        <TelemetryCard className="space-y-3 p-5 lg:col-span-5">
          <Label className="block text-term-ink">By zone</Label>
          <div className="space-y-2">
            {ZONES.map((z) => {
              const inZone = drivers
                .map((d) => ({ pollutant: d.pollutant, n: d.zones[z] ?? 0 }))
                .filter((x) => x.n > 0)
                .sort((a, b) => b.n - a.n);
              const zoneTotal = inZone.reduce((a, x) => a + x.n, 0);
              if (!zoneTotal) return null;
              return (
                <div key={z}>
                  <div className="flex items-baseline justify-between font-mono text-[11px]">
                    <span className="text-term-ink">{z}</span>
                    <span className="text-term-ink-variant">{zoneTotal}</span>
                  </div>
                  {/* Stacked, because the question is the mix inside a zone and
                      not each channel's share of the city. */}
                  <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-term-surface-high">
                    {inZone.map((x) => (
                      <span
                        key={x.pollutant}
                        title={`${x.pollutant}: ${x.n}`}
                        style={{
                          width: `${(x.n / zoneTotal) * 100}%`,
                          background: CHANNEL_COLOR[x.pollutant] ?? TERM.primary,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="border-t border-term-outline-variant/40 pt-2 font-body text-[10px] leading-relaxed text-term-ink-variant">
            Counted over the {total} stations reporting this hour. Across the whole mesh,
            including the {all.total - total} carried from the archive, the split is{' '}
            {all.drivers
              .slice(0, 3)
              .map((d) => `${d.pollutant} ${d.count}`)
              .join(', ')}
            . NO&#8322; is published only by the archived stations, so it cannot be the
            deciding channel on a live one — a channel that is not measured cannot be the
            maximum.
          </p>
        </TelemetryCard>
      </div>
    </div>
  );
}
