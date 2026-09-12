'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Database,
  GitBranch,
  Layers,
  ShieldAlert,
  Timer,
  Waves,
} from 'lucide-react';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MiniSparkline } from '@/components/charts/MiniSparkline';
import { ALERT_COLOR, type AlertLevel } from '@/lib/aqi';
import { DISTRICTS, MODEL_META, autoAnalysis } from '@/lib/data';
import { SERIES, SEVERITY } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useAppStore, useCurrentFrame } from '@/store/useAppStore';

export function RightPanel() {
  const frame = useCurrentFrame();
  const frames = useAppStore((s) => s.frames);
  const interventions = useAppStore((s) => s.interventions);
  const analyses = autoAnalysis(frame, interventions);

  // Zones ranked worst-first for the risk monitor.
  const ranked = React.useMemo(
    () =>
      DISTRICTS.map((d) => ({ d, s: frame.districts[d.id] })).sort(
        (a, b) => b.s.inversion + b.s.pm25 / 400 - (a.s.inversion + a.s.pm25 / 400),
      ),
    [frame],
  );

  const inversionSeries = frames.map((f) => f.inversionIndex * 100);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto no-scrollbar">
      {/* ---- atmospheric drivers ------------------------------------- */}
      <Panel>
        <PanelHeader
          title="Atmospheric drivers"
          icon={<Layers className="size-3" />}
          action={<Badge color={SEVERITY.good} dot>Auto</Badge>}
        />
        <PanelBody className="space-y-3">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-hairline/50 [&>*]:bg-elevated/40">
            <Driver label="Solar" value={`${frame.avgSolar}`} unit="W/m²" pct={frame.avgSolar / 720} color={SERIES.solar} />
            <Driver label="PBL" value={`${frame.avgPbl}`} unit="m" pct={frame.avgPbl / 1900} color={SERIES.pbl} />
            <Driver label="Wind" value={frame.avgWind.toFixed(1)} unit="m/s" pct={frame.avgWind / 7.5} color={SERIES.wind} />
          </div>

          {/* coupling chain */}
          <div className="rounded-lg border border-hairline/60 bg-elevated/40 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <BrainCircuit className="size-3 text-accent" />
              <span className="font-mono text-2xs uppercase tracking-[0.18em] text-accent">
                Feedback chain
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted">
              {['Aerosol load', 'SW extinction', 'Surface cooling', 'PBL collapse', 'Trapping'].map(
                (step, i, arr) => (
                  <React.Fragment key={step}>
                    <span className="rounded border border-hairline bg-surface/70 px-1.5 py-0.5">{step}</span>
                    {i < arr.length - 1 && <span className="text-accent">→</span>}
                  </React.Fragment>
                ),
              )}
              <span className="text-accent">↺</span>
            </div>
          </div>

          {analyses.map((a) => (
            <motion.div
              key={a.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="space-y-1"
            >
              <div className="flex items-center gap-1.5">
                {a.tone === 'danger' ? (
                  <ShieldAlert className="size-3 text-emergency" />
                ) : a.tone === 'warn' ? (
                  <AlertTriangle className="size-3 text-warning" />
                ) : (
                  <Waves className="size-3 text-accent" />
                )}
                <span
                  className={cn(
                    'font-mono text-2xs font-semibold uppercase tracking-[0.18em]',
                    a.tone === 'danger' && 'text-emergency',
                    a.tone === 'warn' && 'text-warning',
                    a.tone === 'info' && 'text-accent',
                  )}
                >
                  {a.title}
                </span>
              </div>
              <p className="text-pretty text-xs leading-relaxed text-muted">{a.body}</p>
            </motion.div>
          ))}
        </PanelBody>
      </Panel>

      {/* ---- inversion risk monitor ----------------------------------- */}
      <Panel>
        <PanelHeader
          title="Inversion risk monitor"
          icon={<AlertTriangle className="size-3" />}
          action={
            <span className="font-mono text-2xs tabular-nums text-faint">
              idx {frame.inversionIndex.toFixed(2)}
            </span>
          }
        />
        <PanelBody className="space-y-2">
          <div className="rounded-lg border border-hairline/60 bg-elevated/40 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="hud-label">Index trajectory</span>
              <span className="font-mono text-2xs text-faint">0–100</span>
            </div>
            <MiniSparkline
              values={inversionSeries}
              width={320}
              height={40}
              stroke={SEVERITY.moderate}
              className="w-full"
            />
          </div>

          {ranked.map(({ d, s }) => (
            <AlertRow key={d.id} zone={d.zone} level={s.alert} pm={s.pm25} inversion={s.inversion} />
          ))}
        </PanelBody>
      </Panel>

      {/* ---- data lineage --------------------------------------------- */}
      <Panel>
        <PanelHeader title="Data lineage / system" icon={<Database className="size-3" />} />
        <PanelBody className="space-y-1.5">
          <Lineage icon={<Cpu className="size-3" />} label="Model" value={MODEL_META.model} accent />
          <Lineage icon={<GitBranch className="size-3" />} label="Core" value={MODEL_META.core} />
          <Lineage icon={<Layers className="size-3" />} label="Grid" value={MODEL_META.resolution} />
          <Lineage icon={<Database className="size-3" />} label="IC/BC" value={MODEL_META.ic} />
          <Lineage icon={<Database className="size-3" />} label="Emissions" value={MODEL_META.emissions} />
          <Lineage
            icon={<Timer className="size-3" />}
            label="Latency"
            value={`${MODEL_META.latencyMs} ms`}
            accent
          />
          <Lineage
            icon={<CheckCircle2 className="size-3" />}
            label="Obs assimilated"
            value={`${MODEL_META.assimilated} stns`}
          />

          <div className="mt-2 rounded-lg border border-hairline/60 bg-elevated/40 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="hud-label">Forecast confidence</span>
              <span className="font-mono text-xs font-bold tabular-nums text-good">
                {MODEL_META.confidence}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-hairline/60">
              <motion.div
                initial={{ transform: 'scaleX(0)' }}
                animate={{ transform: 'scaleX(1)' }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: `${MODEL_META.confidence}%`, transformOrigin: 'left' }}
                className="h-full rounded-full bg-gradient-to-r from-good/50 to-good"
              />
            </div>
            <p className="mt-1.5 font-mono text-2xs leading-relaxed text-faint">
              Skill degrades beyond +48h; ensemble spread widens with synoptic uncertainty.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

function Driver({
  label,
  value,
  unit,
  pct,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="p-2">
      <div className="hud-label">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
        {value}
        <span className="ml-0.5 text-2xs text-faint">{unit}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-hairline/50">
        <motion.div
          animate={{ transform: `scaleX(${Math.min(1, Math.max(0.02, pct))})` }}
          transition={{ duration: 0.4 }}
          className="h-full w-full origin-left rounded-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}

function AlertRow({
  zone,
  level,
  pm,
  inversion,
}: {
  zone: string;
  level: AlertLevel;
  pm: number;
  inversion: number;
}) {
  const color = ALERT_COLOR[level];
  const critical = level === 'EMERGENCY';

  return (
    <motion.div
      layout
      className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
      style={{ borderColor: `${color}44`, background: `${color}0F` }}
    >
      <span className="relative flex size-2 shrink-0">
        {critical && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ background: color }}
          />
        )}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="flex-1 truncate font-mono text-2xs uppercase tracking-[0.14em] text-ink">
        {zone}
      </span>
      <span className="font-mono text-2xs tabular-nums text-faint">{inversion.toFixed(2)}</span>
      <span className="w-12 text-right font-mono text-2xs tabular-nums text-muted">
        {pm.toFixed(0)}
      </span>
      <span
        className="w-[74px] shrink-0 text-right font-mono text-2xs font-bold uppercase tracking-[0.1em]"
        style={{ color }}
      >
        {level}
      </span>
    </motion.div>
  );
}

function Lineage({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hairline/40 pb-1.5 last:border-0">
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs uppercase tracking-[0.14em] text-faint">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'text-right font-mono text-2xs leading-relaxed',
          accent ? 'font-semibold text-accent' : 'text-muted',
        )}
      >
        {value}
      </span>
    </div>
  );
}
