/**
 * Why four of the eight cards above are blank.
 *
 * The grid draws a card for every pollutant the CPCB National AQI indexes, and
 * half of them read "not reported" with nothing to explain it. The obvious
 * reading is that the sensors are down. They are not, and the backend has
 * always carried the real answer in `pollutants_excluded` - three paragraphs
 * of method that no page had ever shown.
 *
 * Three states, kept apart because they mean different things: indexed,
 * withheld with a stated reason, and never published at all.
 */
import * as React from 'react';
import { Ban, Check, Minus } from 'lucide-react';
import { Label, SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import {
  CHANNEL_STANDARD,
  CHANNEL_WINDOW_HOURS,
  FEED_WINDOW_HOURS,
  channelStates,
} from '@/lib/terminal/channels';
import { isLive, useMesh } from '@/lib/terminal/useMesh';
import type { LiveStation } from '@/lib/terminal/meshApi';
import { cn } from '@/lib/utils';

const TONE = {
  indexed: {
    icon: Check,
    label: 'Indexed',
    box: 'border-term-primary/40 bg-term-primary/5',
    ink: 'text-term-primary',
  },
  withheld: {
    icon: Ban,
    label: 'Withheld',
    box: 'border-amber-500/40 bg-amber-500/5',
    ink: 'text-amber-600 dark:text-amber-400',
  },
  absent: {
    icon: Minus,
    label: 'Not published',
    box: 'border-term-outline-variant/60 bg-term-surface-low',
    ink: 'text-term-ink-variant',
  },
} as const;

export function ChannelStatus() {
  const mesh = useMesh();
  const stations = React.useMemo(
    () => mesh.stations.filter(isLive) as LiveStation[],
    [mesh.stations],
  );
  const states = React.useMemo(
    () => channelStates(stations, mesh.excluded),
    [stations, mesh.excluded],
  );

  const indexed = states.filter((s) => s.kind === 'indexed');
  const withheld = states.filter((s) => s.kind === 'withheld');
  const absent = states.filter((s) => s.kind === 'absent');

  return (
    <div className="space-y-3">
      <SectionHead
        title="Why Four Channels Are Blank"
        sub="The index covers eight pollutants. Three are withheld on method, two are never published, and the difference matters"
        right={
          <span className="font-mono text-xs uppercase tracking-wider text-term-ink-variant">
            {indexed.length} indexed · {withheld.length} withheld · {absent.length} absent
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Indexed and absent are short facts and share a card; withheld is an
            argument and gets one each. */}
        <TelemetryCard className="space-y-3 p-5">
          <Label className="block text-term-ink">In the index</Label>
          <div className="flex flex-wrap gap-1.5">
            {indexed.map((s) => {
              const T = TONE.indexed;
              return (
                <span
                  key={s.key}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold',
                    T.box,
                    T.ink,
                  )}
                >
                  <T.icon className="size-3" />
                  {s.key}
                  <span className="font-normal opacity-70">
                    {CHANNEL_WINDOW_HOURS[s.key]}h
                  </span>
                </span>
              );
            })}
          </div>
          <p className="font-body text-[11px] leading-relaxed text-term-ink-variant">
            CPCB needs three pollutants with a particulate among them before a station can
            carry an index at all. These are the ones this feed supplies under the window
            CPCB specifies — 24 hours, or the worst rolling 8 for ozone.
          </p>

          <div className="border-t border-term-outline-variant/40 pt-3">
            <Label className="block text-term-ink">Never published</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {absent.map((s) => {
                const T = TONE.absent;
                return (
                  <span
                    key={s.key}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold',
                      T.box,
                      T.ink,
                    )}
                  >
                    <T.icon className="size-3" />
                    {s.key}
                  </span>
                );
              })}
            </div>
            <p className="mt-1.5 font-body text-[11px] leading-relaxed text-term-ink-variant">
              In CPCB&rsquo;s table and in no feed this system reads. Their cards are empty
              because there is nothing to put in them, which is not the same as a channel
              being refused.
            </p>
          </div>
        </TelemetryCard>

        {withheld.map((s) =>
          s.kind === 'withheld' ? (
            /* flex column so the arithmetic block below sits on the card's
               floor rather than leaving a pool of empty card under it: these
               cards are stretched by the taller one beside them, and a short
               refusal left most of that height blank. */
            <TelemetryCard key={s.key} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-bold text-term-ink">{s.key}</span>
                <span
                  className={cn(
                    'flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold',
                    TONE.withheld.box,
                    TONE.withheld.ink,
                  )}
                >
                  <Ban className="size-3" />
                  Withheld
                </span>
              </div>
              {/* The backend's own words. Paraphrasing a methodological refusal
                  is how it turns back into a vague apology. */}
              <p className="font-body text-xs leading-relaxed text-term-ink-variant">
                {s.reason}
              </p>
              <Mismatch channel={s.key} />
            </TelemetryCard>
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * The arithmetic behind the refusal, for one withheld channel.
 *
 * The sentence above says the windows do not match. This is the mismatch, in
 * numbers a reader can check against CPCB's table: the window each side
 * averages over, and the concentration that indexes as 100.
 *
 * Why a window mismatch is not a rounding error. A one-hour sub-index is
 * anchored to a one-hour limit and a 24-hour sub-index to a 24-hour one, and
 * for the same air the shorter window sees peaks the longer one averages
 * away - NO2 above a road at 09:00 is not the day that road had. Feeding one
 * into the other's scale does not lose precision, it changes what is being
 * measured, and the result would still print as a tidy integer.
 */
function Mismatch({ channel }: { channel: string }) {
  const cpcb = CHANNEL_WINDOW_HOURS[channel];
  const feed = FEED_WINDOW_HOURS[channel];
  const std = CHANNEL_STANDARD[channel];
  if (!cpcb || !std) return null;
  return (
    <div className="mt-auto space-y-2 border-t border-term-outline-variant/40 pt-3">
      {/* The second box only exists where the windows actually differ. CO's
          refusal is about the unit the archive carries, not the window, and
          printing a matching 8h in amber beside it would invent a second
          fault. */}
      <div className={cn('grid gap-2', feed ? 'grid-cols-2' : 'grid-cols-1')}>
        <div className="rounded-lg border border-term-outline-variant/60 bg-term-surface-low p-2">
          <Label className="block">CPCB window</Label>
          <span className="font-display text-base font-extrabold tabular-nums text-term-ink">
            {cpcb}
            <span className="font-mono text-[10px] font-normal">
              {feed != null ? ' h' : ' h — both sides agree'}
            </span>
          </span>
        </div>
        {feed != null && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
            <Label className="block">Feed window</Label>
            <span className="font-display text-base font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
              {feed}
              <span className="font-mono text-[10px] font-normal"> h</span>
            </span>
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] text-term-ink-variant">
        <span>National standard, index 100</span>
        <span className="font-semibold text-term-ink">
          {std.value} {std.unit.replace('ug/m3', 'µg/m³').replace('mg/m3', 'mg/m³')}
        </span>
      </div>
      <p className="font-body text-[10px] leading-relaxed text-term-ink-variant">
        {feed
          ? `A ${feed}-hour sub-index is anchored to a ${feed}-hour limit. Read onto CPCB's ${cpcb}-hour scale it would keep the peaks a ${cpcb}-hour mean averages out, and still print as a tidy integer.`
          : `The window matches; what does not is the unit the archive carries it in, and a wrong unit is invisible once it becomes an index.`}
      </p>
    </div>
  );
}
