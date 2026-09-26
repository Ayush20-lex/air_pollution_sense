/**
 * The upwind corridor: what is burning, and whether it is coming here.
 *
 * This section exists because of a specific failure. The forecast burns every
 * VIIRS pixel NASA reports over Punjab and Haryana, but the only fire figure
 * that ever reached the browser was one FRP-weighted centroid - so the map
 * drew the smoke as a single ribbon from a single point, and a reader would
 * reasonably conclude the system thought all of it came from one field.
 *
 * Two windows are offered and the switch is not a demo toggle.
 *
 * Live follows the forecast run. For most of the year it is nearly empty, and
 * the panels say so rather than dressing a quiet corridor as an emergency.
 *
 * The episode is 3-5 November 2025, requested from the same NASA product
 * through the same code path, with the wind the archive recorded for those
 * hours. It is a measurement of a real event, not a simulation of one, and it
 * is labelled as past everywhere it appears - which is the only honest way to
 * show what this system does at full load in a month when nothing is burning.
 */
import * as React from 'react';
import dynamic from '@/lib/dynamic';
import { SectionHead, TelemetryCard } from '@/components/terminal/TerminalPrimitives';
import { ArrivalStrip } from './ArrivalStrip';
import { FireHotspots } from './FireHotspots';
import {
  EPISODE_WINDOW,
  LIVE_WINDOW,
  setFireWindow,
  useFires,
  type FireWindow,
} from '@/lib/terminal/useFires';
import { cn } from '@/lib/utils';

const CorridorMap = dynamic(() => import('./CorridorMap').then((m) => m.CorridorMap), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center font-mono text-xs text-term-outline">
      Loading corridor…
    </div>
  ),
});

const WINDOWS: FireWindow[] = [LIVE_WINDOW, EPISODE_WINDOW];

export function FireCorridorSection() {
  const { data, status, window: active } = useFires();
  const host = React.useRef<HTMLDivElement>(null);
  // The second Leaflet instance is the most expensive thing on this route, and
  // most readers never reach this far down the page. It is built when it comes
  // into view and not before.
  const [near, setNear] = React.useState(false);

  React.useEffect(() => {
    const el = host.current;
    if (!el || near) return;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const episode = active.kind === 'episode';

  return (
    <div id="corridor" ref={host} className="space-y-3">
      <SectionHead
        title="Upwind Fire Corridor"
        sub="Every thermal anomaly NASA FIRMS reports between Delhi and the Punjab belt, and what the measured flow does with it"
        right={
          <div className="flex items-center gap-1 rounded-lg border border-term-outline-variant/60 bg-term-surface-low p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.kind}
                type="button"
                onClick={() => setFireWindow(w)}
                aria-pressed={active.kind === w.kind}
                className={cn(
                  'rounded-md px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors',
                  active.kind === w.kind
                    ? 'bg-term-surface-high text-term-primary'
                    : 'text-term-ink-variant hover:text-term-ink',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {episode && (
        /* Said at the top, not in a footnote: everything below this line
           describes November 2025, and a reader who scrolled into the middle
           of it must not mistake it for this afternoon. */
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          PAST EPISODE · 3&ndash;5 November 2025. Real VIIRS detections and the wind the
          archive recorded for those hours, fetched through the same endpoint as the live
          window. These are not current conditions.
        </div>
      )}

      {status === 'loading' && !data && (
        <TelemetryCard className="flex h-40 items-center justify-center p-6">
          <span className="font-mono text-xs text-term-outline">Fetching fire detections…</span>
        </TelemetryCard>
      )}

      {status === 'offline' && !data && (
        <TelemetryCard className="p-5">
          <p className="font-body text-xs leading-relaxed text-term-ink-variant">
            The fire service did not answer. Nothing is drawn rather than a guess at what is
            burning; the rest of this page is unaffected.
          </p>
        </TelemetryCard>
      )}

      {data && data.available === false && (
        <TelemetryCard className="p-5">
          <p className="font-body text-xs leading-relaxed text-term-ink-variant">
            {data.reason ?? 'Fire detections are unavailable.'}
          </p>
        </TelemetryCard>
      )}

      {data && data.available && (
        <>
          <ArrivalStrip data={data} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <TelemetryCard className="overflow-hidden p-0 lg:col-span-8">
              <div className="term-map relative h-[clamp(320px,52vh,560px)]">
                {near ? (
                  <CorridorMap data={data} />
                ) : (
                  <div className="flex size-full items-center justify-center font-mono text-xs text-term-outline">
                    Corridor map loads when scrolled into view
                  </div>
                )}
                <div className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-md border border-term-outline-variant/60 bg-term-surface-lowest/85 px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-term-ink-variant backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    <span className="inline-block size-2 rounded-full" style={{ background: '#F2552C' }} />
                    VIIRS detection · size by radiative power
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3 bg-[color:var(--t-secondary)]" />
                    Gaussian plume envelope, &sigma; 45 km — the forecast&rsquo;s own kernel
                  </div>
                </div>
              </div>
            </TelemetryCard>
            <div className="lg:col-span-4">
              <FireHotspots data={data} />
            </div>
          </div>
          {/* The one thing this map is asked for and cannot do, said plainly. */}
          <p className="font-body text-[10px] leading-relaxed text-term-ink-variant">
            No concentration field is drawn over the corridor. This system has no receptor
            grid and no wind field north of the NCR domain, so a shaded plume there would be
            drawn rather than measured. What is shown is the transport geometry the forecast
            itself uses, and the detections that feed it.
          </p>
        </>
      )}
    </div>
  );
}
