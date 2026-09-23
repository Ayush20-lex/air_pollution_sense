/**
 * Incident Warnings — the advisory list, and the three panels it is derived
 * from.
 *
 * The preview on Live Telemetry carries the first two warnings and none of
 * those panels. GRAP, the inversion scoring and the meteorology source are
 * each one indivisible statement, so they belong where there is room to make
 * them rather than half-made beside a link.
 */
import { IncidentBanners } from './overview/OverviewMesh';

export default function TerminalWarnings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-term-ink lg:text-3xl">
          Incident Warnings
        </h1>
        <p className="mt-1 font-body text-sm text-term-ink-variant">
          What is in force, what is about to trap, and how much of the mesh is reporting
        </p>
      </div>
      <IncidentBanners />
    </div>
  );
}
