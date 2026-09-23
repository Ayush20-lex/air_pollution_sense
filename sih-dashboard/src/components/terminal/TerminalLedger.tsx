/**
 * Spectrometry Ledger — the full channel table.
 *
 * Nine columns need about 900px, so this is the page that can actually give it
 * them. The preview on Live Telemetry shows four rows.
 */
import { SpectrometryLedger } from './overview/OverviewMesh';

export default function TerminalLedger() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-term-ink lg:text-3xl">
          Spectrometry Ledger
        </h1>
        <p className="mt-1 font-body text-sm text-term-ink-variant">
          Reading, threshold, status and calibration for each indexed channel
        </p>
      </div>
      <SpectrometryLedger />
    </div>
  );
}
