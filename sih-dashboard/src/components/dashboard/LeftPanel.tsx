
import * as React from 'react';
import {
  Activity,
  ArrowLeftRight,
  Gauge,
  LineChart,
  MapPin,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import { MetricCard } from './MetricCard';
import { RollingNumber } from '@/components/ui/rolling-number';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrajectoryChart } from '@/components/charts/TrajectoryChart';
import { AQI_BANDS, aqiColor, bandForPm25 } from '@/lib/aqi';
import { DISTRICTS } from '@/lib/data';
import { SERIES, SEVERITY } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useAppStore, useCurrentFrame } from '@/store/useAppStore';

export function LeftPanel() {
  const frame = useCurrentFrame();
  const frames = useAppStore((s) => s.frames);
  const hour = useAppStore((s) => s.hour);
  const setHour = useAppStore((s) => s.setHour);
  const selected = useAppStore((s) => s.selectedDistrict);
  const selectDistrict = useAppStore((s) => s.selectDistrict);

  const playing = useAppStore((s) => s.playing);
  const speed = useAppStore((s) => s.speed);

  const sample = selected ? frame.districts[selected] : null;
  const pm = sample ? sample.pm25 : frame.avgPm25;
  const aqi = sample ? sample.aqi : frame.avgAqi;
  const pbl = sample ? sample.pbl : frame.avgPbl;
  const temp = sample ? sample.temp : frame.avgTemp;
  const solar = sample ? sample.solar : frame.avgSolar;
  const band = bandForPm25(pm);

  // The roll has to settle before the next forecast hour arrives or the number
  // never lands on a real value. Playback ticks every 900/speed ms, so take 70%
  // of that as headroom; the bounds stop 0.5x feeling sluggish and 2x feeling
  // clipped. When paused the user is scrubbing, so a fixed duration is fine.
  const rollMs = playing
    ? Math.min(700, Math.max(180, (900 / speed) * 0.7))
    : 450;

  // Trend versus the previous forecast hour.
  const prev = frames[Math.max(0, hour - 1)];
  const prevPm = selected ? prev.districts[selected].pm25 : prev.avgPm25;
  const trend = prevPm ? ((pm - prevPm) / prevPm) * 100 : 0;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto no-scrollbar">
      {/* ---- headline AQI ------------------------------------------- */}
      <Panel>
        <PanelHeader
          title={selected ? `${DISTRICTS.find((d) => d.id === selected)?.name} station` : 'NCR ensemble mean'}
          icon={<MapPin className="size-3" />}
          action={
            selected ? (
              <button
                onClick={() => selectDistrict(null)}
                className="font-mono text-2xs uppercase tracking-widest text-accent hover:underline"
              >
                Clear
              </button>
            ) : (
              <Badge color={band.color}>{band.short}</Badge>
            )
          }
        />
        <PanelBody className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="hud-label">Air quality index</div>
              <RollingNumber
                value={aqi}
                durationMs={rollMs}
                digits={3}
                color={band.color}
                label={`Air quality index ${aqi}, ${band.label}`}
                className="font-mono text-5xl font-bold"
              />
              <div className="mt-1 font-mono text-2xs uppercase tracking-[0.18em]" style={{ color: band.color }}>
                {band.label}
              </div>
            </div>
            <div className="text-right">
              <div className="hud-label">Forecast step</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-ink">{frame.label}</div>
              <div className="font-mono text-2xs text-faint">
                {String(frame.localHour).padStart(2, '0')}:00 IST
              </div>
            </div>
          </div>

          {/* AQI band ribbon */}
          <div className="flex h-1.5 overflow-hidden rounded-full">
            {AQI_BANDS.map((b) => (
              <div
                key={b.label}
                className="h-full flex-1 transition-opacity"
                style={{ background: b.color, opacity: band.color === b.color ? 1 : 0.22 }}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* ---- metric grid --------------------------------------------- */}
      <Panel>
        <PanelHeader title="Current telemetry" icon={<Activity className="size-3" />} />
        <PanelBody className="grid grid-cols-2 gap-px bg-hairline/50 p-px [&>*]:bg-surface">
          <MetricCard
            label="PM2.5 avg"
            value={pm.toFixed(1)}
            unit="µg/m³"
            color={aqiColor(pm)}
            icon={<Gauge className="size-3.5" />}
            trend={trend}
          />
          <MetricCard
            label="PBL height"
            value={pbl}
            unit="m"
            color={pbl < 300 ? SEVERITY.bad : pbl < 600 ? SEVERITY.moderate : SEVERITY.good}
            icon={<ArrowLeftRight className="size-3.5 rotate-90" />}
            hint={pbl < 300 ? 'collapsed' : 'mixing'}
          />
          <MetricCard
            label="Temperature"
            value={temp.toFixed(1)}
            unit="°C"
            icon={<Thermometer className="size-3.5" />}
            hint="2 m AGL"
          />
          <MetricCard
            label="Solar irradiance"
            value={solar}
            unit="W/m²"
            color={solar > 0 ? SERIES.solar : undefined}
            icon={<Sun className="size-3.5" />}
            hint={solar === 0 ? 'night' : 'aerosol-dimmed'}
          />
        </PanelBody>
      </Panel>

      {/* ---- trajectory ---------------------------------------------- */}
      <Panel className="flex-1">
        <PanelHeader
          title="72h trajectory"
          icon={<LineChart className="size-3" />}
          action={
            <div className="flex items-center gap-2.5">
              <LegendDot color={aqiColor(pm)} label="PM2.5" />
              <LegendDot color={SERIES.wind} label="Wind" dashed />
            </div>
          }
        />
        <PanelBody className="pb-1 pr-1">
          <TrajectoryChart
            frames={frames}
            currentHour={hour}
            districtId={selected}
            onScrub={setHour}
            height={188}
          />
          <p className="mt-1 px-1 font-mono text-2xs leading-relaxed text-faint">
            Peaks track wind minima under a shallow PBL.
          </p>
        </PanelBody>
      </Panel>

      {/* ---- district roster ------------------------------------------ */}
      <Panel>
        <PanelHeader title="District stations" icon={<Wind className="size-3" />} />
        <PanelBody className="space-y-1 p-2">
          {DISTRICTS.map((d) => {
            const s = frame.districts[d.id];
            const active = selected === d.id;
            return (
              <button
                key={d.id}
                onClick={() => selectDistrict(active ? null : d.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  active
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-transparent hover:border-hairline hover:bg-elevated/60',
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: aqiColor(s.pm25) }}
                />
                <span className="flex-1 truncate font-mono text-2xs uppercase tracking-wider text-ink">
                  {d.name}
                </span>
                <span
                  className="font-mono text-xs font-semibold tabular-nums"
                  style={{ color: aqiColor(s.pm25) }}
                >
                  {s.aqi}
                </span>
                <span className="w-14 text-right font-mono text-2xs tabular-nums text-faint">
                  {s.pm25.toFixed(0)}
                </span>
              </button>
            );
          })}
        </PanelBody>
      </Panel>
    </div>
  );
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1 font-mono text-2xs uppercase tracking-wider text-faint">
      <span
        className="h-0.5 w-3 rounded-full"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`
            : color,
        }}
      />
      {label}
    </span>
  );
}
