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
import { CHANNEL_ORDER, indexDrivers } from '@/lib/terminal/channels';
import { AQI_RAMP } from '@/lib/terminal/bands';
import type { LiveStation } from '@/lib/terminal/meshApi';
import type { Station } from '@/lib/terminal/stations';
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

          <SubIndexSpread stations={fresh} />
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

/**
 * Every station's sub-index, channel by channel - the evidence under the bars.
 *
 * The bars above say PM10 decides almost every station. They do not say why,
 * and "why" is the whole scientific content: the index takes the maximum of a
 * station's sub-indices, so the channel that decides is simply the one whose
 * spread sits highest. Drawn as one dot per station per channel against the
 * CPCB bands, that is visible in a glance rather than asserted - PM10's cloud
 * sits in Moderate while PM2.5's sits in Good, at the same stations, on the
 * same air, in the same hour.
 *
 * It also shows the thing a bar chart hides: how close the contest is. Two
 * clouds that overlap mean the deciding channel changes station to station and
 * hour to hour; two that are far apart mean it will not.
 */
function SubIndexSpread({ stations }: { stations: (Station | LiveStation)[] }) {
  const rows = React.useMemo(() => {
    const out: { key: string; values: number[]; median: number }[] = [];
    for (const key of CHANNEL_ORDER) {
      const values: number[] = [];
      for (const s of stations) {
        // The offline curated mesh carries no sub-indices at all, so this
        // reads undefined there and the plot simply does not render.
        const v = ('subIndices' in s ? s.subIndices : undefined)?.[key]?.sub_index;
        if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
      }
      if (!values.length) continue;
      const sorted = [...values].sort((a, b) => a - b);
      out.push({ key, values, median: sorted[Math.floor(sorted.length / 2)] });
    }
    return out;
  }, [stations]);

  if (rows.length < 2) return null;

  const peak = Math.max(...rows.flatMap((r) => r.values));
  // Scaled to the CPCB band the data actually reaches, not to 500: a fixed
  // full-scale axis squashes every ordinary day into the left fifth.
  const band = AQI_RAMP.find((b) => peak <= b.to) ?? AQI_RAMP[AQI_RAMP.length - 1];
  const max = band.to;

  const W = 320;
  const ROW = 26;
  // Headroom for the first row's label, which sits above its dots and was
  // being clipped by the top of the viewBox.
  const TOP = 11;
  const H = TOP + rows.length * ROW + 14;
  const x = (v: number) => (Math.min(v, max) / max) * W;

  return (
    <div className="space-y-1 border-t border-term-outline-variant/40 pt-3">
      <Label className="block">Sub-index spread, one dot per station</Label>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label="Sub-index per station for each channel, against the CPCB bands">
        {/* CPCB bands behind the dots, so a position reads as a category. */}
        {AQI_RAMP.map((b) => {
          const x0 = x(b.from);
          const x1 = x(Math.min(b.to, max));
          if (x1 - x0 <= 0) return null;
          return (
            <rect key={b.label} x={x0} y={TOP} width={x1 - x0} height={rows.length * ROW}
              fill={b.color} opacity={0.08} />
          );
        })}
        {rows.map((r, i) => {
          const cy = TOP + i * ROW + ROW / 2;
          return (
            <g key={r.key}>
              <line x1={0} x2={W} y1={cy + ROW / 2} y2={cy + ROW / 2}
                stroke={TERM.outlineVariant} strokeWidth={0.5} opacity={0.6} />
              {r.values.map((v, j) => (
                <circle key={j} cx={x(v)} cy={cy} r={3}
                  fill={CHANNEL_COLOR[r.key] ?? TERM.primary} opacity={0.5} />
              ))}
              {/* The median, marked: with two dozen overlapping dots the eye
                  finds the densest patch, which is not the same thing. */}
              <line x1={x(r.median)} x2={x(r.median)} y1={cy - 8} y2={cy + 8}
                stroke={TERM.ink} strokeWidth={1.5} />
              <text x={2} y={cy - 9} fontSize="8" fill={TERM.inkVariant}
                fontFamily="var(--font-mono), monospace" letterSpacing="0.08em">
                {r.key.toUpperCase()}
              </text>
              <text x={W - 2} y={cy - 9} fontSize="8" fill={TERM.inkVariant} textAnchor="end"
                fontFamily="var(--font-mono), monospace">
                median {r.median}
              </text>
            </g>
          );
        })}
        {/* Band edges, which are the numbers that mean something here. */}
        {AQI_RAMP.filter((b) => b.from > 0 && b.from <= max).map((b) => (
          <text key={`t-${b.label}`} x={x(b.from)} y={H - 3} fontSize="8" textAnchor="middle"
            fill={TERM.outline} fontFamily="var(--font-mono), monospace">
            {b.from}
          </text>
        ))}
        <text x={0} y={H - 3} fontSize="8" fill={TERM.outline}
          fontFamily="var(--font-mono), monospace">0</text>
      </svg>
      <p className="font-body text-[10px] leading-relaxed text-term-ink-variant">
        The index is the highest of these, so the channel whose dots sit furthest right
        decides the station. Overlapping clouds would mean the deciding channel changes from
        station to station; separated ones mean it will not.
      </p>
    </div>
  );
}
