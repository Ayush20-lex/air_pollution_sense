import * as React from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/store/useAppStore';
import { STALE_AFTER_MS } from '@/lib/useProvenance';

/**
 * Surfaces the one piece of state the UI used to hide, and keeps it true.
 *
 * `loadLiveForecast` falls back to synthetic frames when the backend cannot be
 * reached, and says nothing. That is the right behaviour — a dead backend
 * should not blank the console — but it is indistinguishable from a healthy
 * demo, so a judge seeing "DEMO / SYNTHETIC" has no way to know whether the
 * forecast pipeline is down or simply not plugged in yet. This says which.
 *
 * It also drives the refresh. The forecast was fetched once, on mount, and
 * never again: a console opened in the morning kept asserting a live feed all
 * day from a single morning fetch, and if the backend died in between nothing
 * noticed. Polling is what lets the provenance badge tell the truth later in
 * the day, not only at load.
 *
 * Renders nothing; it exists to react to the transition.
 */

/** Stable ids so StrictMode's double-invoked effect updates rather than duplicates. */
const OFFLINE_ID = 'forecast-offline';
const LIVE_ID = 'forecast-live';

/**
 * How often to re-confirm the forecast while the tab is visible.
 *
 * Comfortably under STALE_AFTER_MS so a healthy console never ages into amber
 * between polls, and hidden tabs are skipped — a backgrounded dashboard has no
 * badge for anyone to read, and Render's free instance only has so many hours
 * in it.
 */
const REFRESH_MS = 120_000;

export function ForecastStatus() {
  const liveStatus = useAppStore((s) => s.liveStatus);
  const source = useAppStore((s) => s.source);
  const lastFetchedAt = useAppStore((s) => s.lastFetchedAt);
  const loadLiveForecast = useAppStore((s) => s.loadLiveForecast);
  const previous = React.useRef(liveStatus);
  // Offline is announced once per outage, not once per failed poll.
  const announcedOffline = React.useRef(false);

  // --- keep the forecast current -------------------------------------------
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void loadLiveForecast();
    };
    // Covers a deep link straight to a route that never fetches, and recovers
    // a console that was left open while the backend was down.
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      // A tab restored after hours holds figures from before it was hidden;
      // re-confirm immediately rather than waiting out the interval.
      const stale =
        useAppStore.getState().lastFetchedAt == null ||
        Date.now() - (useAppStore.getState().lastFetchedAt ?? 0) >= STALE_AFTER_MS;
      if (document.visibilityState === 'visible' && stale) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadLiveForecast]);

  // --- announce the transitions --------------------------------------------
  React.useEffect(() => {
    const was = previous.current;
    previous.current = liveStatus;

    if (liveStatus === 'offline') {
      if (announcedOffline.current) return;
      announcedOffline.current = true;
      toast.warning('Backend unreachable', {
        id: OFFLINE_ID,
        // Which frames are on screen depends on whether a fetch ever landed.
        // Saying "synthetic" when real backend figures are still displayed
        // would discredit measurements that are genuine.
        description: source
          ? 'Showing the last forecast it sent. These figures are real but no longer current.'
          : 'Showing the synthetic 72-hour forecast. Readings are modelled, not measured.',
        duration: 8000,
      });
      return;
    }

    if (liveStatus === 'live') {
      const recovered = announcedOffline.current || was === 'offline';
      announcedOffline.current = false;
      // Only announce a live feed when it replaces a failure. On a healthy
      // first load the provenance badge already says so, and a toast for the
      // expected case is noise — the guidance is silent success.
      if (!recovered) return;
      toast.success('Backend reconnected', {
        id: LIVE_ID,
        // Derived, not asserted. This read "served by the coupled model" while
        // the backend was serving the blend baseline — no coupled model has
        // ever beaten it, so the toast was claiming a result that did not exist.
        description:
          source?.engine === 'coupled_model'
            ? 'Forecast now served by the coupled model.'
            : 'Forecast now served by the validated blend baseline.',
      });
    }
  }, [liveStatus, source, lastFetchedAt]);

  return null;
}
