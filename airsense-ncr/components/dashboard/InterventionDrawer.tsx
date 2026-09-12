'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Car, Factory, Flame, RotateCcw, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MiniSparkline } from '@/components/charts/MiniSparkline';
import { aqiColor } from '@/lib/aqi';
import { DEFAULT_INTERVENTIONS, buildForecast, type Interventions } from '@/lib/data';
import { LEVER, SERIES, SEVERITY } from '@/lib/tokens';
import { useAppStore } from '@/store/useAppStore';

const LEVERS: {
  key: keyof Interventions;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    key: 'stubble',
    label: 'Stubble burning reduction',
    desc: 'Upwind Punjab/Haryana residue-burning flux removed from the emission inventory.',
    icon: <Flame className="size-3.5" />,
    color: LEVER.stubble,
  },
  {
    key: 'traffic',
    label: 'Odd-even traffic enforcement',
    desc: 'Share of the private vehicle fleet withheld from the road network.',
    icon: <Car className="size-3.5" />,
    color: LEVER.traffic,
  },
  {
    key: 'industry',
    label: 'Industrial emission cap',
    desc: 'Stack-level cap applied to NCR industrial clusters and thermal units.',
    icon: <Factory className="size-3.5" />,
    color: LEVER.industry,
  },
];

/**
 * What-if policy simulator. Slider changes rebuild the whole coupled forecast,
 * so the map, charts and analysis text all respond together.
 */
export function InterventionDrawer() {
  const open = useAppStore((s) => s.drawerOpen);
  const setOpen = useAppStore((s) => s.setDrawerOpen);
  const interventions = useAppStore((s) => s.interventions);
  const setIntervention = useAppStore((s) => s.setIntervention);
  const reset = useAppStore((s) => s.resetInterventions);
  const frames = useAppStore((s) => s.frames);
  const hour = useAppStore((s) => s.hour);

  // Baseline (no policy applied) for the delta readout.
  const baseline = React.useMemo(() => buildForecast(DEFAULT_INTERVENTIONS), []);
  const basePm = baseline[hour].avgPm25;
  const nowPm = frames[hour].avgPm25;
  const delta = nowPm - basePm;
  const deltaPct = (delta / basePm) * 100;
  const peak = Math.max(...frames.map((f) => f.avgPm25));
  const basePeak = Math.max(...baseline.map((f) => f.avgPm25));

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[900] bg-black/45 backdrop-blur-[2px]"
          />

          <motion.aside
            role="dialog"
            aria-label="What-if policy simulator"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
            className="fixed inset-y-0 right-0 z-[1000] flex w-full max-w-[420px] flex-col border-l border-hairline bg-surface/95 backdrop-blur-2xl"
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-hairline/70 px-4 py-3">
              <div>
                <div className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-ink">
                  What-if simulator
                </div>
                <div className="hud-label mt-0.5">Policy intervention scenarios</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
                <X />
              </Button>
            </div>

            {/* impact summary */}
            <div className="border-b border-hairline/70 px-4 py-3">
              <div className="flex items-end justify-between">
                <div>
                  <div className="hud-label">Ensemble PM2.5 @ {frames[hour].label}</div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span
                      className="font-mono text-3xl font-bold tabular-nums"
                      style={{ color: aqiColor(nowPm) }}
                    >
                      {nowPm.toFixed(1)}
                    </span>
                    <span className="font-mono text-2xs text-faint">µg/m³</span>
                  </div>
                </div>
                <Badge color={delta < -0.5 ? SEVERITY.good : delta > 0.5 ? SEVERITY.bad : undefined}>
                  {delta <= 0 ? '' : '+'}
                  {deltaPct.toFixed(1)}% vs baseline
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Compare label="Baseline peak" value={`${basePeak.toFixed(0)}`} color={SERIES.inactive} />
                <Compare
                  label="Scenario peak"
                  value={`${peak.toFixed(0)}`}
                  color={aqiColor(peak)}
                />
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="hud-label">72h response</span>
                  <span className="font-mono text-2xs text-faint">scenario vs baseline</span>
                </div>
                <div className="relative">
                  <MiniSparkline
                    values={baseline.map((f) => f.avgPm25)}
                    width={370}
                    height={54}
                    stroke={SERIES.baseline}
                    showPeak={false}
                    className="w-full"
                  />
                  <div className="absolute inset-0">
                    <MiniSparkline
                      values={frames.map((f) => f.avgPm25)}
                      width={370}
                      height={54}
                      stroke={aqiColor(peak)}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* levers */}
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              {LEVERS.map((lever) => (
                <div key={lever.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.16em] text-ink">
                      <span style={{ color: lever.color }}>{lever.icon}</span>
                      {lever.label}
                    </span>
                    <span
                      className="font-mono text-sm font-bold tabular-nums"
                      style={{ color: lever.color }}
                    >
                      {interventions[lever.key]}%
                    </span>
                  </div>

                  <Slider
                    value={[interventions[lever.key]]}
                    min={0}
                    max={100}
                    step={5}
                    accentColor={lever.color}
                    onValueChange={([v]) => setIntervention(lever.key, v)}
                    aria-label={lever.label}
                  />

                  <div className="flex justify-between font-mono text-2xs text-faint">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>

                  <p className="text-pretty text-xs leading-relaxed text-muted">{lever.desc}</p>
                </div>
              ))}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-2 border-t border-hairline/70 px-4 py-3">
              <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
                <RotateCcw />
                Reset scenario
              </Button>
              <Button variant="solid" size="sm" onClick={() => setOpen(false)}>
                Apply &amp; close
              </Button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Compare({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-hairline/60 bg-elevated/40 p-2">
      <div className="hud-label">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums" style={{ color }}>
        {value}
        <span className="ml-1 text-2xs text-faint">µg/m³</span>
      </div>
    </div>
  );
}
