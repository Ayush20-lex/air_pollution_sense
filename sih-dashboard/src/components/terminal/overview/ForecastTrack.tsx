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
import { TERM, useTermPalette } from '@/lib/terminal/palette';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/** Hours between x-axis marks. Every hour is unreadable; every 24 hides the
 *  shape of a day, which for NCR is the whole story - the morning build-up and
 *  the afternoon dip both sit inside one. */
const TICK_HOURS = 12;

export type ForecastPoint = { hour: number; aqi: number };


/**
 * The axis clock ticks on the reader's own hour, not the run's origin.
 *
 * It used to read `source.origin`, and on an archive-replay deployment that
 * origin does not move: the axis under a chart captioned "the next three days"
 * said "now · Sun 04:30" on a Friday afternoon, and said it again the next day,
 * and the day after. Whatever the run is replaying, the horizon a reader is
 * being shown starts at the hour they are in, so the dates roll over with the
 * calendar instead of freezing on the run.
 */
const IST_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const IST_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
});

/** "+12h", the IST clock time it lands on, and its calendar date. */
function tickLabel(baseMs: number, hour: number): { lead: string; clock: string; date: string } {
  const lead = hour === 0 ? 'now' : `+${hour}h`;
  const at = new Date(baseMs + hour * 3_600_000);
  return { lead, clock: IST_CLOCK.format(at), date: IST_DATE.format(at) };
}

