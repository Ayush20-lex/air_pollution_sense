
import * as React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Satellite, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SourceBadge } from '@/components/ui/source-badge';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { CommandPalette } from '@/components/ui/command-palette';
import { Hint } from '@/components/ui/tooltip';
import { POLLUTANTS, type Pollutant } from '@/lib/data';
import { SEVERITY } from '@/lib/tokens';
import { cn, formatLST } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';

export function Header() {
  const pollutant = useAppStore((s) => s.pollutant);
  const setPollutant = useAppStore((s) => s.setPollutant);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);
  const returnToIntro = useAppStore((s) => s.returnToIntro);

  const [clock, setClock] = React.useState('--:--:--');
  React.useEffect(() => {
    const tick = () => setClock(formatLST(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="z-30 flex shrink-0 flex-col gap-2 border-b border-hairline/70 bg-surface/60 px-3 py-2 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between lg:gap-4">
      {/* --- identity ------------------------------------------------- */}
      <div className="flex items-center gap-3">
        <Hint label="Back to intro">
          <button
            onClick={returnToIntro}
            className="group flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-elevated/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <span className="relative flex size-8 items-center justify-center rounded-lg border border-accent/40 bg-accent/10">
              <Satellite className="size-4 text-accent" />
              <ChevronLeft className="absolute -left-1 size-3 -translate-x-2 text-accent opacity-0 transition-[transform,opacity] group-hover:translate-x-0 group-hover:opacity-100" />
            </span>
            <span className="text-left leading-tight">
              <span className="block font-mono text-xs font-bold tracking-[0.2em] text-ink">
                AIRSENSE <span className="text-accent">/ NCR</span>
              </span>
            </span>
          </button>
        </Hint>

        <Badge className="hidden lg:inline-flex">Coupled Forecasting System V4.2</Badge>
      </div>

      {/* --- variable tabs -------------------------------------------- */}
      <nav
        role="tablist"
        aria-label="Forecast variable"
        className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto rounded-lg border border-hairline/70 bg-elevated/50 p-1 lg:mx-0"
      >
        {POLLUTANTS.map((p) => (
          <TabButton key={p} value={p} active={pollutant === p} onSelect={setPollutant} />
        ))}
      </nav>

      {/* --- status cluster -------------------------------------------- */}
      <div className="flex items-center gap-2">
        <SourceBadge className="hidden sm:inline-flex" />
        <div className="hidden items-center gap-1.5 rounded-md border border-hairline bg-elevated/60 px-2 py-1 md:flex">
          <span className="size-1.5 animate-pulse rounded-full bg-good" />
          <span className="font-mono text-2xs tabular-nums text-ink">{clock}</span>
          <span className="font-mono text-2xs text-faint">LST</span>
        </div>
        <Button size="sm" variant="default" onClick={() => setDrawerOpen(true)} className="gap-1.5">
          <SlidersHorizontal />
          <span className="hidden sm:inline">What-if</span>
        </Button>
        {/* Without this the console is a dead end: it is reachable from the
            palette but carries no link back to the terminal or the intro. */}
        <CommandPalette />
        <ThemeToggle />
      </div>
    </header>
  );
}

function TabButton({
  value,
  active,
  onSelect,
}: {
  value: Pollutant;
  active: boolean;
  onSelect: (p: Pollutant) => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={cn(
        'relative shrink-0 rounded-md px-3 py-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.16em] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        active ? 'text-base dark:text-base' : 'text-muted hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="tab-pill"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
          className="absolute inset-0 rounded-md bg-accent"
        />
      )}
      <span className={cn('relative', active && 'text-white dark:text-base')}>
        {value}
      </span>
    </button>
  );
}
