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
 * Routes:
 *   /                  the intro scroll track; Scan NCR hands off to /terminal
 *   /terminal          public terminal, Live Telemetry
 *   /terminal/geo-map  public terminal, geospatial plume map
 *
 * /console — the engineering console, and the Next route tree's third surface
 * — was removed. Anything still pointing at it falls through to the catch-all
 * and lands on the intro rather than a blank screen.
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
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import dynamic from '@/lib/dynamic';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAppStore } from '@/store/useAppStore';
import { IntroScreen } from '@/components/intro/IntroScreen';
import { ForecastStatus } from '@/components/ui/forecast-status';

// Each of these pulls a heavy chunk — Leaflet, Recharts, Three — so they stay
// out of the landing bundle. The fallback covers the chunk fetch so the scan
// hand-off never lands on a blank frame.
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
const TerminalForecast = dynamic(
  () => import('@/components/terminal/TerminalForecast').then((m) => m.default),
  { ssr: false },
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

/**
 * Landing track: the aerosol particle field and its scroll choreography.
 *
 * "Scan NCR" plays the disperse animation behind the hand-off curtain, then
 * opens the public terminal.
 */
/**
 * True once the landing page has been mounted in this page load.
 *
 * Module-level rather than state, because the distinction it has to draw is
 * exactly the one a module-level `let` draws for free: it survives client-side
 * navigation and resets on a real page load. So walking from the landing page
 * into the terminal keeps it true, and opening /terminal/geo-map cold - a
 * bookmark, a shared link, a refresh - finds it false.
 */
let cameThroughLanding = false;

/**
 * Sends a cold deep link back to the landing page.
 *
 * The terminal is the second half of a single piece: the landing page is what
 * says which city this is, where the numbers come from and how current they
 * are, and the terminal assumes a reader who has been told. Someone handed
 * /terminal/geo-map arrives at a map of unexplained colours instead.
 *
 * `replace` so the redirect leaves no history entry - otherwise Back from the
 * landing page would return to the deep link and bounce again.
 */
function RequireLanding({ children }: { children: React.ReactNode }) {
  if (!cameThroughLanding) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function IntroRoute() {
  const navigate = useNavigate();
  const screen = useAppStore((s) => s.screen);
  const returnToIntro = useAppStore((s) => s.returnToIntro);
  const loadLiveForecast = useAppStore((s) => s.loadLiveForecast);
  const navigated = React.useRef(false);

  // Seen the landing page; the terminal routes may now be entered. In an
  // effect, not in the render body: React may render a component without
  // committing it, and a flag set on a render that never mounted would open
  // the terminal to a reader who was never shown the landing page. The effect
  // runs before the one below that navigates, so the ordering holds.
  React.useEffect(() => {
    cameThroughLanding = true;
  }, []);

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

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ className: 'font-mono text-xs' }}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={true}
      disableTransitionOnChange
    >
      {/* reducedMotion="user" makes every framer animation honour the OS setting */}
      <MotionConfig reducedMotion="user">
        {/* gate 17: hover waits ~800ms, keyboard focus opens instantly (Radix default) */}
        <TooltipProvider delayDuration={800} skipDelayDuration={300}>
          {/* Mounted here, at the root, and never inside a route or a motion.*
              subtree. Sonner's toaster is position: fixed, and a transformed
              ancestor becomes its containing block and traps its z-index — the
              same thing that put the command palette under the telemetry
              panels. framer writes a transform on the intro's header.

              Sonner's `theme` defaults to 'light' and does not follow the OS,
              so it has to be handed the resolved theme or toasts render
              white-on-white on the dark surfaces. */}
          <ThemedToaster />
          <ForecastStatus />

          <BrowserRouter>
            <Routes>
              <Route path="/" element={<IntroRoute />} />
              <Route
                path="/terminal"
                element={
                  <RequireLanding>
                    <TerminalLayout />
                  </RequireLanding>
                }
              >
                <Route index element={<TerminalOverview />} />
                <Route path="geo-map" element={<TerminalGeoMap />} />
                <Route path="forecast" element={<TerminalForecast />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
