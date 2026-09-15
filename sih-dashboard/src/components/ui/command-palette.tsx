import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  ArrowRight,
  Gauge,
  LayoutDashboard,
  MapPin,
  Moon,
  Radio,
  Search,
  Sun,
} from 'lucide-react';
import { STATIONS } from '@/lib/terminal/stations';
import { aqiColor } from '@/lib/aqi';
import { cn } from '@/lib/utils';

/**
 * ⌘K palette. Two jobs beyond the obvious one:
 *
 *  - the engineering console at /console had no link anywhere in the app, so
 *    the map, simulator, timeline and odometer were unreachable without typing
 *    the URL. This is its entry point.
 *  - the terminal's rail is `hidden md:flex`, so a phone had no navigation at
 *    all. The trigger button is visible at every width.
 *
 * Navigation goes through react-router rather than `window.location`: a full
 * reload would re-fetch the ~880 kB particle chunk on every jump.
 *
 * Colours are the --as-* tokens, which resolve on all three surfaces. The
 * terminal's term-* ramp is scoped to .terminal-root and would not.
 */

type Cmd = {
  id: string;
  title: string;
  hint?: string;
  group: 'Go to' | 'Stations' | 'Appearance';
  icon: React.ReactNode;
  run: () => void;
  /** Extra text matched against the query but not displayed. */
  keywords?: string;
  /** Severity dot, for stations. */
  dot?: string;
};

const RECENTS_KEY = 'airsense.palette.recents';
const MAX_RECENTS = 5;

function readRecents(): string[] {
  // Private windows and blocked site-data both throw here rather than
  // returning null, so the read has to be guarded, not just null-checked.
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeRecents(ids: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)));
  } catch {
    /* storage unavailable — recents degrade to session-only */
  }
}

/**
 * Lets any surface open the palette without prop-drilling or a context
 * provider. The terminal header folds its own search field and this palette
 * into a single control, so it needs a way in that isn't the built-in button.
 */
const OPEN_EVENT = 'airsense:command-palette-open';

/** `seed` pre-fills the query, so a control can hand over the keystroke that
 *  opened it instead of swallowing the user's first character. */
export function openCommandPalette(seed = '') {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: seed }));
}

