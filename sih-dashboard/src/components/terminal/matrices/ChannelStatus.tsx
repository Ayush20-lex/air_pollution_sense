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
import { channelStates, CHANNEL_WINDOW_HOURS } from '@/lib/terminal/channels';
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
            <TelemetryCard key={s.key} className="space-y-2 p-5">
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
            </TelemetryCard>
          ) : null,
        )}
      </div>
    </div>
  );
}
