'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { IntroScreen } from '@/components/intro/IntroScreen';

/**
 * Landing track: the aerosol particle field and its scroll choreography.
 *
 * "Scan NCR" plays the disperse animation behind the hand-off curtain, then
 * opens the public terminal at /terminal (Live Telemetry). The engineering
 * console keeps its own route at /console.
 */
export default function Page() {
  const router = useRouter();
  const screen = useAppStore((s) => s.screen);
  const returnToIntro = useAppStore((s) => s.returnToIntro);
  const pushed = React.useRef(false);

  // Warm the terminal chunk while the visitor is still reading the intro, so
  // the hand-off does not stall on a chunk fetch.
  React.useEffect(() => {
    router.prefetch('/terminal');
  }, [router]);

  React.useEffect(() => {
    if (screen !== 'dashboard' || pushed.current) return;
    pushed.current = true;
    router.push('/terminal');
  }, [screen, router]);

  // Reset the screen machine on the way out, not during the push. Resetting
  // immediately re-rendered the intro mid-navigation — the button snapped back
  // to "Scan NCR" and the particle field stopped dispersing for a frame.
  React.useEffect(() => () => returnToIntro(), [returnToIntro]);

  return (
    <main className="relative w-full bg-base">
      <IntroScreen />
    </main>
  );
}
