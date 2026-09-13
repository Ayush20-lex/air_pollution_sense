import * as React from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/store/useAppStore';

/**
 * Surfaces the one piece of state the UI used to hide.
 *
 * `loadLiveForecast` falls back to synthetic frames when the backend cannot be
 * reached, and says nothing. That is the right behaviour — a dead backend
 * should not blank the console — but it is indistinguishable from a healthy
 * demo, so a judge seeing "DEMO / SYNTHETIC" has no way to know whether the
 * forecast pipeline is down or simply not plugged in yet. This says which.
 *
 * Renders nothing; it exists to react to the transition.
 */

/** Stable ids so StrictMode's double-invoked effect updates rather than duplicates. */
const OFFLINE_ID = 'forecast-offline';
const LIVE_ID = 'forecast-live';

export function ForecastStatus() {
  const liveStatus = useAppStore((s) => s.liveStatus);
  const previous = React.useRef(liveStatus);

  React.useEffect(() => {
    const was = previous.current;
    previous.current = liveStatus;

    if (liveStatus === 'offline') {
      toast.warning('Backend unreachable', {
        id: OFFLINE_ID,
        description:
          'Showing the synthetic 72-hour forecast. Readings are modelled, not measured.',
        duration: 8000,
      });
      return;
    }

    // Only announce a live feed when it replaces a failure. On a healthy first
    // load the provenance badge already says so, and a toast for the expected
    // case is noise — the guidance is silent success.
    if (liveStatus === 'live' && was === 'offline') {
      toast.success('Backend reconnected', {
        id: LIVE_ID,
        description: 'Forecast now served by the coupled model.',
      });
    }
  }, [liveStatus]);

  return null;
}
