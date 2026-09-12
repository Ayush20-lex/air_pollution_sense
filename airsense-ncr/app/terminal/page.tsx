import { OverviewHero } from '@/components/terminal/overview/OverviewHero';
import { OverviewMetrics } from '@/components/terminal/overview/OverviewMetrics';
import { OverviewAnalytics } from '@/components/terminal/overview/OverviewAnalytics';
import { OverviewMesh } from '@/components/terminal/overview/OverviewMesh';

/** Live Telemetry — the terminal's overview screen. */
export default function TerminalOverviewPage() {
  return (
    <>
      <OverviewHero />
      <OverviewMetrics />
      <OverviewAnalytics />
      <OverviewMesh />
    </>
  );
}
