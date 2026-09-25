/**
 * The meteorology side channel, and whether it is still worth anything.
 *
 * The GFS extract is committed to the repository rather than fetched live, so
 * it ages from the moment it lands. The backend has been computing exactly how
 * much all along; nothing displayed it. As this was written the file is 104
 * hours old with its entire 72-hour window in the past, and the dashboard gave
 * no sign.
 *
 * The panel leads with the verdict rather than the cycle id. "expired" is the
 * fact a reader acts on; "20260916_00z" is how you'd look it up afterwards.
 *
 * It also states that this feeds no forecast. Showing a met source beside a
 * forecast invites the reader to assume one drives the other, and here it does
 * not: the blend baseline is scored at 62.23 without it, and adding an input
 * would invalidate that number.
 */
import * as React from 'react';
import { useSeverityInk } from '@/lib/terminal/palette';
import { CloudOff, CloudSun } from 'lucide-react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { fetchGfs, GFS_STATUS, type GfsPayload } from '@/lib/gfsApi';

/** The file only changes when the partner repo is pulled; no need to poll hard. */
const REFRESH_MS = 600_000;

function istDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function MetSourcePanel() {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  const [data, setData] = React.useState<GfsPayload | null>(null);
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const d = await fetchGfs();
      if (!alive) return;
      if (d) setData(d);
      setTried(true);
      timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!data) {
    if (!tried) return null;
    return (
      <TelemetryCard className="p-4">
        <span className="font-mono text-xs text-term-outline">
          No GFS extract available — the partner pipeline has not committed one
        </span>
      </TelemetryCard>
    );
  }

  const f = data.freshness;
  const tone = GFS_STATUS[f.status] ?? GFS_STATUS.stale;
  const Icon = f.expired ? CloudOff : CloudSun;
  const fields = Object.entries(data.fields);

  return (
    <div id="met" className="space-y-3">
      <SectionHead
        title="Meteorology Source"
        sub="NOAA GFS, clipped to the NCR domain by the partner pipeline"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {data.grid_points} cells · {data.steps} steps
          </span>
        }
      />

      <TelemetryCard className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <Icon className="mt-0.5 size-6 shrink-0" style={{ color: ink(tone.color) }} />
            <div>
              <div className="font-display text-lg font-bold uppercase" style={{ color: ink(tone.color) }}>
                {f.status}
              </div>
              <div className="mt-0.5 font-mono text-xs text-term-ink-variant">{tone.means}</div>
              {f.note ? (
                <div className="mt-1 max-w-md font-mono text-[11px] text-term-outline">{f.note}</div>
              ) : null}
            </div>
          </div>

          <div className="flex gap-6">
            <div>
              <Label>Cycle age</Label>
              <div className="font-mono text-2xl font-bold text-term-ink">
                {f.cycle_age_hours == null ? '—' : `${f.cycle_age_hours.toFixed(0)}h`}
              </div>
              <div className="font-mono text-[10px] text-term-outline">
                init {istDay(f.cycle_init)} IST
              </div>
            </div>
            <div>
              <Label>Window left</Label>
              <div
                className="font-mono text-2xl font-bold"
                style={{ color: ink(f.expired ? tone.color : undefined) }}
              >
                {f.hours_remaining == null ? '—' : `${f.hours_remaining.toFixed(0)}h`}
              </div>
              <div className="font-mono text-[10px] text-term-outline">
                to {istDay(data.last_valid)} IST
              </div>
            </div>
          </div>
        </div>

        {/* Per-field row counts, including the ones flagged or filled. A field
            that is present but half-imputed is not the same as a field that is
            measured, and the export distinguishes them. */}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-term-outline-variant/40 pt-3 sm:grid-cols-4">
          {fields.map(([name, v]) => (
            <div key={name}>
              <Label className="block truncate">{name}</Label>
              <span className="font-mono text-xs font-bold text-term-ink">
                {v.rows} rows
              </span>
              <span className="block font-mono text-[10px] text-term-outline">
                {v.unit}
                {v.rows_imputed > 0 ? ` · ${v.rows_imputed} filled` : ''}
                {v.rows_flagged > 0 ? ` · ${v.rows_flagged} flagged` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-term-outline-variant/40 pt-2">
          <Label>
            {/* Said outright, because a met panel next to a forecast implies a
                dependency that does not exist here. */}
            Read-only side channel · feeds no forecast, so the scored RMSE is unaffected
          </Label>
          <Label>{data.cycles[data.cycles.length - 1] ?? '—'}</Label>
        </div>
      </TelemetryCard>
    </div>
  );
}
