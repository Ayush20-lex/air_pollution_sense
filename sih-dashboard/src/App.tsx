/**
 * AirSense NCR — application shell.
 *
 * Folds the Next.js `app/layout.tsx` + `app/providers.tsx` + `app/page.tsx`
 * trio into a single Vite entry. The provider stack and the intro/dashboard
 * swap are carried over unchanged; only the framework seams differ:
 *   - `next/font/google` → a stylesheet link in index.html, with the
 *     --font-sans / --font-mono variables declared in index.css
 *   - `next/dynamic`     → the React.lazy shim in @/lib/dynamic
 *   - `export const metadata` → static <head> tags in index.html
 */
import * as React from 'react';
import { AnimatePresence } from 'framer-motion';
import { MotionConfig } from 'framer-motion';
import { ThemeProvider } from 'next-themes';
import dynamic from '@/lib/dynamic';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import { IntroScreen } from '@/components/intro/IntroScreen';

// The dashboard pulls in Leaflet + Recharts; keep it out of the intro bundle.
// The fallback covers the chunk fetch so the scan transition never lands on a
// blank frame.
const Dashboard = dynamic(
  () => import('@/components/dashboard/Dashboard').then((m) => m.Dashboard),
  { ssr: false, loading: () => <BootSplash /> },
);

function BootSplash() {
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-base">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-hairline border-t-accent" />
        <span className="font-mono text-2xs uppercase tracking-[0.28em] text-accent">
          Initialising d03 domain
        </span>
      </div>
    </div>
  );
}

function Page() {
  const screen = useAppStore((s) => s.screen);

  // The intro is a scroll track, so the page must scroll while it is up; the
  // dashboard is a fixed-height console, so it locks scrolling again.
  const isIntro = screen !== 'dashboard';

  // Entering the console from halfway down the intro track would otherwise
  // leave the window scrolled once the page height collapses.
  React.useEffect(() => {
    if (!isIntro) window.scrollTo(0, 0);
  }, [isIntro]);

  return (
    <main
      className={
        isIntro
          ? 'relative w-full bg-base'
          : 'relative h-dvh w-full overflow-hidden bg-base'
      }
    >
      <AnimatePresence mode="wait">
        {screen !== 'dashboard' ? <IntroScreen key="intro" /> : <Dashboard key="dashboard" />}
      </AnimatePresence>
    </main>
  );
}

export default function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {/* reducedMotion="user" makes every framer animation honour the OS setting */}
      <MotionConfig reducedMotion="user">
        {/* gate 17: hover waits ~800ms, keyboard focus opens instantly (Radix default) */}
        <TooltipProvider delayDuration={800} skipDelayDuration={300}>
          <Page />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
