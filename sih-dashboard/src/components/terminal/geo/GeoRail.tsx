import * as React from 'react';
import { Compass, Navigation, Wind } from 'lucide-react';
import { MeshOdometer, useRollDuration } from '@/components/terminal/MeshOdometer';
import { Label, Meter, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { aqiColor, bandForAqi } from '@/lib/terminal/bands';
import { fetchStationForecast, type StationForecast } from '@/lib/forecastApi';
import { DISPERSION, type TerminalFrame } from '@/lib/terminal/field';
import { findById } from '@/lib/terminal/stations';
import { livePlumeSources, shareLabel, useMeasuredWind } from '@/lib/terminal/plumes';
import { useHubStation, useMesh } from '@/lib/terminal/useMesh';
import { useTerminalStore } from '@/store/useTerminalStore';
import { compassName } from '@/lib/terminal/wind';
import { useAppStore } from '@/store/useAppStore';
import { TERM, useTermPalette, useSeverityInk } from '@/lib/terminal/palette';

/** The three-card rail beside the map. */
export function GeoRail({ frame }: { frame: TerminalFrame }) {
  return (
    <div className="space-y-5 lg:col-span-4">
      <SourceAttribution frame={frame} />
      <SelectedNode frame={frame} />
      <TrappingDispersion frame={frame} />
    </div>
  );
}

function SourceAttribution({ frame }: { frame: TerminalFrame }) {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  const wind = useMeasuredWind(0);
  const fire = useAppStore((st) => st.source?.fire);
  const sources = React.useMemo(
    () => livePlumeSources(wind?.fromDeg ?? null, fire),
    [wind?.fromDeg, fire],
  );
  const measured = useMeasuredWind(frame.offset);
  return (
    <TelemetryCard className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold tracking-tight text-term-ink">Source Attribution</h3>
        <Label>Measured only</Label>
      </div>

      <div className="space-y-2.5">
        {sources.map((s) => (
          <div key={s.id}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                <span className="font-medium text-term-ink">{s.label}</span>
              </span>
              <span className="font-mono font-bold" style={{ color: ink(s.color) }}>
                {shareLabel(s)}
              </span>
            </div>
            <Meter pct={s.share} color={s.color} />
            <Label className="mt-0.5 block">{s.detail}</Label>
          </div>
        ))}
        {/* The industrial, vehicular and construction bars stood here and were
            invented - see lib/terminal/plumes. What is left is whatever the
            fire feed can actually account for, which on most days is a small
            share of one source and sometimes nothing. Saying that plainly is
            better than filling the card with three numbers nothing measured. */}
        <p className="font-body text-[11px] leading-relaxed text-term-ink-variant">
          {sources.length
            ? 'Only transport this system can measure is apportioned. The rest of the load is local emission — traffic, industry and dust — which no feed here quantifies.'
            : 'Nothing measurable is being transported into the basin this hour. The load is local emission, which no feed here quantifies.'}
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-term-outline-variant/40 pt-2 font-mono text-[11px] font-bold text-term-primary">
        <Navigation className="size-3.5" />
        {/* Was the word NORTH-WEST, printed whatever the air was doing. The
            attribution below it is editorial and stays; the direction is a
            measurement and now reads like one. */}
        DOMINANT INFLOW VECTOR:{' '}
        {measured ? `${compassName(measured.fromDeg)} · ${Math.round(measured.fromDeg)}°` : 'NORTH-WEST'}
      </div>
    </TelemetryCard>
  );
}

/** Detail for whichever node is selected on the map or in the ranking. */
function SelectedNode({ frame }: { frame: TerminalFrame }) {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  const rollMs = useRollDuration();
  // The hub, not the stored id - the same resolution the header's picker uses,
  // and for the same reason.
  //
  // `selectedId` defaults to the curated master, and the live CPCB bulletin
  // does not carry that station. So on first load `findById` returned nothing
  // and this card returned null: the rail lost its largest panel, leaving 406
  // pixels of empty column beside the map, and the page looked like it had a
  // layout bug rather than a missing selection. The header did not show the
  // problem because it already resolves through `useHubStation` and was
  // quietly naming a different station than this card was looking for.
  const { station } = useHubStation();

  // The node's own 72-hour line. The mesh-wide track on the overview is a
  // composite; this is the station a reader has actually selected.
  //
  // Declared above the guards below on purpose: React counts hooks by call
  // order, so one sitting behind an early return changes that count the moment
  // a station is deselected.
  const meshId = station && 'meshId' in station ? station.meshId : null;
  const [forecast, setForecast] = React.useState<StationForecast | null>(null);
  React.useEffect(() => {
    if (meshId == null) return;
    let alive = true;
    void fetchStationForecast(meshId).then((f) => {
      if (alive) setForecast(f);
    });
    return () => {
      alive = false;
    };
  }, [meshId]);

  // Matched rather than cleared. Blanking the state on every station change is
  // a setState inside an effect, which starts a second render for nothing; the
  // previous station's line simply is not drawn while the new one loads.
  const track =
    forecast && meshId != null && String(forecast.station_id) === String(meshId)
      ? forecast
      : null;

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

  // PM10 read from the station, not derived from PM2.5.
  //
  // This row was `sample.pm25 * 1.74` - a fixed ratio applied to a different
  // pollutant and printed in ug/m3 beside three measured channels. The frames
  // payload carries no PM10, but the mesh does per station, so the reading is
  // available and was simply not being asked for. Where the feed gives only a
  // sub-index (CPCB's bulletin does) the row says so rather than converting.
  const pm10sub = 'subIndices' in station ? station.subIndices?.PM10 : undefined;
  const pm10 =
    pm10sub?.concentration != null
      ? { value: pm10sub.concentration, unit: 'µg/m³', pct: (pm10sub.concentration / 250) * 100 }
      : pm10sub?.sub_index != null
        ? { value: pm10sub.sub_index, unit: 'sub-index', pct: (pm10sub.sub_index / 200) * 100 }
        : null;

  // Same three sources as the map tooltip. A station that publishes no PM2.5
  // gets no PM2.5 row rather than the placeholder the frame carries for it,
  // and one converted from CPCB's published index is labelled as converted.
  const pm25Row =
    sample.pm25Basis === 'none'
      ? []
      : [{
          label:
            sample.pm25Basis === 'index' ? 'PM2.5 (from CPCB index)'
            : sample.pm25Basis === 'estimate' ? 'PM2.5 (est. from AQI)'
            : 'PM2.5',
          value: sample.pm25,
          unit: 'µg/m³',
          pct: (sample.pm25 / 120) * 100,
        }];

  const channels = [
    ...pm25Row,
    ...(pm10 ? [{ label: 'PM10', ...pm10 }] : []),
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
            <span className="font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: ink(color) }}>
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
          {track ? (
        <div className="border-t border-term-outline-variant/40 pt-3">
          <div className="flex items-center justify-between">
            <Label>Next {track.values.length}h at this node</Label>
            <span className="font-mono text-[10px] text-term-ink-variant">
              {Math.min(...track.values).toFixed(0)}–{Math.max(...track.values).toFixed(0)} {track.unit}
            </span>
          </div>
          {/* This node's own forecast, not the mesh composite on the overview.
              A basin does not move as one - the north-west traps hours before
              the south - so the two lines differ and that is the point. */}
          <svg viewBox="0 0 240 48" className="mt-1 h-12 w-full" role="img"
               aria-label={`72 hour ${track.channel} forecast for this node`}>
            <path
              d={track.values
                .map((v, k) => {
                  const x = (k / Math.max(track.values.length - 1, 1)) * 240;
                  const hi = Math.max(...track.values) || 1;
                  const y = 44 - (v / hi) * 40;
                  return `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}

</TelemetryCard>
  );
}

/**
 * The measured bearing for this hour, or null offline.
 *
 * The card read a constant "NW" beside a compass needle drawn at a fixed
 * angle. The backend has carried a real direction per district all along, and
 * on 19 September it was 153 degrees - south-south-easterly - while the card
 * said north-west and the needle pointed there.
 */
/**
 * How well the basin is ventilating, at the hour on the timeline.
 *
 * Every row here was a literal: a 412 m boundary layer, a dispersion index of
 * 0.38 "POOR", an inversion risk of "HIGH" and 3.4 days of bowl retention. The
 * first of those was the problem - the frames payload puts the layer at 52 m
 * right now, and the Inversion Trap Zones panel a few inches down the same page
 * reports 50 m. The page was disagreeing with itself by a factor of eight.
 *
 * Three rows have a real source and use it. "Bowl retention" does not: nothing
 * here models how long the basin holds an air mass, and the 3.4 days was a
 * number someone liked. It is gone rather than approximated - the same call as
 * "Interpolation Confidence" in the coverage strip.
 *
 * The ventilation index replaces the unsourced "dispersion idx". It is the
 * standard quantity - mixing depth times mean wind speed, in m2/s - so it is
 * defined rather than asserted, and it is what decides whether a given
 * emission disperses or sits on the city.
 */
function TrappingDispersion({ frame }: { frame: TerminalFrame }) {
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  const measured = useMeasuredWind(frame.offset);
  const live = useAppStore((st) => st.liveFrames)?.[frame.offset];

  const pbl = live?.avgPbl ?? null;
  const windMs = measured ? measured.speedKmh / 3.6 : null;
  // Ventilation index: mixing depth x transport wind. Below about 2000 m2/s is
  // the range where emissions accumulate; above 6000 the basin clears.
  const ventilation = pbl != null && windMs != null ? pbl * windMs : null;
  const ventLabel =
    ventilation == null ? '' : ventilation < 2000 ? 'POOR' : ventilation < 6000 ? 'FAIR' : 'GOOD';
  const inv = live?.inversionIndex ?? null;
  const invLabel =
    inv == null ? '—' : inv >= 0.75 ? 'HIGH' : inv >= 0.5 ? 'MODERATE' : 'LOW';

  const rows = [
    {
      label: 'Wind',
      value: measured
        ? `${measured.speedKmh.toFixed(1)} km/h ${compassName(measured.fromDeg)}`
        : '—',
      cls: 'text-term-ink',
    },
    { label: 'Boundary layer', value: pbl == null ? '—' : `${pbl.toFixed(0)} m`, cls: 'text-term-ink' },
    {
      label: 'Ventilation idx',
      value: ventilation == null ? '—' : `${ventilation.toFixed(0)} m²/s ${ventLabel}`,
      cls: 'text-orange-700 dark:text-orange-400',
    },
    {
      label: 'Inversion risk',
      value: inv == null ? '—' : `${invLabel} (${inv.toFixed(2)})`,
      cls: 'text-amber-700 dark:text-amber-400',
    },
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
          {/* Points at where the air is coming from, which is what a wind
              rose shows. Drawn from the bearing rather than at a fixed 45
              degrees: bearings run clockwise from north, so north is -y and
              east is +x, and the needle length is 23 units. */}
          {(() => {
            const deg = measured?.fromDeg ?? 315;
            const r = (deg * Math.PI) / 180;
            return (
              <line
                x1="50"
                y1="50"
                x2={50 + 23 * Math.sin(r)}
                y2={50 - 23 * Math.cos(r)}
                stroke={TERM.primary}
                strokeWidth="3"
                strokeLinecap="round"
              />
            );
          })()}
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
        {/* Where it goes, which is the reverse of where it came from. */}
        Plume drift → {measured ? compassName((measured.fromDeg + 180) % 360) : DISPERSION.driftDir} at{' '}
        {measured ? (measured.speedKmh * 0.28).toFixed(1) : DISPERSION.driftSpeed} km/h
        <Compass className="ml-auto size-3.5 text-term-outline" />
      </div>
    </TelemetryCard>
  );
}
