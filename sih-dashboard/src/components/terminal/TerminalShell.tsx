import * as React from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle,
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
import { TerminalEnter } from './TerminalEnter';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/store/useTerminalStore';

/**
 * Sidebar + header + footer chrome shared by every terminal page.
 *
 * The console at `/` is a fixed-height cockpit; this surface is a scrolling
 * public terminal, so it keeps its own shell rather than reusing Dashboard's.
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
            <div className="font-display text-lg font-bold leading-tight tracking-tight text-white">
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
                    : 'text-slate-400 hover:bg-term-surface-c hover:text-white',
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
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-term-outline-variant/70 bg-term-surface-high px-3 py-2 font-mono text-xs uppercase tracking-wider text-slate-200 transition-all hover:border-term-primary/50 hover:bg-term-surface-highest"
          >
            <SlidersHorizontal className="size-3.5 text-term-primary" />
            Calibrate Mesh Array
          </button>
        </div>
      </div>

      {/* diagnostics */}
      <div className="space-y-3 border-t border-term-outline-variant/60 pt-4">
        <div className="space-y-2 rounded-xl border border-term-outline-variant/60 bg-term-surface-low p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Open Telemetry Mesh
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-term-primary">
              <span className="pulse-live size-2 rounded-full bg-term-primary" />
              {HUB.uptime}
            </span>
          </div>
          <div className="flex justify-between font-mono text-xs text-white">
            <span>{HUB.name}</span>
            <span className="font-semibold text-term-secondary">{HUB.ping} ping</span>
          </div>
          <div className="flex justify-between border-t border-term-outline-variant/40 pt-1.5 font-mono text-[10px] text-slate-400">
            <span>ISO/IEC 17025 CERT</span>
            <span className="font-semibold text-term-primary">VERIFIED</span>
          </div>
        </div>
        <div className="rounded-lg border border-term-outline-variant/30 bg-term-surface-c/40 p-2 text-center font-mono text-[11px] text-slate-400">
          PUBLIC ACCESS TERMINAL • READ-ONLY
        </div>
      </div>
    </aside>
  );
}

function TerminalHeader() {
  const query = useTerminalStore((s) => s.query);
  const setQuery = useTerminalStore((s) => s.setQuery);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // "/" focuses search, matching the hint rendered in the field.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sticky top-0 z-40 flex w-full items-center justify-between gap-4 border-b border-term-outline-variant/60 bg-term-surface-lowest/90 px-5 py-3 backdrop-blur-xl lg:px-8">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative min-w-[260px] sm:min-w-[310px]">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-term-primary" />
          <select
            aria-label="Monitoring location"
            defaultValue={LOCATIONS[0]}
            className="w-full cursor-pointer appearance-none rounded-lg border border-term-outline bg-term-surface-high py-2 pl-9 pr-9 text-sm font-semibold text-white shadow-inner focus:border-term-primary focus:outline-none"
          >
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        </div>

        <div className="relative hidden w-72 xl:block">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find station, zone or coordinates"
            className="w-full rounded-lg border border-term-outline-variant/80 bg-term-surface-c py-1.5 pl-9 pr-10 font-body text-xs text-white outline-none placeholder:text-slate-400 focus:border-term-secondary focus:ring-1 focus:ring-term-secondary"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-term-surface-highest px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
            /
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3">
        <div className="flex items-center gap-2 rounded-full border border-term-primary/40 bg-term-primary/10 px-3 py-1.5 shadow-[0_0_15px_rgba(78,222,163,0.15)]">
          <span className="pulse-live size-2.5 rounded-full bg-term-primary" />
          <span className="font-mono text-xs font-bold uppercase tracking-wide text-term-primary">
            Live Monitoring
          </span>
        </div>
        <LiveClock />
        <Link
          to="/terminal#alerts"
          title="Active alerts"
          className="relative flex size-9 items-center justify-center rounded-lg border border-term-outline bg-term-surface-c text-slate-200 transition-all hover:bg-term-surface-high hover:text-white"
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
    <div className="hidden items-center gap-2 rounded-lg border border-term-outline-variant/60 bg-term-surface-low px-3 py-1.5 font-mono text-xs text-slate-200 sm:flex">
      <Clock className="size-4 text-term-secondary" />
      <span suppressHydrationWarning className="font-semibold tracking-tight text-white">
        {stamp}
      </span>
    </div>
  );
}

function RefreshButton() {
  const [spinning, setSpinning] = React.useState(false);

  React.useEffect(() => {
    if (!spinning) return;
    const id = setTimeout(() => setSpinning(false), 800);
    return () => clearTimeout(id);
  }, [spinning]);

  return (
    <button
      type="button"
      title="Refresh live data"
      aria-label="Refresh live data"
      onClick={() => setSpinning(true)}
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

function TerminalFooter() {
  return (
    <footer className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-term-outline-variant/60 bg-term-surface-lowest px-6 py-4 font-body text-xs text-slate-400 sm:flex-row lg:px-8">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-term-primary shadow-[0_0_8px_rgba(78,222,163,0.7)]" />
        <span className="font-medium text-slate-300">
          AIR AQI Sense Mission-Critical Environmental Telemetry System • Public Open Station Terminal
        </span>
      </div>
      <div className="flex items-center gap-4 font-mono text-xs text-slate-400">
        {CERTIFICATIONS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
    </footer>
  );
}
