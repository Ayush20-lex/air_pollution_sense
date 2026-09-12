'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

/**
 * Engineering console — the forecast cockpit with the intervention levers.
 *
 * It used to be reached by the intro's scan hand-off; that now opens the
 * public terminal, so the console keeps its own route. It pulls in Leaflet,
 * Recharts and Three, so it stays out of the landing bundle.
 */
const Dashboard = dynamic(
  () => import('@/components/dashboard/Dashboard').then((m) => m.Dashboard),
  { ssr: false, loading: () => <BootSplash /> },
);

export default function ConsolePage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base">
      <Dashboard />
    </main>
  );
}

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
