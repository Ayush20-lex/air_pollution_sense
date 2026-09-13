/**
 * AirSense NCR — application shell.
 *
 * Folds the Next.js `app/layout.tsx` + `app/providers.tsx` + the route tree
 * into a single Vite entry. The provider stack is carried over unchanged; only
 * the framework seams differ:
 *   - `next/font/google` → a stylesheet link in index.html, with the
 *     --font-sans / --font-mono / --font-display / --font-body variables
 *     declared in index.css
 *   - `next/dynamic`     → the React.lazy shim in @/lib/dynamic
 *   - `export const metadata` → static <head> tags in index.html
 *   - the app-router file tree → the react-router routes below
 *
 * Routes mirror the Next app one-for-one:
 *   /                  the intro scroll track; Scan NCR hands off to /terminal
 *   /console           the engineering console (Leaflet + Recharts + Three)
 *   /terminal          public terminal, Live Telemetry
 *   /terminal/geo-map  public terminal, geospatial plume map
 */
import * as React from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { ThemeProvider } from 'next-themes';
import dynamic from '@/lib/dynamic';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import { IntroScreen } from '@/components/intro/IntroScreen';

// Each of these pulls a heavy chunk — Leaflet, Recharts, Three — so they stay
// out of the landing bundle. The fallback covers the chunk fetch so the scan
// hand-off never lands on a blank frame.
const Dashboard = dynamic(
  () => import('@/components/dashboard/Dashboard').then((m) => m.Dashboard),
  { ssr: false, loading: () => <BootSplash /> },
);

const TerminalLayout = dynamic(() => import('@/components/terminal/TerminalLayout').then((m) => m.default), {
  ssr: false,
  loading: () => <BootSplash />,
});

const TerminalOverview = dynamic(() => import('@/components/terminal/TerminalOverview').then((m) => m.default), {
  ssr: false,
});

const TerminalGeoMap = dynamic(() => import('@/components/terminal/TerminalGeoMap').then((m) => m.default), {
  ssr: false,
});

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

/**
 * Landing track: the aerosol particle field and its scroll choreography.
 *
 * "Scan NCR" plays the disperse animation behind the hand-off curtain, then
 * opens the public terminal. The console keeps its own route at /console.
 */
function IntroRoute() {
  const navigate = useNavigate();
  const screen = useAppStore((s) => s.screen);
  const returnToIntro = useAppStore((s) => s.returnToIntro);
  const loadLiveForecast = useAppStore((s) => s.loadLiveForecast);
  const navigated = React.useRef(false);

  // Pull the backend forecast once on mount. It replaces the synthetic frames
  // if it arrives; if the backend is down the UI carries on with them, so there
  // is no loading gate in front of the intro.
  React.useEffect(() => {
    void loadLiveForecast();
  }, [loadLiveForecast]);

  React.useEffect(() => {
    if (screen !== 'dashboard' || navigated.current) return;
    navigated.current = true;
    navigate('/terminal');
  }, [screen, navigate]);

  // Reset the screen machine on the way out, not during the navigation.
  // Resetting immediately re-rendered the intro mid-transition — the button
  // snapped back to "Scan NCR" and the particle field stopped dispersing.
  React.useEffect(() => () => returnToIntro(), [returnToIntro]);

  // The intro is a scroll track, so the page must scroll while it is up.
  return (
    <main className="relative w-full bg-base">
      <IntroScreen />
    </main>
  );
}

/** Engineering console — the forecast cockpit with the intervention levers. */
function ConsoleRoute() {
  const loadLiveForecast = useAppStore((s) => s.loadLiveForecast);

  React.useEffect(() => {
    void loadLiveForecast();
  }, [loadLiveForecast]);

  // Entering the console would otherwise inherit the intro track's scroll
  // position once the page height collapses to a fixed console.
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base">
      <Dashboard />
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
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<IntroRoute />} />
              <Route path="/console" element={<ConsoleRoute />} />
              <Route path="/terminal" element={<TerminalLayout />}>
                <Route index element={<TerminalOverview />} />
                <Route path="geo-map" element={<TerminalGeoMap />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
