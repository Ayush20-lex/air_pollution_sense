/** Live Telemetry — the terminal's overview screen. */
import { OverviewHero } from './overview/OverviewHero';
import { OverviewMetrics } from './overview/OverviewMetrics';
import { OverviewAnalytics } from './overview/OverviewAnalytics';
import { OverviewMesh } from './overview/OverviewMesh';

export default function TerminalOverview() {
  return (
    <>
      <OverviewHero />
      <OverviewMetrics />
      <OverviewAnalytics />
      <OverviewMesh />
    </>
  );
}
