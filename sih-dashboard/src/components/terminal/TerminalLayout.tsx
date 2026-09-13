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
 * TerminalShell applies, so the console keeps its own light/dark treatment.
 */
import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { TerminalShell } from './TerminalShell';
import '@/terminal.css';

const TITLE = 'AIR AQI Sense — Public Open Environmental Intelligence Terminal';

export default function TerminalLayout() {
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