/** The top of the current hour, in epoch ms. Every tick hangs off this. */
function currentHour(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export function ForecastTrack({
  points,
  source,
}: {
  points: ForecastPoint[];
  source: ForecastSource | null;
}) {
  // Re-render when the theme flips; TERM values below are baked into SVG
  // attributes at render time and will not restyle themselves.
  useTermPalette();
  const reduced = usePrefersReducedMotion();
  // Re-read at the top of each hour so "now" stays now and the weekday under
  // the far end of the axis turns over at midnight on its own. A minute is
  // fine as the poll: it costs one cheap re-render and means the label is
  // never more than sixty seconds behind the hour it names.
  const [axisBase, setAxisBase] = React.useState(currentHour);
  React.useEffect(() => {
    const id = window.setInterval(() => setAxisBase(currentHour()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const w = 760;
  const h = 272;
  const padL = 34;
  // Deep enough for three rows under the axis: the lead, the clock, and the
  // calendar date where the day turns over.
  const padB = 46;
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
        // The method expression - blend(diurnal_persistence, cams_bias) - was
        // the whole subtitle. It names the algorithm to someone who already
        // knows it and tells everyone else nothing about what the chart shows.
        // The plain sentence goes here; the method is still on the page, in
        // the footnote where a reader who wants it will look.
        sub="What the air is expected to do over the next three days. Higher is worse."
        right={
          <span className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {blendLeads > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: TERM.primary }} />
                {/* Units matter here more than anywhere on the page: the axis
                    is AQI and this figure is PM2.5 in ug/m3, so printing the
                    bare number beside an AQI chart read as "+/- 62 AQI". */}
                anchored to readings{rmse.blend ? ` · typically off by ${Math.round(rmse.blend)} ug/m3` : ''}
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
                model only{rmse.cams_only ? ` · typically off by ${Math.round(rmse.cams_only)} ug/m3` : ''}
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

          {/* The band's own name, on the band. The footer listed them in order
              and left the reader to map four words onto four stripes by
              counting; naming each one in place removes that step. Drawn only
              where the stripe is tall enough to hold the text. */}
          {AQI_RAMP.map((b) => {
            const top = y(Math.min(b.to, maxAqi));
            const bottom = y(Math.min(b.from, maxAqi));
            if (bottom - top < 16) return null;
            return (
              <text
                key={`bl-${b.label}`}
                x={w - 12}
                y={(top + bottom) / 2 + 3}
                textAnchor="end"
                fontSize="9"
                fill={b.color}
                opacity={0.75}
                fontFamily="var(--font-mono), monospace"
                letterSpacing="0.08em"
              >
                {b.label.toUpperCase()}
              </text>
            );
          })}

          {/* The axis had numbers and no name, so 301 could have been anything.
              AQI is the one word that makes the whole scale legible. */}
          <text
            x={10}
            y={padT + (h - padT - padB) / 2}
            transform={`rotate(-90 10 ${padT + (h - padT - padB) / 2})`}
            textAnchor="middle"
            fontSize="9"
            fill={TERM.inkVariant}
            fontFamily="var(--font-mono), monospace"
            letterSpacing="0.12em"
          >
            AQI
          </text>

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
          {ticks.map((t, i) => {
            const { lead, clock, date } = tickLabel(axisBase, t.hour);
            // The calendar date only where it changes. Under every tick it is
            // six repetitions of two days; at the crossings it is the one
            // thing the weekday alone cannot tell you - which 04:30 this is.
            const prev = i > 0 ? tickLabel(axisBase, ticks[i - 1].hour).date : null;
            const showDate = prev !== date;
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
                {showDate && (
                  <text
                    x={x(t.hour)}
                    y={h - padB + 35}
                    textAnchor="middle"
                    fontSize="8"
                    fill={TERM.outline}
                    fontFamily="var(--font-mono), monospace"
                    letterSpacing="0.06em"
                  >
                    {date}
                  </text>
                )}
              </g>
            );
          })}

          <g>
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
          </g>

          {/* The animation is a highlight that travels the line once, not a
              reveal of the line itself.

              A mask was tried first and is the wrong shape of idea: a running
              animation overrides the resting style, so wherever the compositor
              does not advance it - a minimised window, a throttled background
              tab - the mask stays shut and the chart is simply blank. Whatever
              fails here should cost the motion and never the data, so the line
              and its numbers are drawn unconditionally and this rides over
              them. If it never moves, it is a dot at hour zero. */}
          {reduced ? null : (
            <circle
              className="forecast-runner"
              // Was r=4 at 0.55 opacity in neutral ink, crossing 72 hours in
              // 2.4s. It was moving the whole time and read as a static dot:
              // too small, too faint, and too fast to follow. Bigger, brighter
              // and slower, with the halo below, so the eye can actually track
              // it along the line.
              r="5.5"
              // Neutral, not a method colour. The runner carries no reading -
              // it is a sweep - and painting it `primary` made it read as a
              // blend marker while riding a track that was CAMS-only end to
              // end, which is a claim about provenance made by decoration.
              fill={TERM.ink}
              opacity="0.95"
              // Must be the origin. `animateMotion` translates an element from
              // wherever it already sits, so a cx/cy here is added on top of
              // the path's own absolute coordinates and the origin is counted
              // twice - the dot rode 46 units right and 52 down of the line it
              // was supposed to trace, floating in open space beside it.
              cx={0}
              cy={0}
            >
              <animateMotion
                dur="6s"
                repeatCount="indefinite"
                path={path(points)}
                rotate="auto"
              />
            </circle>
          )}

          {/* A halo riding the same path, pulsing as it goes. The sweep has to
              be visible at a glance from across a room during a demo, and one
              small dot is not. It carries no reading - same neutral ink as the
              runner - so it cannot be mistaken for a value. */}
          {reduced ? null : (
            <circle r="11" fill="none" stroke={TERM.ink} strokeWidth="1.5" opacity="0.28" cx={0} cy={0}>
              <animateMotion dur="6s" repeatCount="indefinite" path={path(points)} />
              <animate
                attributeName="r"
                values="7;13;7"
                dur="1.5s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.35;0.05;0.35"
                dur="1.5s"
                repeatCount="indefinite"
              />
            </circle>
          )}

          {/* The value at each 12-hour mark. Every one of the 72 would be
              unreadable and most carry no information the shape does not
              already give; the marks are where the eye stops anyway.

              Each is delayed to land as the sweep passes it, so the numbers
              arrive with the line rather than all at once at the end. */}
          {ticks.map((t, i) => {
            const above = t.aqi < maxAqi * 0.75;
            const method = methods[Math.max(0, t.hour - 1)] ?? 'cams_only';
            const colour = method === 'cams_only' ? TERM.secondary : TERM.primary;
            // Pull the first and last inside the plot so neither is clipped.
            const anchor = i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle';
            return (
              <g
                key={`v-${t.hour}`}
                className={reduced ? undefined : 'forecast-value'}
                style={
                  reduced
                    ? undefined
                    : { animationDelay: `${0.15 + (t.hour / lastPoint.hour) * 0.95}s` }
                }
              >
                <circle cx={x(t.hour)} cy={y(t.aqi)} r={t.hour === 0 ? 4 : 2.5} fill={colour} />
                <text
                  x={x(t.hour)}
                  y={above ? y(t.aqi) - 9 : y(t.aqi) + 16}
                  textAnchor={anchor}
                  fontSize="11"
                  fill={TERM.ink}
                  fontFamily="var(--font-mono), monospace"
                  fontWeight="700"
                  paintOrder="stroke"
                  stroke={TERM.bgDeep}
                  strokeWidth="3"
                  strokeLinejoin="round"
                >
                  {t.aqi}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-term-outline-variant/40 pt-2">
          <Label>
            Each point is the AQI expected at that hour · colour bands are CPCB categories
          </Label>
          <Label>
            {blendLeads > 0 && camsLeads > 0
              ? `Solid: ${blendLeads}h anchored to yesterday's measurements. Dashed: ${camsLeads}h from the CAMS model alone, which is less accurate.`
              : camsLeads > 0
                ? 'Dashed throughout: no measured day sits behind this forecast yet, so every hour comes from the CAMS model alone — less accurate than an anchored hour.'
                : 'Solid throughout: every hour is anchored to a measured day.'}
          </Label>
        </div>
      </TelemetryCard>
    </div>
  );
}
