/**
 * The next 72 hours, from the backend's own forecast.
 *
 * This replaced a panel that charted `TEMPORAL_TRACE` - twenty-four numbers
 * typed into content.ts - under four timeframe buttons (24H/7D/30D/90D) that
 * all drew the same line. The data behind them did not exist, and the buttons
 * could not have worked.
 *
 * Two things here are deliberate.
 *
 * The line breaks where the forecast stops being the validated blend. Each
 * lead now says what it was built from: one with a measured day behind it is
 * `blend`, scored at 62.23 ug/m3, and past the observations there is no
 * diurnal parent so CAMS runs alone at 83.41. Drawing both as one line, under
 * one accuracy figure, would claim the better number for hours that never
 * earned it. Solid is blend, dashed is CAMS alone, and the legend says so.
 *
 * The CPCB bands sit behind the line as colour. The point of an AQI chart is
 * which band the air is in, not the integer, and reading that off a y-axis
 * costs the viewer a step the background can do for free.
 */
import * as React from 'react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { AQI_RAMP } from '@/lib/terminal/bands';
import type { ForecastSource } from '@/lib/forecastApi';
import { TERM } from '@/lib/terminal/palette';

/** Hours between x-axis marks. Every hour is unreadable; every 24 hides the
 *  shape of a day, which for NCR is the whole story - the morning build-up and
 *  the afternoon dip both sit inside one. */
const TICK_HOURS = 12;

export type ForecastPoint = { hour: number; aqi: number };


/** "+12h" and the IST clock time it lands on. */
function tickLabel(originIso: string | undefined, hour: number): { lead: string; clock: string } {
  const lead = hour === 0 ? 'now' : `+${hour}h`;
  if (!originIso) return { lead, clock: '' };
  const t = new Date(originIso);
  if (Number.isNaN(t.getTime())) return { lead, clock: '' };
  const at = new Date(t.getTime() + hour * 3_600_000);
  return {
    lead,
    clock: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at),
  };
}

