/**
 * The meteorology side channel, and whether it is still worth anything.
 *
 * It draws whichever source answered - the live Open-Meteo fetch first, the
 * committed GFS extract as a fallback - and names it from the payload rather
 * than assuming. That matters because of the line further down: this panel
 * returns null when the source has expired, so while the only source was a
 * 299-hour-old file the whole section was invisible.
 *
 * The original note, still true of the parquet path: the extract is committed to
 * the repository rather than fetched live, so it ages from the moment it lands. The backend has been computing exactly how
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
import { fetchGfs, GFS_STATUS, MET_SOURCE, type GfsPayload, type MetCell, type MetStep } from '@/lib/gfsApi';

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

/** One readable fact: a big number and the line under it. */
type MetCard = { label: string; value: string; detail: string };

const BEARINGS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Where the wind is coming FROM, which is how everyone says it. */
function bearing(u: number, v: number): string {
  const deg = (Math.atan2(-u, -v) * 180) / Math.PI;
  return BEARINGS[Math.round(((deg + 360) % 360) / 22.5) % 16];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Every value of one field across one hour's cells, nulls dropped. */
function across(step: MetStep | undefined, key: keyof MetCell): number[] {
  if (!step) return [];
  return step.cells
    .map((c) => c[key])
    .filter((v): v is number => typeof v === 'number');
}

/**
 * Turn the payload into four facts and a coverage line.
 *
 * Deliberately defensive about which fields exist: the committed GFS extract
 * carries no humidity, boundary layer or radiation, and its precipitation is a
 * 3-hour bucket under a different key. A card whose field is absent is dropped
 * rather than shown as a dash, so this panel reads the same whichever source
 * answered - with fewer cards when the source has fewer fields.
 */
function summarise(data: GfsPayload): { cards: MetCard[]; coverage: string } {
  const series = data.series ?? [];
  const now = series[0];
  const cards: MetCard[] = [];

  const t = across(now, 'temperature_c');
  if (t.length) {
    const all = series.flatMap((st) => across(st, 'temperature_c'));
    cards.push({
      label: 'Temperature',
      value: `${mean(t).toFixed(1)}°C`,
      detail: `${Math.min(...all).toFixed(0)}–${Math.max(...all).toFixed(0)}°C over the window`,
    });
  }

  const u = across(now, 'u_wind_ms');
  const v = across(now, 'v_wind_ms');
  if (u.length && v.length) {
    const mu = mean(u);
    const mv = mean(v);
    cards.push({
      label: 'Wind',
      value: `${Math.hypot(mu, mv).toFixed(1)} m/s`,
      detail: `from the ${bearing(mu, mv)}, averaged over the domain`,
    });
  }

  const pbl = across(now, 'boundary_layer_height_m');
  const pblAll = series.flatMap((st) => across(st, 'boundary_layer_height_m'));
  if (pblAll.length) {
    cards.push({
      label: 'Mixing layer',
      value: pbl.length ? `${mean(pbl).toFixed(0)} m` : '—',
      detail: pbl.length
        ? `peaks at ${Math.max(...pblAll).toFixed(0)} m in the window`
        : 'too low to report this hour',
    });
  }

  // Rain is the field GFS adds that nothing else here carries, so it earns a
  // card even when the answer is none - "no rain expected" is information when
  // rain is the only thing that washes PM2.5 out of the air.
  const rainKey: keyof MetCell =
    'precipitation_mm_1h' in (now?.cells[0] ?? {}) ? 'precipitation_mm_1h' : 'precipitation_mm_3h';
  const rainAll = series.map((st) => across(st, rainKey)).filter((xs) => xs.length);
  if (rainAll.length) {
    const total = rainAll.reduce((sum, xs) => sum + mean(xs), 0);
    cards.push({
      label: 'Rain expected',
      value: total < 0.05 ? 'None' : `${total.toFixed(1)} mm`,
      detail: total < 0.05
        ? 'nothing to wash particulates out'
        : 'domain mean over the whole window',
    });
  }

  // The row counts the field table used to shout, reduced to the one sentence
  // they were worth - plus the single count that differs, and why.
  const counts = Object.values(data.fields).map((x) => x.rows);
  const floored = Object.values(data.fields).reduce((n, x) => n + (x.rows_floored ?? 0), 0);
  const parts: string[] = [];
  if (counts.length) {
    parts.push(
      `${Object.keys(data.fields).length} fields, ${Math.max(...counts)} hourly values each ` +
      `(${data.grid_points} cells x ${data.steps} steps), none flagged or filled.`,
    );
  }
  if (floored > 0) {
    parts.push(
      `${floored} mixing-layer values withheld: this model floors the field at 10 m overnight, ` +
      `and a real night-time mixing layer over Delhi is 100-300 m, so those are a fill value ` +
      `rather than a reading.`,
    );
  }
  if (data.fields_absent.length) {
    parts.push(`Absent from this source: ${data.fields_absent.join(', ')}.`);
  }

  return { cards, coverage: parts.join(' ') };
}

export function MetSourcePanel() {
  // Severity hues are chosen to be read as fills; as ink on the light
  // surface they fail contrast badly. See useSeverityInk.
  const ink = useSeverityInk();
  const [data, setData] = React.useState<GfsPayload | null>(null);

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const d = await fetchGfs();
      if (!alive) return;
      if (d) setData(d);
      timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Same rule as the expired case below, for the same reason: this channel
  // feeds no forecast, so its absence changes no figure on the page, and a
  // card announcing a missing side channel is a worry a reader cannot act on.
  // It was a grey line rather than a red one, but showing it here while
  // hiding the expired state would have been two behaviours for one fact.
  if (!data) return null;

  const f = data.freshness;

  // An expired cycle is drawn as nothing at all.
  //
  // Not because the panel was wrong - it was exactly right, and the backend
  // agreed with it: 132 hours old, the whole 72-hour window in the past. The
  // problem is that it is a read-only side channel which feeds no forecast, so
  // its staleness changes no number anywhere on this site, and a dead red box
  // on the overview costs a reader confidence in figures it has no bearing on.
  //
  // The extract is committed to the repository by a partner pipeline rather
  // than fetched, so it expires roughly three days after each commit and there
  // is nothing this page can do about it. When a fresh cycle is committed this
  // panel returns on its own; `/api/v1/status` reports the source either way,
  // so nothing is concealed from anyone auditing the system.
  if (f.expired) return null;

  const tone = GFS_STATUS[f.status] ?? GFS_STATUS.stale;
  const Icon = f.expired ? CloudOff : CloudSun;
  const met = summarise(data);
  // "Cycle" is GFS vocabulary for a model run, and a live fetch has no run
  // id - the backend says so in freshness.note and puts the fetch time in
  // cycle_init. Label it for whichever source answered rather than making a
  // reader learn that a cycle can be zero hours old.
  const live = data.source === 'open_meteo';

  return (
    <div id="met" className="space-y-3">
      {/* `sub` comes from the payload, not a literal: this panel now draws
          whichever of the two met sources answered, and the live one is not
          the partner's file. */}
      <SectionHead
        title="Meteorology Source"
        sub={MET_SOURCE[data.source] ?? `Meteorology source: ${data.source}`}
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
              {/* The backend's note is written for whoever maintains the
                  pipeline - "re-run the partner fetcher and commit a fresh
                  cycle" - and this is a public read-only terminal. The status
                  word and its plain-English meaning above are what a reader
                  here can act on; the operator instruction stays in
                  /api/v1/status where the operator will look. */}
            </div>
          </div>

          <div className="flex gap-6">
            <div>
              <Label>{live ? 'Fetched' : 'Cycle Age'}</Label>
              <div className="font-mono text-2xl font-bold text-term-ink">
                {f.cycle_age_hours == null ? '—' : `${f.cycle_age_hours.toFixed(0)}h`}
              </div>
              <div className="font-mono text-[10px] text-term-outline">
                {live ? '' : 'init '}{istDay(f.cycle_init)} IST
              </div>
            </div>
            <div>
              <Label>{live ? 'Covers' : 'Window Left'}</Label>
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

        {/* What the weather is doing, not how many rows describe it.
            This panel used to print the payload's field table - "657 rows",
            "U_WIND_MS", "BOUNDARY_LAYER_HEIGHT_M 561 rows" - which answers a
            question only the person who wrote the fetcher is asking. A row
            count is a coverage check; it belongs in one line at the bottom,
            not in the four largest numbers on the card. */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-term-outline-variant/40 pt-3 sm:grid-cols-4">
          {met.cards.map((c) => (
            <div key={c.label}>
              <Label className="block">{c.label}</Label>
              <span className="font-mono text-xl font-bold text-term-ink">{c.value}</span>
              <span className="block font-mono text-[10px] leading-tight text-term-outline">
                {c.detail}
              </span>
            </div>
          ))}
        </div>

        {/* The coverage the field table used to carry, in a sentence, plus the
            one count that legitimately differs and why - a reader seeing
            561 against 657 with no explanation has been handed a discrepancy
            and no way to resolve it. */}
        {met.coverage && (
          <p className="mt-3 border-t border-term-outline-variant/40 pt-2 font-mono text-[10px] leading-relaxed text-term-outline">
            {met.coverage}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-term-outline-variant/40 pt-2">
          <Label>
            {/* Said outright, because a met panel next to a forecast implies a
                dependency that does not exist here. */}
            Read-only side channel · feeds no forecast, so the scored RMSE is unaffected
          </Label>
          {/* The GFS cycle id, which is how you would look the run up
              afterwards. A live fetch has none, so nothing is drawn rather
              than an em dash standing in for a field that does not apply. */}
          {data.cycles.length > 0 && <Label>{data.cycles[data.cycles.length - 1]}</Label>}
        </div>
      </TelemetryCard>
    </div>
  );
}
