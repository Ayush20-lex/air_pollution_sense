/**
 * Inversion trap zones, from the backend that has been computing them all along.
 *
 * This answers a clause the problem statement names outright - "features that
 * explicitly track atmospheric inversion strength" - and it is the mechanism
 * behind the forecast rather than a restatement of it: a shallow layer puts the
 * same emissions into a smaller volume, which is *why* the AQI is about to
 * move.
 *
 * Each zone leads with when its worst hour lands, not with its score. The index
 * is the evidence; the hour is the decision. A reader who learns that the
 * north-west basin traps at 05:30 tomorrow can act on it, and one who learns
 * that its ISI is 0.734 cannot.
 *
 * An empty list is a real answer - no zone crossed the threshold - and is shown
 * as such. It is not the same as the endpoint being unreachable, and the two
 * were worth distinguishing: the first is good news about the air, the second
 * is no news at all.
 */
import * as React from 'react';
import { Layers, Wind } from 'lucide-react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { fetchInversion, INVERSION_TIER, whenLabel, type InversionZone } from '@/lib/inversionApi';

/** Matches the mesh and GRAP so everything on the page ages together. */
const REFRESH_MS = 120_000;

/** Zones shown before the list is cut. The backend already sorts by severity. */
const SHOWN = 6;

export function InversionPanel() {
  const [zones, setZones] = React.useState<InversionZone[] | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'live' | 'offline'>('loading');

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const z = await fetchInversion();
      if (!alive) return;
      if (z) {
        setZones(z);
        setStatus('live');
      } else {
        setStatus((s) => (s === 'live' ? 'live' : 'offline'));
      }
      timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (zones == null) {
    return (
      <div id="inversion" className="space-y-3">
        <SectionHead title="Inversion Trap Zones" sub="Where the boundary layer collapses, and when" />
        <TelemetryCard className="flex h-24 items-center justify-center p-6">
          <span className="font-mono text-xs text-term-outline">
            {status === 'loading' ? 'Scoring the forecast…' : 'Inversion service unreachable'}
          </span>
        </TelemetryCard>
      </div>
    );
  }

  const worst = zones[0];

  return (
    <div id="inversion" className="space-y-3">
      <SectionHead
        title="Inversion Trap Zones"
        sub="Where the boundary layer collapses over the next 72 hours, and when"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {zones.length} zone{zones.length === 1 ? '' : 's'} above threshold
          </span>
        }
      />

      {zones.length === 0 ? (
        <TelemetryCard className="p-5">
          <div className="flex items-center gap-3">
            <Wind className="size-5 shrink-0 text-term-primary" />
            <div>
              <div className="font-display text-base font-bold text-term-primary">
                No trapping zones in the next 72 hours
              </div>
              <div className="mt-0.5 font-mono text-xs text-term-ink-variant">
                Every zone's worst hour scores below the reporting threshold — the layer
                stays deep enough to ventilate.
              </div>
            </div>
          </div>
        </TelemetryCard>
      ) : (
        <div className="space-y-2">
          {zones.slice(0, SHOWN).map((z) => {
            const tier = INVERSION_TIER[z.severity] ?? INVERSION_TIER.MODERATE;
            return (
              <TelemetryCard
                key={z.zone_id}
                className="flex flex-col gap-3 border-l-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderLeftColor: tier.color }}
              >
                <div className="flex items-start gap-3">
                  <Layers className="mt-0.5 size-5 shrink-0" style={{ color: tier.color }} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold"
                        style={{ color: tier.color, borderColor: `${tier.color}66` }}
                      >
                        {z.severity}
                      </span>
                      {/* The lead leads. See the module note. */}
                      <span className="font-mono text-xs font-bold text-term-ink">
                        {whenLabel(z)}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-term-ink-variant">
                      {tier.means} · {z.lat_center.toFixed(2)}°N {z.lon_center.toFixed(2)}°E
                    </div>
                  </div>
                </div>

                <div className="flex gap-5">
                  <div>
                    <Label>Layer depth</Label>
                    <div className="font-mono text-lg font-bold" style={{ color: tier.color }}>
                      {z.pbl_min.toFixed(0)}<span className="text-[10px]"> m</span>
                    </div>
                  </div>
                  <div>
                    <Label>PM2.5 then</Label>
                    <div className="font-mono text-lg font-bold text-term-ink-variant">
                      {z.pm25_peak.toFixed(0)}<span className="text-[10px]"> µg/m³</span>
                    </div>
                  </div>
                  <div>
                    <Label>Index</Label>
                    <div className="font-mono text-lg font-bold text-term-ink-variant">
                      {z.isi_score.toFixed(2)}
                    </div>
                  </div>
                </div>
              </TelemetryCard>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-term-outline-variant/40 pt-2">
        <Label>
          {/* Both figures describe the same hour. They used not to, which is what
              made every zone read SEVERE forever. */}
          Layer depth and PM2.5 are read at each zone's worst hour · ISI 0.65 moderate, 0.75 severe
        </Label>
        <Label className={status === 'offline' ? 'text-amber-400' : undefined}>
          {status === 'offline'
            ? 'Inversion service unreachable — showing the last scoring received'
            : worst
              ? `Worst zone ${worst.isi_score.toFixed(2)}`
              : 'Live from the forecast'}
        </Label>
      </div>
    </div>
  );
}