export function ForecastTrack({
  points,
  source,
}: {
  points: ForecastPoint[];
  source: ForecastSource | null;
}) {
  const w = 760;
  const h = 260;
  const padL = 34;
  const padB = 34;
  const padT = 10;

  if (points.length < 2) {
    return (
      <div id="analytics" className="space-y-3">
        <SectionHead title="72-Hour Forecast" sub="Waiting for the forecast service" />
        <TelemetryCard className="flex h-56 items-center justify-center p-6">
          <span className="font-mono text-xs text-term-outline">No forecast available</span>
        </TelemetryCard>
      </div>
    );
  }

  const methods = source?.lead_methods ?? [];
  // The scale is fixed to the CPCB ladder rather than to the data, so two
  // different days are comparable and a calm one does not look alarming for
  // filling the same height.
  const maxAqi = Math.max(300, ...points.map((p) => p.aqi));
  const x = (hour: number) => padL + (hour / (points.length - 1)) * (w - padL - 8);
  const y = (aqi: number) => padT + (1 - Math.min(aqi, maxAqi) / maxAqi) * (h - padT - padB);

  // Split into runs of one method so each is drawn with its own stroke.
  const runs: { method: string; pts: ForecastPoint[] }[] = [];
  points.forEach((p, i) => {
    const m = methods[i - 1] ?? methods[i] ?? 'cams_only';
    const last = runs[runs.length - 1];
    if (last && last.method === m) last.pts.push(p);
    // Repeat the joining point so the two runs meet instead of leaving a notch.
    else runs.push({ method: m, pts: last ? [last.pts[last.pts.length - 1], p] : [p] });
  });

  // Every 12 hours, plus the horizon itself. The series runs 0..71, so the
  // last hour is never a multiple of 12 and the far end of a "72-hour
  // forecast" would otherwise carry no label at all.
  const ticks = points.filter((p) => p.hour % TICK_HOURS === 0);
  const lastPoint = points[points.length - 1];
  if (lastPoint.hour % TICK_HOURS !== 0) ticks.push(lastPoint);
  const path = (pts: ForecastPoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.hour).toFixed(1)},${y(p.aqi).toFixed(1)}`).join(' ');

  const blendLeads = source?.blend_leads ?? 0;
  const camsLeads = source?.cams_only_leads ?? 0;
  const rmse = source?.rmse_by_method ?? {};

  return (
    <div id="analytics" className="space-y-3">
      <SectionHead
        title="72-Hour Forecast"
        sub={`Composite AQI across the mesh, ${TICK_HOURS}-hourly · ${
          source?.method ?? 'blend(diurnal_persistence, cams_bias)'
        }`}
        right={
          <span className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {blendLeads > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: TERM.primary }} />
                blend {rmse.blend ? `· ${rmse.blend}` : ''}
              </span>
            ) : null}
            {camsLeads > 0 ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4"
                  style={{
                    backgroundImage: `repeating-linear-gradient(90deg, ${TERM.secondary} 0 4px, transparent 4px 7px)`,
                  }}
                />
                CAMS only {rmse.cams_only ? `· ${rmse.cams_only}` : ''}
              </span>
            ) : null}
          </span>
        }
      />

      <TelemetryCard className="p-4">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="72 hour AQI forecast">
          {/* CPCB bands as background, so the reader sees the category before
              the number. Clipped to the plot area. */}
          {AQI_RAMP.map((b) => {
            const top = y(Math.min(b.to, maxAqi));
            const bottom = y(Math.min(b.from, maxAqi));
            if (bottom - top <= 0) return null;
            return (
              <rect
                key={b.label}
                x={padL}
                y={top}
                width={w - padL - 8}
                height={bottom - top}
                fill={b.color}
                opacity={0.1}
              />
            );
          })}

          {/* y gridlines at the band edges, which are the numbers that matter */}
          {AQI_RAMP.map((b) =>
            b.from > 0 && b.from <= maxAqi ? (
              <g key={`g-${b.label}`}>
                <line
                  x1={padL}
                  x2={w - 8}
                  y1={y(b.from)}
                  y2={y(b.from)}
                  stroke={TERM.outlineVariant}
                  strokeWidth="0.5"
                />
                <text
                  x={padL - 6}
                  y={y(b.from) + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill={TERM.inkVariant}
                  fontFamily="var(--font-mono), monospace"
                >
                  {b.from}
                </text>
              </g>
            ) : null,
          )}

          {/* 12-hour marks */}
          {ticks.map((t) => {
            const { lead, clock } = tickLabel(source?.origin, t.hour);
            return (
              <g key={t.hour}>
                <line
                  x1={x(t.hour)}
                  x2={x(t.hour)}
                  y1={padT}
                  y2={h - padB}
                  stroke={TERM.outlineVariant}
                  strokeWidth={t.hour === 0 ? 1.2 : 0.5}
                  strokeDasharray={t.hour === 0 ? undefined : '2 4'}
                />
                <text
                  x={x(t.hour)}
                  y={h - padB + 14}
                  textAnchor="middle"
                  fontSize="9"
                  fill={t.hour === 0 ? TERM.primary : TERM.inkVariant}
                  fontFamily="var(--font-mono), monospace"
                  fontWeight={t.hour === 0 ? 700 : 400}
                >
                  {lead}
                </text>
                <text
                  x={x(t.hour)}
                  y={h - padB + 25}
                  textAnchor="middle"
                  fontSize="8"
                  fill={TERM.outline}
                  fontFamily="var(--font-mono), monospace"
                >
                  {clock}
                </text>
              </g>
            );
          })}

          {/* the forecast itself, one stroke per method */}
          {runs.map((run, i) => (
            <path
              key={i}
              d={path(run.pts)}
              fill="none"
              stroke={run.method === 'cams_only' ? TERM.secondary : TERM.primary}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={run.method === 'cams_only' ? '5 4' : undefined}
              opacity={run.method === 'cams_only' ? 0.85 : 1}
            />
          ))}

          {/* the hour the forecast was issued for */}
          <circle cx={x(0)} cy={y(points[0].aqi)} r="4" fill={TERM.primary} />
          <text
            x={x(0) + 8}
            y={y(points[0].aqi) - 8}
            fontSize="10"
            fill={TERM.ink}
            fontFamily="var(--font-mono), monospace"
            fontWeight="700"
          >
            {points[0].aqi}
          </text>
        </svg>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-term-outline-variant/40 pt-2">
          <Label>
            {AQI_RAMP.map((b) => b.label).slice(0, 4).join(' · ')} — bands shown as background
          </Label>
          <Label>
            {blendLeads > 0 && camsLeads > 0
              ? `${blendLeads}h blended with measurements, ${camsLeads}h on CAMS alone`
              : camsLeads > 0
                ? 'Every hour on CAMS alone — no measured day behind this origin yet'
                : 'Every hour blended with measurements'}
          </Label>
        </div>
      </TelemetryCard>
    </div>
  );
}
