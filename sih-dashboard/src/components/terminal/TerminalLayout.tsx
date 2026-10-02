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
import { NAV, TerminalShell } from './TerminalShell';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import '@/terminal.css';

/**
 * Scrolls to the element named by the URL hash.
 *
 * The rail itself no longer needs this: all five of its items are routes now.
 * What still needs it are the deep links that arrive from outside the overview
 * and point at a section inside it — the landing page's warnings card and the
 * shell's advisory link both go to `/terminal#alerts`, and the overview carries
 * anchors for alerts, analytics, corridor, grap, grid, inversion, ledger and
 * map. react-router does not scroll to a hash on its own (Next's Link did),
 * so without this they would change the address bar and nothing else.
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
 *
 * Known broken, 2 Oct 2026. Neither path scrolls any more: landing on
 * `/terminal#alerts` cold, and clicking through to it from another route, both
 * leave the reader at the top of the overview. MAX_FRAMES gives up after about
 * half a second, and the overview now takes seconds to put `#alerts` in the
 * document, because the section waits on the live mesh. Raising the cap alone
 * trades one bug for another: a scroll that lands four seconds late yanks the
 * page out from under someone already reading it. The fix wants a condition as
 * well as a longer window, something like "only if the reader has not scrolled
 * yet", so it is left for a change of its own rather than widened into a copy
 * pass.
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

const BRAND = 'AirLytics - NCR';

/**
 * The tab, named for the section being read.
 *
 * Built from the rail's own NAV rather than a second list beside it: the two
 * would answer "what is this page called" differently the first time a route
 * was renamed, and the rail is the copy a reader has actually seen. A route
 * with no entry - a deep link that outlived its nav item - falls back to the
 * brand alone rather than to a stale label.
 */
function titleFor(pathname: string): string {
  // Longest match, so /terminal/geo-map is not claimed by /terminal.
  const item = [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return item ? `${BRAND} | ${item.label}` : BRAND;
}

export default function TerminalLayout() {
  useHashScroll();
  const { pathname } = useLocation();

  // Restore the console's title on the way out, so a back-navigation does not
  // leave the tab labelled with the terminal. Re-runs per route, so moving
  // between sections renames the tab with them.
  React.useEffect(() => {
    const previous = document.title;
    document.title = titleFor(pathname);
    return () => {
      document.title = previous;
    };
  }, [pathname]);

  return (
    <TerminalShell>
      <Outlet />
    </TerminalShell>
  );
}
