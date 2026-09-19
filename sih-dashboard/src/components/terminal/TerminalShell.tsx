import * as React from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  ChevronDown,
  Clock,
  LineChart,
  MapPin,
  Map as MapIcon,
  RefreshCw,
  Radio,
  ScatterChart,
  Search,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';
import { CERTIFICATIONS, HUB, LOCATIONS } from '@/lib/terminal/content';
import { STATIONS } from '@/lib/terminal/stations';
import { useHubStation, useMesh, useStationOptions } from '@/lib/terminal/useMesh';
import { TerminalEnter } from './TerminalEnter';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/store/useTerminalStore';
import { CommandPalette, openCommandPalette } from '@/components/ui/command-palette';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { toast } from 'sonner';

/**
 * Sidebar + header + footer chrome shared by every terminal page.
 *
 * `/` is the intro scroll track and this is the terminal it hands off to, so
 * the two keep separate chrome. There was a third surface, the fixed-height
 * console at /console, whose Dashboard shell this deliberately did not reuse;
 * it has since been removed.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
};

const NAV: NavItem[] = [
  { href: '/terminal', label: 'Live Telemetry', icon: <Radio className="size-4" /> },
  { href: '/terminal/geo-map', label: 'Geo Map', icon: <MapIcon className="size-4" /> },
  { href: '/terminal#analytics', label: 'Temporal Trends', icon: <LineChart className="size-4" /> },
  { href: '/terminal#matrices', label: 'Pollutant Matrices', icon: <ScatterChart className="size-4" /> },
  { href: '/terminal#alerts', label: 'Incident Warnings', icon: <AlertTriangle className="size-4 text-amber-400" />, badge: '3 PENDING' },
  { href: '/terminal#ledger', label: 'Spectrometry Ledger', icon: <Table2 className="size-4" /> },
];

export function TerminalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="terminal-root min-h-dvh font-body antialiased">
      <TerminalSidebar />
      <div className="flex min-h-dvh w-full flex-col md:pl-64">
        <TerminalHeader />
        <main className="w-full flex-1 px-5 py-6 lg:px-8">
          <TerminalEnter>
            <div className="space-y-6">{children}</div>
          </TerminalEnter>
        </main>
        <TerminalFooter />
      </div>
    </div>
  );
}

function TerminalSidebar() {
  const pathname = useLocation().pathname;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden h-full w-64 flex-col justify-between border-r border-term-outline-variant/60 bg-term-surface-lowest p-4 shadow-2xl md:flex">
      <div className="space-y-6">
        {/* Back to the landing track. Sits above the brand rather than beside
            it: the terminal is a destination reached from the intro, so the
            way out belongs at the top of the rail, not folded into the
            identity block. */}
        <Link
          to="/"
          className="group -mb-2 flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-term-ink-variant transition-colors hover:bg-term-surface-high hover:text-term-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60"
        >
          <ArrowLeft className="size-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
          Back
        </Link>

        {/* brand */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="relative flex size-10 items-center justify-center rounded-xl border border-term-primary/40 bg-term-surface-high text-term-primary shadow-[0_0_20px_rgba(78,222,163,0.3)]">
            <Radio className="size-5" />
            <span className="absolute -right-1 -top-1 flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-term-primary opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-term-primary" />
            </span>
          </div>
          <div className="overflow-hidden">
            <div className="font-display text-lg font-bold leading-tight tracking-tight text-term-ink">
              AIR AQI Sense
            </div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-term-primary">
              Public Station #04
            </div>
          </div>
        </div>

        {/* navigation */}
        <nav className="space-y-1">
          {NAV.map((item) => {
            // Hash links share the overview route; only the bare paths own an
            // active state, so exactly one item lights up.
            const isHash = item.href.includes('#');
            const active = !isHash && pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-l-2 border-term-primary bg-term-surface-high font-semibold text-term-primary shadow-sm'
                    : 'text-term-ink-variant hover:bg-term-surface-c hover:text-term-ink',
                )}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="rounded border border-amber-500/40 bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="pt-2">
          {/* Was "Calibrate Mesh Array", which did nothing — there is no array to
              calibrate and no calibration to run. Renamed to what a control in
              this position can honestly do: put the map's layers, field,
              playback and selection back to their defaults, which is otherwise
              eight separate clicks. */}
          <ResetViewButton />
        </div>
      </div>

      {/* diagnostics */}
      <div className="space-y-3 border-t border-term-outline-variant/60 pt-4">
        <div className="space-y-2 rounded-xl border border-term-outline-variant/60 bg-term-surface-low p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-term-ink-variant">
              Open Telemetry Mesh
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-term-primary">
              <span className="pulse-live size-2 rounded-full bg-term-primary" />
              {HUB.uptime}
            </span>
          </div>
          <div className="flex justify-between font-mono text-xs text-term-ink">
            <span>{HUB.name}</span>
            <span className="font-semibold text-term-secondary">{HUB.ping} ping</span>
          </div>
          <div className="flex justify-between border-t border-term-outline-variant/40 pt-1.5 font-mono text-[10px] text-term-ink-variant">
            <span>Data source</span>
            <span className="font-semibold text-term-primary">SYNTHETIC</span>
          </div>
        </div>
        <div className="rounded-lg border border-term-outline-variant/30 bg-term-surface-c/40 p-2 text-center font-mono text-[11px] text-term-ink-variant">
          PUBLIC ACCESS TERMINAL • READ-ONLY
        </div>
      </div>
    </aside>
  );
}

