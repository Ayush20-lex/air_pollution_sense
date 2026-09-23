/**
 * Pollutant Matrices — all eight channels, at full size.
 *
 * Live Telemetry shows the first four as a preview. The grid was never the
 * problem there; the page under it was, at four screens of scrolling before a
 * reader reached anything else.
 */
import { PollutantMatrix } from './overview/OverviewMetrics';

export default function TerminalMatrices() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-term-ink lg:text-3xl">
          Pollutant Matrices
        </h1>
        <p className="mt-1 font-body text-sm text-term-ink-variant">
          Every channel the CPCB National AQI indexes, with the 24-hour window behind each
        </p>
      </div>
      <PollutantMatrix />
    </div>
  );
}
