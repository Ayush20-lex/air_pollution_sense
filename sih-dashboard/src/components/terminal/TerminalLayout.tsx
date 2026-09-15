/**
 * Route layout for the public terminal.
 *
 * Folds the Next.js `app/terminal/layout.tsx` into a react-router layout
 * route. The framework seams are the only difference:
 *   - `next/font/google` (Plus Jakarta Sans + Inter) → the stylesheet link in
 *     index.html, bound to --font-display / --font-body in index.css
 *   - `export const metadata` → set on navigation, since a Vite SPA has one
 *     static <head>
 *   - `{children}` → <Outlet />
 *
 * terminal.css is imported here rather than in index.css so it ships with the
 * terminal chunk. Everything in it is scoped under `.terminal-root`, which
 * TerminalShell applies, so the intro keeps its own light/dark treatment.
 */
import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TerminalShell } from './TerminalShell';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import '@/terminal.css';

/**
 * Scrolls to the element named by the URL hash.
 *
 * Four of the rail's six items are hash links into the overview — Temporal
 * Trends, Pollutant Matrices, Incident Warnings, Spectrometry Ledger. Next's
 * Link scrolled to them on its own; react-router does not, so porting the
 * terminal silently turned two thirds of the navigation into buttons that
 * changed the address bar and nothing else.
 *
 * Two things make this more than a getElementById:
 *
 *   - the route is lazily loaded, so on a cold landing the target does not
 *     exist on the first frame. The lookup retries on animation frames rather
 *     than giving up, and stops after ~half a second so a genuinely bad hash
 *     does not spin forever.
 *   - the header is sticky, so scrolling the target to y=0 parks it underneath.
 *     Its height is measured rather than hardcoded — it changes with the
 *     viewport, and the search field inside it wraps at narrow widths.
 */
const MAX_FRAMES = 30;

function useHashScroll() {
  // `key` changes on every navigation, so clicking the active item scrolls
  // again rather than doing nothing because the hash string is unchanged.
  const { hash, key } = useLocation();
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let raf = 0;
    let frames = 0;

    const attempt = () => {
      const el = document.getElementById(id);
      if (el) {
        const header = document.querySelector('header');
        const offset = (header?.getBoundingClientRect().height ?? 0) + 12;
        window.scrollTo({
          top: el.getBoundingClientRect().top + window.scrollY - offset,
          behavior: reduced ? 'auto' : 'smooth',
        });
        return;
      }
      if (frames++ < MAX_FRAMES) raf = requestAnimationFrame(attempt);
    };

    attempt();
    return () => cancelAnimationFrame(raf);
  }, [hash, key, reduced]);
}

const TITLE = 'AIR AQI Sense — Public Open Environmental Intelligence Terminal';

export default function TerminalLayout() {
  useHashScroll();

  // Restore the console's title on the way out, so a back-navigation does not
  // leave the tab labelled with the terminal.
  React.useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <TerminalShell>
      <Outlet />
    </TerminalShell>
  );
}
