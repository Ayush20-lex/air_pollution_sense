'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Activity, Layers, Radio, Waves } from 'lucide-react';
import { MiniSparkline } from '@/components/charts/MiniSparkline';
import { Badge } from '@/components/ui/badge';
import { autoAnalysis, type Frame, type Interventions } from '@/lib/data';
import { SEVERITY } from '@/lib/tokens';
import { cn } from '@/lib/utils';

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)' },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

/** Big HUD readout: label over a monospaced value with unit. */
export function TelemetryStat({
  label,
  value,
  unit,
  accent,
  delta,
  delay = 0,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  delta?: string;
  delay?: number;
}) {
  return (
    <motion.div {...fade(delay)} className="group relative rounded-r-lg border-l border-hairline/60 px-3 py-2 transition-colors duration-300 hover:border-accent/70 hover:bg-elevated/40">
      <div className="hud-label">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-3xl font-semibold tabular-nums tracking-tight"
          style={{ color: accent ?? 'rgb(var(--as-ink))' }}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-2xs text-faint">{unit}</span>}
      </div>
      {delta && (
        <div className="mt-0.5 font-mono text-2xs tabular-nums text-faint">{delta}</div>
      )}
    </motion.div>
  );
}

/** Floating analysis card — the narrative half of the intro HUD. */
export function AnalysisCard({
  frame,
  interventions,
  series,
}: {
  frame: Frame;
  interventions: Interventions;
  series: number[];
}) {
  const analyses = autoAnalysis(frame, interventions).slice(0, 2);

  return (
    <motion.div
      {...fade(0.35)}
      className="glass glass-hover w-[min(92vw,380px)] overflow-hidden p-0"
    >
      <div className="flex items-center justify-between border-b border-hairline/60 px-3 py-2">
        <span className="panel-title">
          <Radio className="size-3" />
          Auto-analysis
        </span>
        <Badge color={SEVERITY.good} dot>
          Live
        </Badge>
      </div>

      <div className="space-y-3 p-3">
        {analyses.map((a) => (
          <div key={a.title} className="space-y-1">
            <div className="flex items-center gap-1.5">
              {a.title === 'TWO-WAY COUPLING' ? (
                <Layers className="size-3 text-accent" />
              ) : (
                <Waves className="size-3 text-warning" />
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
          </div>
        ))}
      </div>

      <div className="border-t border-hairline/60 px-3 pb-2 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="hud-label">72h trajectory</span>
          <span className="font-mono text-2xs text-faint">
            <Activity className="mr-1 inline size-3" />
            PM2.5 µg/m³
          </span>
        </div>
        <MiniSparkline values={series} width={344} height={52} className="w-full" />
        <div className="mt-1 flex justify-between font-mono text-2xs text-faint">
          <span>NOW</span>
          <span>+24h</span>
          <span>+48h</span>
          <span>+72h</span>
        </div>
      </div>
    </motion.div>
  );
}
