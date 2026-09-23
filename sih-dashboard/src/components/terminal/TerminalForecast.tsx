/**
 * AQI Trend & Forecast — where the terminal is read for time rather than for
 * this hour.
 *
 * Both panels used to sit on Live Telemetry, below the gauge, the pollutant
 * grid and the advisory. That page answers "what is the air doing now"; these
 * two answer "where has it been" and "where is it going", and a reader after
 * either had to scroll past everything that was not it. The nav's "Temporal
 * Trends" entry was a hash link into the middle of that page, which is what a
 * page wants to be when it is long enough to need one.
 *
 * Ordered forward-first. The forecast is the reason someone opens this, and
 * the archive behind it is the thing that says whether to believe it.
 */
import { ForecastPanel, TemporalTrend } from './overview/OverviewAnalytics';
import { SectionHead } from './TerminalPrimitives';

export default function TerminalForecast() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-term-ink lg:text-3xl">
          AQI Trend &amp; Forecast
        </h1>
        <p className="mt-1 font-body text-sm text-term-ink-variant">
          The next 72 hours from the coupled baseline, against the archive&rsquo;s own record of
          the days behind it
        </p>
      </div>

      {/* `id="analytics"` is kept: the nav used to point at it as a hash on the
          overview, and links handed out before this page existed still carry
          it. Landing at the top of the right page is the correct answer to
          those. */}
      <div id="analytics">
        <ForecastPanel />
      </div>

      <div className="space-y-3">
        <SectionHead
          title="Observed Trend"
          sub="Daily city AQI from the archive — measured, not modelled"
        />
        {/* Full width here. Beside the stressor donut it was eight of twelve
            columns, which is as much as the overview could spare it; with that
            row gone the card takes all twelve. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <TemporalTrend />
        </div>
      </div>
    </div>
  );
}