function TerminalHeader() {
  const options = useStationOptions();
  const select = useTerminalStore((st) => st.select);
  // The hub, not the stored id. They differ whenever the stored selection is
  // not in the current feed - the curated master is the default and the CPCB
  // bulletin does not carry it - and the picker has to name the station the
  // page is actually describing, or the two disagree in plain sight.
  const { station: hub } = useHubStation();
  const mesh = useMesh();
  // A printable key pressed on the focused search control opens the palette
  // carrying that character, so type-ahead doesn't lose its first keystroke.
  const handleTypeAhead = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    openCommandPalette(e.key);
  }, []);

  // "/" opens search from anywhere, matching the hint the control carries.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    // flex-wrap below md only. At 375 the content box is 335px and the six
    // controls need 668 between them, so they cannot share a row however hard
    // they shrink; the header grows a second row rather than hiding any of
    // them. From md up the back link drops out and the rail takes over that
    // job, so one row fits — nowrap there, and the row shrinks instead.
    <header className="sticky top-0 z-40 flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-term-outline-variant/60 bg-term-surface-lowest/90 px-5 py-3 backdrop-blur-xl md:flex-nowrap lg:px-8">
      {/* min-w-0 so this column can shrink past its content's min-content
          width; without it the search never gives ground and the row spills
          past the viewport instead. */}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {/* The sidebar carrying the other Back control is hidden below md, so
            without this a phone has no way out of the terminal. */}
        <Link
          to="/"
          aria-label="Back to overview"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-term-outline bg-term-surface-high text-term-ink-variant transition-colors hover:border-term-primary/50 hover:text-term-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60 md:hidden"
        >
          <ArrowLeft className="size-4" />
        </Link>

        {/* Trigger suppressed: the header carries one search control, and it is
            the field below. */}
        <CommandPalette hideTrigger />

        {/* The width floor waits for lg, not md. md is where the sidebar rail
            appears and takes 264px, so the header has LESS room at 768 than at
            767, not more — a 310px floor there drove this straight through the
            provenance pill. Below lg it shrinks and truncates instead. */}
        <div className="relative min-w-0 lg:min-w-[310px]">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-term-primary" />
          {/* The real mesh, not a list of four names. This was a decorative
              select: four hard-coded strings and no onChange, so picking one
              did nothing. It now drives the same selection the map uses, so
              choosing here moves the hero, the pollutant grid and the map
              together instead of each holding its own idea of "the station". */}
          <select
            aria-label="Monitoring location"
            value={options.some((o) => o.id === hub.id) ? hub.id : ''}
            onChange={(e) => select(e.target.value)}
            className="w-full cursor-pointer appearance-none rounded-lg border border-term-outline bg-term-surface-high py-2 pl-9 pr-9 text-sm font-semibold text-term-ink shadow-inner focus:border-term-primary focus:outline-none"
          >
            {options.length === 0 ? (
              <option value="">{LOCATIONS[0]}</option>
            ) : null}
            {/* Shown when the stored selection is not in the current feed -
                a refresh can retire a station, and a select with no matching
                option silently displays its first entry instead, which would
                name one station while the page described another. */}
            {options.length > 0 && !options.some((o) => o.id === hub.id) ? (
              <option value="">Select a station…</option>
            ) : null}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} · AQI {o.aqi}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-term-ink-variant" />
        </div>

        {/* The header's single search control. It looks like a field but is a
            button, because the results live in the palette: a plain input here
            would show the user nothing on this route, its only consumer being
            the mesh ranking on the geo map. Typing a character opens the
            palette carrying it, so the control still accepts type-ahead. */}
        {/* Grows into whatever the header has spare, up to a cap, rather than
            taking a fixed width: a fixed one can't yield to the right-hand
            cluster and pushes the refresh control off-screen around 1440.

            The cap rises with the breakpoint because a flat one leaves a hole:
            at 1560 the row had 630px of room and the field took 512 of it, so
            134px sat empty between the field and the provenance pill — read as
            a gap rather than as breathing room, since nothing sits in it. Above
            1700 the IST clock claims that space instead and the field yields to
            it on its own, min-w-0 doing the work. */}
        <div className="hidden min-w-0 max-w-md flex-1 lg:block xl:max-w-xl 2xl:max-w-3xl">
          <button
            type="button"
            onClick={() => openCommandPalette()}
            onKeyDown={handleTypeAhead}
            aria-label="Search stations and screens"
            className="flex w-full items-center gap-2.5 rounded-lg border border-term-outline-variant/80 bg-term-surface-c py-2 pl-3.5 pr-2.5 text-left font-body text-sm text-term-ink-variant transition-colors hover:border-term-secondary/60 hover:text-term-ink focus-visible:border-term-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-secondary"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1 truncate">Find station, zone or coordinates</span>
            <kbd className="shrink-0 rounded bg-term-surface-highest px-1.5 py-0.5 font-mono text-[11px] text-term-ink-variant">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Carries search wherever the field cannot fit — on a phone, where the
            nav rail is hidden too and this is the only way to the geo map, the
            console and the 26 stations, and on a tablet, where the rail is
            visible but leaves the header too little width for the field. */}
        <button
          type="button"
          onClick={() => openCommandPalette()}
          aria-label="Search stations and screens"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-term-outline bg-term-surface-high text-term-ink-variant transition-colors hover:border-term-primary/50 hover:text-term-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60 lg:hidden"
        >
          <Search className="size-4" />
        </button>
      </div>

      {/* Takes its own row below md. Every item here has to survive the
          phone: the pill is the badge that says these readings are synthetic,
          and it is the first thing a reader should not have to go looking
          for. w-full forces the wrap rather than leaving it to chance. */}
      <div className="flex w-full shrink-0 items-center justify-end gap-3 md:w-auto">
        {/* Sheds its second word below xl, where the rail has already taken
            264px and every pixel this keeps comes off the search field. It
            sheds it visually only: sr-only leaves the full phrase in the
            accessibility tree at every width, because "Demo" alone is a
            weaker claim than "Demo / Synthetic" and this badge is the one
            place the page admits the readings are not measured.

            Derived, not asserted. It read DEMO permanently, which was true
            while the mesh was hand-written and stopped being true when the
            node ledger and plume map started carrying real CPCB measurements -
            a page showing measured severe air while calling itself synthetic
            invites a reader to discount figures that are real.

            The claim is scoped rather than blanket: LIVE / MEASURED names the
            mesh, and the title says which panels it covers, because the rest of
            this route still renders lib/terminal/content.ts. Offline it returns
            to DEMO / SYNTHETIC, which is then the honest reading - the station
            list falls back to a frozen snapshot of the same archive, real but
            no longer current. */}
        <div
          title={
            mesh.live
              ? `Node ledger and plume map are measured from CPCB stations (${mesh.index}), ${mesh.feed === 'waqi_live' ? 'reporting live' : 'replayed from the archive'}. Other panels on this route are demo content.`
              : 'Backend unreachable. The mesh is a frozen snapshot of the archive and other panels are demo content.'
          }
          className="flex shrink-0 items-center gap-2 rounded-full border border-term-primary/40 bg-term-primary/10 px-3 py-1.5 shadow-[0_0_15px_rgba(78,222,163,0.15)]"
        >
          <span
            className={cn(
              'size-2.5 rounded-full',
              mesh.live ? 'bg-term-primary' : 'bg-amber-400',
            )}
          />
          <span className="font-mono text-xs font-bold uppercase tracking-wide text-term-primary">
            {mesh.live ? (
              <>
                Live<span className="sr-only xl:not-sr-only"> / Measured</span>
              </>
            ) : (
              <>
                Demo<span className="sr-only xl:not-sr-only"> / Synthetic</span>
              </>
            )}
          </span>
        </div>
        <ThemeToggle />
        <LiveClock />
        <Link
          to="/terminal#alerts"
          title="Active alerts"
          className="relative flex size-9 items-center justify-center rounded-lg border border-term-outline bg-term-surface-c text-term-ink-variant transition-all hover:bg-term-surface-high hover:text-term-ink"
        >
          <Bell className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-2.5 animate-pulse rounded-full bg-amber-400 ring-2 ring-term-surface-c" />
        </Link>
        <RefreshButton />
      </div>
    </header>
  );
}