export function CommandPalette({ hideTrigger = false }: { hideTrigger?: boolean } = {}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const [recents, setRecents] = React.useState<string[]>(readRecents);

  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  }, []);

  const go = React.useCallback(
    (to: string) => {
      navigate(to);
      close();
    },
    [navigate, close],
  );

  // Built once per navigate/theme identity rather than per render — the
  // original of this component rebuilt its item array on every keystroke,
  // which invalidated every memo hanging off it.
  const commands = React.useMemo<Cmd[]>(() => {
    const routes: Cmd[] = [
      {
        id: 'go-intro',
        title: 'Landing track',
        hint: 'Aerosol globe intro',
        group: 'Go to',
        icon: <Radio className="size-4" />,
        run: () => go('/'),
        keywords: 'home intro particles scan start',
      },
      {
        id: 'go-terminal',
        title: 'Live Telemetry',
        hint: 'Public terminal overview',
        group: 'Go to',
        icon: <Gauge className="size-4" />,
        run: () => go('/terminal'),
        keywords: 'terminal aqi pollutants overview public',
      },
      {
        id: 'go-geo',
        title: 'Geospatial Plume Map',
        hint: 'Dispersion, contours, wind',
        group: 'Go to',
        icon: <MapPin className="size-4" />,
        run: () => go('/terminal/geo-map'),
        keywords: 'map plume heatmap contours wind geo mesh',
      },
      {
        id: 'go-console',
        title: 'Engineering console',
        hint: 'Forecast, timeline, what-if levers',
        group: 'Go to',
        icon: <LayoutDashboard className="size-4" />,
        run: () => go('/console'),
        keywords: 'console dashboard forecast simulator intervention timeline',
      },
    ];

    const stations: Cmd[] = STATIONS.map((s) => ({
      id: `station-${s.id}`,
      title: s.name,
      hint: `${s.zone} · ${s.agency} · AQI ${s.aqi}`,
      group: 'Stations',
      icon: <MapPin className="size-4" />,
      dot: aqiColor(s.aqi),
      run: () => go(`/terminal/geo-map?station=${s.id}`),
      keywords: `${s.zone} ${s.agency} ${s.dominant} ${s.source}`,
    }));

    const appearance: Cmd[] = [
      {
        id: 'theme',
        title: resolvedTheme === 'dark' ? 'Switch to light' : 'Switch to dark',
        hint: 'Console and landing track only',
        group: 'Appearance',
        icon: resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          close();
        },
        keywords: 'theme dark light mode appearance',
      },
    ];

    return [...routes, ...stations, ...appearance];
  }, [go, resolvedTheme, setTheme, close]);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // No query: recents first, then everything, each shown once.
      const byId = new Map(commands.map((c) => [c.id, c]));
      const recent = recents.map((id) => byId.get(id)).filter((c): c is Cmd => !!c);
      const rest = commands.filter((c) => !recents.includes(c.id));
      return { recent, rest };
    }
    const hit = commands.filter((c) =>
      `${c.title} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(q),
    );
    return { recent: [] as Cmd[], rest: hit };
  }, [query, commands, recents]);

  const flat = React.useMemo(() => [...results.recent, ...results.rest], [results]);

  const exec = React.useCallback(
    (cmd: Cmd) => {
      const next = [cmd.id, ...recents.filter((id) => id !== cmd.id)].slice(0, MAX_RECENTS);
      setRecents(next);
      writeRecents(next);
      cmd.run();
    },
    [recents],
  );

  // ⌘K / Ctrl+K toggles from anywhere; the rest only while open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((i) => (flat.length ? (i + 1) % flat.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = flat[cursor];
        if (cmd) exec(cmd);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flat, cursor, exec, close]);

  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const seed = (e as CustomEvent<string>).detail;
      if (typeof seed === 'string' && seed) {
        setQuery(seed);
        setCursor(0);
      }
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the active row in view without smooth-scrolling: held arrow keys
  // outrun a smooth scroll and the list visibly lags behind the selection.
  React.useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  return (
    <>
      {hideTrigger ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open command palette"
          className="flex items-center gap-2 rounded-lg border border-hairline bg-elevated/60 px-2.5 py-1.5 font-mono text-2xs uppercase tracking-wider text-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded border border-hairline bg-base/60 px-1 py-px text-[10px] sm:inline">
            ⌘K
          </kbd>
        </button>
      )}

      {/* Portalled to <body> deliberately. The intro mounts this inside a
          motion.header, and framer writes a transform there for the entrance
          animation — which does two things to a fixed child: it positions it
          against the header instead of the viewport, and it traps it in the
          header's z-20 stacking context, so `z-[100]` only ever means "100
          within the header". The overlay rendered *under* the telemetry panels
          and the hero heading. A portal escapes both. */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <button
              aria-label="Close command palette"
              onClick={close}
              className="absolute inset-0 cursor-default bg-base/70 backdrop-blur-sm"
            />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-2xl"
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="flex items-center gap-2.5 border-b border-hairline px-4">
                <Search className="size-4 shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // Reset here rather than in an effect on `query`: the
                    // keystroke is what invalidates the selection, and doing it
                    // at the cause avoids a second render pass per character.
                    setCursor(0);
                  }}
                  placeholder="Search stations, screens…"
                  aria-label="Search commands"
                  className="h-12 w-full bg-transparent font-mono text-sm text-ink placeholder:text-faint focus:outline-none"
                />
                <kbd className="shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-faint">
                  Esc
                </kbd>
              </div>

              <div ref={listRef} className="max-h-[54vh] overflow-y-auto py-2 no-scrollbar">
                {flat.length === 0 ? (
                  <p className="px-4 py-10 text-center font-mono text-2xs uppercase tracking-widest text-faint">
                    Nothing matches “{query}”
                  </p>
                ) : (
                  <>
                    {results.recent.length > 0 && (
                      <Group label="Recent">
                        {results.recent.map((c, i) => (
                          <Row
                            key={c.id}
                            cmd={c}
                            active={cursor === i}
                            onHover={() => setCursor(i)}
                            onPick={() => exec(c)}
                          />
                        ))}
                      </Group>
                    )}
                    {(['Go to', 'Stations', 'Appearance'] as const).map((group) => {
                      const rows = results.rest.filter((c) => c.group === group);
                      if (!rows.length) return null;
                      return (
                        <Group key={group} label={group}>
                          {rows.map((c) => {
                            const i = flat.indexOf(c);
                            return (
                              <Row
                                key={c.id}
                                cmd={c}
                                active={cursor === i}
                                onHover={() => setCursor(i)}
                                onPick={() => exec(c)}
                              />
                            );
                          })}
                        </Group>
                      );
                    })}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-hairline px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                <span>{flat.length} result{flat.length === 1 ? '' : 's'}</span>
                <span className="flex items-center gap-3">
                  <span>↑↓ navigate</span>
                  <span>↵ open</span>
                </span>
              </div>
            </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  cmd,
  active,
  onHover,
  onPick,
}: {
  cmd: Cmd;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
        active ? 'bg-accent/12 text-ink' : 'text-muted hover:bg-elevated/60',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent' : 'text-faint')}>{cmd.icon}</span>
      {cmd.dot && (
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: cmd.dot }} />
      )}
      <span className="flex-1 truncate font-mono text-xs">{cmd.title}</span>
      {cmd.hint && (
        <span className="hidden truncate font-mono text-[10px] text-faint sm:block">{cmd.hint}</span>
      )}
      {active && <ArrowRight className="size-3 shrink-0 text-accent" />}
    </button>
  );
}
