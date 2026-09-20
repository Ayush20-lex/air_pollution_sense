/**
 * The GRAP stage, from the backend that has been computing it all along.
 *
 * This is the answer to "so what" - the point at which a forecast becomes an
 * instruction. Everything else on the page reports air; this reports what the
 * Commission for Air Quality Management's Graded Response Action Plan requires
 * at that level of air.
 *
 * Three things are deliberate.
 *
 * The stage comes from the city figure, not the worst station. CAQM invokes
 * GRAP on the city, and a single hotspot setting a city-wide stage is exactly
 * the failure this backend was fixed for once already - one faulty sensor used
 * to decide what the page told a reader to do. The hotspot is shown beside the
 * stage, labelled, and never sets it.
 *
 * The actions are the backend's, not this component's. They travel with the
 * stage so the two cannot drift.
 *
 * When the endpoint is unreachable the panel says so rather than falling back
 * to a stage. There is no safe default here: showing Stage 0 during an outage
 * tells a reader the air is fine on no evidence at all.
 */
import * as React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { fetchGrap, GRAP_STAGE, type GrapPayload } from '@/lib/grapApi';
import { cn } from '@/lib/utils';

/** Matches the mesh's cadence so the two age together. */
const REFRESH_MS = 120_000;

export function GrapPanel() {
  const [data, setData] = React.useState<GrapPayload | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'live' | 'offline'>('loading');

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const d = await fetchGrap();
      if (!alive) return;
      if (d) {
        setData(d);
        setStatus('live');
      } else {
        // Keep whatever is on screen: a stale stage is still a measured one,
        // and blanking it during a hiccup loses information for no gain.
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

  if (!data) {
    return (
      <div id="grap" className="space-y-3">
        <SectionHead title="GRAP Response Stage" sub="Graded Response Action Plan · CAQM" />
        <TelemetryCard className="flex h-28 items-center justify-center p-6">
          <span className="font-mono text-xs text-term-outline">
            {status === 'loading' ? 'Asking the policy engine…' : 'Policy engine unreachable — no stage shown'}
          </span>
        </TelemetryCard>
      </div>
    );
  }

  const stage = GRAP_STAGE[data.grap.stage] ?? GRAP_STAGE[0];
  const active = data.grap.stage > 0;
  const Icon = active ? ShieldAlert : ShieldCheck;

  return (
    <div id="grap" className="space-y-3">
      <SectionHead
        title="GRAP Response Stage"
        sub="What the forecast requires under CAQM's Graded Response Action Plan"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {data.stations_considered} stations · {data.horizon_hours}h horizon
          </span>
        }
      />

      <TelemetryCard
        className="border-l-4 p-5"
        style={{ borderLeftColor: stage.color }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <Icon className="mt-0.5 size-6 shrink-0" style={{ color: stage.color }} />
            <div>
              <div className="font-display text-xl font-bold" style={{ color: stage.color }}>
                {stage.name}
              </div>
              <div className="mt-0.5 font-mono text-xs text-term-ink-variant">{stage.means}</div>
              <div className="mt-1 font-mono text-[11px] text-term-outline">
                {data.grap.category}
              </div>
            </div>
          </div>

          {/* The city figure is what sets the stage, so it is the larger of the
              two. The hotspot sits beside it at half the weight and says what
              it is, because a reader who sees only the bigger number will
              assume it decided the stage. */}
          <div className="flex gap-6">
            <div>
              <Label>City AQI · sets the stage</Label>
              <div className="font-mono text-2xl font-bold text-term-ink">{data.city_aqi}</div>
              <div className="font-mono text-[10px] text-term-outline">
                {data.city_pm25_ugm3.toFixed(1)} µg/m³ · {data.window_hours}h mean
              </div>
            </div>
            {data.hotspot ? (
              <div>
                <Label>Worst station · not stage-setting</Label>
                <div className="font-mono text-2xl font-bold text-term-ink-variant">
                  {data.hotspot.aqi}
                </div>
                <div className="font-mono text-[10px] text-term-outline">
                  station {data.hotspot.station_id} · {data.hotspot.pm25_ugm3.toFixed(1)} µg/m³
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 border-t border-term-outline-variant/40 pt-3">
          {data.grap.actions.map((a) => (
            <li key={a} className="flex items-start gap-2 font-mono text-xs text-term-ink-variant">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: stage.color }} />
              <span>{a}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-term-outline-variant/40 pt-2">
          <Label>
            {/* The basis matters: "stations" is the real geometry, "grid_p95" is
                the fallback when it is unavailable, and the two are not equally
                trustworthy. */}
            Basis: {data.basis === 'stations' ? 'station 24-hour means' : `grid percentile (${data.basis})`}
          </Label>
          <Label className={cn(status === 'offline' && 'text-amber-400')}>
            {status === 'offline' ? 'Policy engine unreachable — showing the last stage received' : 'Live from the policy engine'}
          </Label>
        </div>
      </TelemetryCard>
    </div>
  );
}