/** IST wall clock. Rendered as a placeholder on the server so the markup the
 *  client hydrates onto always matches. */
function LiveClock() {
  const [stamp, setStamp] = React.useState('—');

  React.useEffect(() => {
    const tick = () => {
      const now = new Date();
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).formatToParts(now);
        const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
        setStamp(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} IST`);
      } catch {
        // Environments without full ICU fall back to a fixed +5:30 offset.
        const ist = new Date(now.getTime() + 5.5 * 3600_000);
        const pad = (n: number) => String(n).padStart(2, '0');
        setStamp(
          `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ` +
            `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())} IST`,
        );
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    // At 209px this is the widest thing in the header and the only one that
    // isn't a control, so it yields to the search until there is room for
    // both. 1700 rather than 2xl: at 1536 it would come back while the search
    // is still growing, shrinking it again on the way up.
    <div className="hidden items-center gap-2 rounded-lg border border-term-outline-variant/60 bg-term-surface-low px-3 py-1.5 font-mono text-xs text-term-ink-variant min-[1700px]:flex">
      <Clock className="size-4 text-term-secondary" />
      <span suppressHydrationWarning className="font-semibold tracking-tight text-term-ink">
        {stamp}
      </span>
    </div>
  );
}

/**
 * Re-anchors the mesh on the current wall clock.
 *
 * This used to spin for 800ms and do nothing — the README called it theatre.
 * It now bumps refreshedAt, which rebuilds the 24-frame window in GeoMapView
 * against `new Date()`, so the readings genuinely advance as the demo runs.
 * The spinner is kept, but it now covers real work instead of standing in for
 * it, and the toast reports what actually happened.
 */
function RefreshButton() {
  const [spinning, setSpinning] = React.useState(false);
  const refresh = useTerminalStore((s) => s.refresh);

  React.useEffect(() => {
    if (!spinning) return;
    const id = setTimeout(() => setSpinning(false), 800);
    return () => clearTimeout(id);
  }, [spinning]);

  const onRefresh = () => {
    setSpinning(true);
    refresh();

    // The toast names the hour the window is anchored to, which is what makes
    // the action checkable. buildFrames buckets by hour, so two refreshes
    // inside the same hour correctly produce identical readings — without the
    // anchor stated, that stability is indistinguishable from a dead button.
    const hour = String(new Date().getHours()).padStart(2, '0');
    toast.success('Mesh re-sampled', {
      id: 'mesh-refresh',
      description: `${STATIONS.length} nodes anchored on ${hour}:00 IST. Readings are hourly, so they hold within the hour.`,
    });
  };

  return (
    <button
      type="button"
      title="Re-sample the mesh on the current hour"
      aria-label="Re-sample the mesh"
      onClick={onRefresh}
      className="group flex size-9 items-center justify-center rounded-lg border border-term-outline bg-term-surface-c text-term-primary transition-colors hover:bg-term-surface-high"
    >
      <RefreshCw
        className={cn(
          'size-4 transition-transform duration-500',
          spinning ? 'animate-spin' : 'group-hover:rotate-180',
        )}
      />
    </button>
  );
}

function ResetViewButton() {
  const resetView = useTerminalStore((s) => s.resetView);

  return (
    <button
      type="button"
      onClick={() => {
        resetView();
        toast('Mesh view reset', {
          id: 'mesh-reset',
          description: 'Layers, field, playback and selection restored to defaults.',
        });
      }}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-term-outline-variant/70 bg-term-surface-high px-3 py-2 font-mono text-xs uppercase tracking-wider text-term-ink-variant transition-all hover:border-term-primary/50 hover:bg-term-surface-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60"
    >
      <SlidersHorizontal className="size-3.5 text-term-primary" />
      Reset Mesh View
    </button>
  );
}

function TerminalFooter() {
  return (
    <footer className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-term-outline-variant/60 bg-term-surface-lowest px-6 py-4 font-body text-xs text-term-ink-variant sm:flex-row lg:px-8">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-term-primary shadow-[0_0_8px_rgba(78,222,163,0.7)]" />
        <span className="font-medium text-term-ink">
          AIR AQI Sense Mission-Critical Environmental Telemetry System • Public Open Station Terminal
        </span>
      </div>
      <div className="flex items-center gap-4 font-mono text-xs text-term-ink-variant">
        {CERTIFICATIONS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
    </footer>
  );
}
