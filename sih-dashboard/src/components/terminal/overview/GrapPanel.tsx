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
import { useSeverityInk } from '@/lib/terminal/palette';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { fetchGrap, GRAP_STAGE, type GrapPayload } from '@/lib/grapApi';
import { cn } from '@/lib/utils';

/** Matches the mesh's cadence so the two age together. */
const REFRESH_MS = 120_000;

/**
 * Where each GRAP stage begins, on CPCB's own PM2.5 scale.
 *
 * The AQI figures are CAQM's stage thresholds and the concentrations are the
 * CPCB breakpoints that produce them - 201 is exactly 90.1 ug/m3 as a 24-hour
 * mean, which is the window the stage is judged on, so the two columns
 * describe one quantity rather than two. Stage IV is open-ended upward, so it
 * has no successor to count towards.
 */
const STAGE_ONSET: Record<number, { aqi: number; ugm3: string }> = {
  1: { aqi: 201, ugm3: '90.1' },
  2: { aqi: 301, ugm3: '120.1' },
  3: { aqi: 401, ugm3: '250.1' },
  4: { aqi: 451, ugm3: '300.6' },
};

/** "Stage II", without the category - the sentence supplies the context. */
function stageLabel(stage: number): string {
  return (GRAP_STAGE[stage]?.name ?? `Stage ${stage}`).split('—')[0].trim();
}

export function GrapPanel() {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
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
  // Null at Stage IV, which nothing escalates past.
  const nextStep = STAGE_ONSET[data.grap.stage + 1] ?? null;
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

      {/* Same reasoning as the inversion cards: the stage colour is already on
          the shield icon, the stage name and the action bullets. */}
      <TelemetryCard className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <Icon className="mt-0.5 size-6 shrink-0" style={{ color: ink(stage.color) }} />
            <div>
              <div className="font-display text-xl font-bold" style={{ color: ink(stage.color) }}>
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

        {/* How far the forecast is from the next stage.
            "No stage active" on its own is indistinguishable from a panel that
            is broken, or from one wired to nothing - and for most of the year
            in Delhi it is the honest answer, so it is what a reader sees
            almost every time they look. Printing the distance to the next
            threshold shows the mechanism is live and being evaluated, and how
            near the city is to it, without inventing an alarm that CAQM would
            not raise. CPCB indexes PM2.5 on 24-hour means, so the µg/m³ figure
            is the breakpoint for the same window the stage is judged on. */}
        <div className="mt-3 rounded-lg border border-term-outline-variant/50 bg-term-surface-low px-3 py-2">
          <span className="font-mono text-[11px] text-term-ink-variant">
            {nextStep == null ? (
              <>Stage IV is the highest stage CAQM defines — nothing escalates beyond this.</>
            ) : (
              <>
                {stageLabel(data.grap.stage + 1)} begins at{' '}
                <span className="font-bold text-term-ink">AQI {nextStep.aqi}</span>
                {' '}({nextStep.ugm3} µg/m³ as a 24-hour mean). The forecast peaks at{' '}
                <span className="font-bold text-term-ink">{data.city_aqi}</span>
                {', '}
                <span className="font-bold" style={{ color: ink(stage.color) }}>
                  {nextStep.aqi - data.city_aqi} below
                </span>
                {' '}the threshold.
              </>
            )}
          </span>
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
          <Label className={cn(status === 'offline' && 'text-amber-700 dark:text-amber-400')}>
            {status === 'offline' ? 'Policy engine unreachable — showing the last stage received' : 'Live from the policy engine'}
          </Label>
        </div>
      </TelemetryCard>
    </div>
  );
}
