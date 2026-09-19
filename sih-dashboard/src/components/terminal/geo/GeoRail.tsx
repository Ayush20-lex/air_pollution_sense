import * as React from 'react';
import { Compass, Navigation, Wind } from 'lucide-react';
import { MeshOdometer, useRollDuration } from '@/components/terminal/MeshOdometer';
import { Label, Meter, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { DISPERSION, type TerminalFrame } from '@/lib/terminal/field';
import { PLUME_SOURCES, findById } from '@/lib/terminal/stations';
import { useMesh } from '@/lib/terminal/useMesh';
import { useTerminalStore } from '@/store/useTerminalStore';
import { TERM } from '@/lib/terminal/palette';

/** The three-card rail beside the map. */
export function GeoRail({ frame }: { frame: TerminalFrame }) {
  return (
    <div className="space-y-5 lg:col-span-4">
      <SourceAttribution />
      <SelectedNode frame={frame} />
      <TrappingDispersion />
    </div>
  );
}

function SourceAttribution() {
  return (
    <TelemetryCard className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Source Attribution</h3>
        <Label>Last 24h</Label>
      </div>

      <div className="space-y-2.5">
        {PLUME_SOURCES.map((s) => (
          <div key={s.id}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                <span className="font-medium text-term-ink">{s.label}</span>
              </span>
              <span className="font-mono font-bold" style={{ color: s.color }}>
                {s.share}%
              </span>
            </div>
            <Meter pct={s.share} color={s.color} />
            <Label className="mt-0.5 block">{s.detail}</Label>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-term-outline-variant/40 pt-2 font-mono text-[11px] font-bold text-term-primary">
        <Navigation className="size-3.5" />
        DOMINANT INFLOW VECTOR: NORTH-WEST
      </div>
    </TelemetryCard>
  );
}

/** Detail for whichever node is selected on the map or in the ranking. */
function SelectedNode({ frame }: { frame: TerminalFrame }) {
  const selectedId = useTerminalStore((s) => s.selectedId);
  const rollMs = useRollDuration();
  const station = findById(useMesh().stations, selectedId);
  if (!station) return null;

  // The mesh and the frames are separate state and land one render apart, so
  // a station can exist in the list before it exists in the frame. That window
  // widened when the mesh started coming from a live feed - the whole station
  // set changes at once, not just its values - and reading straight through
  // threw on `.pbl`.
  const sample = frame.nodes[station.id];
  if (!sample) return null;
  const color = aqiColor(sample.aqi);
  const band = bandForAqi(sample.aqi);

  const circumference = 302;
  const offset = circumference - circumference * Math.min(1, sample.aqi / 300);

  const channels = [
    { label: 'PM2.5', value: sample.pm25, unit: 'µg/m³', pct: (sample.pm25 / 120) * 100 },
    { label: 'PM10', value: sample.pm25 * 1.74, unit: 'µg/m³', pct: (sample.pm25 * 1.74) / 250 * 100 },
    { label: 'O₃', value: sample.o3, unit: 'µg/m³', pct: (sample.o3 / 120) * 100 },
    { label: 'NOx', value: sample.nox, unit: 'ppb', pct: (sample.nox / 140) * 100 },
  ];

  return (
    <TelemetryCard className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Selected Node</h3>
        {station.master ? (
          <span className="rounded border border-term-primary/40 bg-term-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold text-term-primary">
            MASTER
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative size-28 shrink-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r="48" fill="none" stroke={TERM.surfaceRaised} strokeWidth="12" />
            <circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-500"
              style={{ filter: `drop-shadow(0 0 8px ${color}b3)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <MeshOdometer
              value={sample.aqi}
              duration={rollMs}
              className="font-display text-3xl font-extrabold leading-none text-term-ink"
              aria-label={`AQI ${sample.aqi}`}
            />
            <span className="font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color }}>
              {band.label}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-base font-bold leading-tight text-term-ink">{station.name}</div>
          <Label className="block">
            {station.zone} zone • {station.agency}
          </Label>
          <div className="pt-1 font-mono text-[10px] text-term-secondary">
            {station.lat.toFixed(4)}°N, {station.lng.toFixed(4)}°E
          </div>
          <div className="font-mono text-[10px] text-term-ink-variant">
            PBL {sample.pbl} m • {station.sensors} sensors
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-term-outline-variant/40 pt-2">
        {channels.map((c) => (
          <div key={c.label}>
            <div className="mb-1 flex justify-between font-mono text-[10px]">
              <span className="text-term-ink-variant">{c.label}</span>
              <span className="font-bold text-term-ink">
                {c.value.toFixed(c.value < 10 ? 1 : 0)} {c.unit}
              </span>
            </div>
            <Meter pct={c.pct} color={aqiColor(c.pct * 2)} />
          </div>
        ))}
      </div>
    </TelemetryCard>
  );
}

function TrappingDispersion() {
  const rows = [
    { label: 'Wind', value: `${DISPERSION.windSpeed} km/h ${DISPERSION.windDir}`, cls: 'text-term-ink' },
    { label: 'Boundary layer', value: `${DISPERSION.boundaryLayer} m`, cls: 'text-term-ink' },
    { label: 'Dispersion idx', value: `${DISPERSION.dispersionIndex} ${DISPERSION.dispersionLabel}`, cls: 'text-orange-400' },
    { label: 'Inversion risk', value: DISPERSION.inversionRisk, cls: 'text-amber-400' },
    { label: 'Bowl retention', value: `${DISPERSION.bowlRetentionDays} days`, cls: 'text-term-ink' },
  ];

  return (
    <TelemetryCard className="space-y-3 p-5">
      <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Trapping &amp; Dispersion</h3>

      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="size-24 shrink-0" aria-label="Wind direction north-west">
          <circle cx="50" cy="50" r="42" fill={TERM.surfaceLowest} stroke={TERM.outlineVariant} strokeWidth="2" />
          <circle cx="50" cy="50" r="32" fill="none" stroke={TERM.surfaceHigh} strokeWidth="1" />
          <g fill={TERM.outline} fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono), monospace">
            <text x="50" y="16">N</text>
            <text x="50" y="92">S</text>
            <text x="90" y="54">E</text>
            <text x="10" y="54">W</text>
          </g>
          <line x1="50" y1="50" x2="27" y2="27" stroke={TERM.primary} strokeWidth="3" strokeLinecap="round" />
          <circle cx="50" cy="50" r="3.5" fill={TERM.primary} />
        </svg>

        <dl className="flex-1 space-y-1.5 font-mono text-[11px]">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between">
              <dt className="text-term-ink-variant">{r.label}</dt>
              <dd className={`font-bold ${r.cls}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex items-center gap-1.5 border-t border-term-outline-variant/40 pt-2 font-mono text-[10px] uppercase tracking-wider text-term-ink-variant">
        <Wind className="size-3.5 text-term-secondary" />
        Plume drift → {DISPERSION.driftDir} at {DISPERSION.driftSpeed} km/h
        <Compass className="ml-auto size-3.5 text-term-outline" />
      </div>
    </TelemetryCard>
  );
}
