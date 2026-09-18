import * as React from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { ForecastSource } from '@/lib/forecastApi';

/**
 * One answer to "where did these numbers come from", for every place that asks.
 *
 * The intro header and the terminal rail each hard-coded the string
 * "Demo / Synthetic". That was true when the console ran on the synthetic
 * generator and nothing else existed. It stopped being true once the backend
 * started serving the scored blend baseline, and neither badge noticed: the
 * hero screen announced SYNTHETIC over 330 ug/m3 that had come from 68 CPCB
 * stations by way of a forecast validated at 84.89 ug/m3.
 *
 * Understating is not the safe direction. A judge reads the badge before they
 * read anything else, and "synthetic" invites them to discount every number on
 * the page - including the ones that are real and measured.
 *
 * Both badges now derive from this, so the claim can only be wrong in one
 * place, and it moves when the backend does.
 *
 * Freshness is part of the claim
 * ------------------------------
 * "Baseline - RMSE 84.89" is present tense. It was being rendered from a fetch
 * that had happened once, on mount, however long ago that was: leave the
 * console open, let the backend sleep or die, and the badge went on asserting a
 * live feed over frames from hours earlier. Nothing in the UI aged.
 *
 * So the green state now has to be earned by two things at once - the last
 * attempt succeeded, and it was recent. Failing either drops the badge to
 * amber, which says the numbers are still real backend numbers but that we can
 * no longer vouch for them being current. It does not drop to "Demo /
 * Synthetic": the frames on screen genuinely did come from the backend, and
 * calling real measurements synthetic is the same error in the other
 * direction.
 */

export type ProvenanceTone = 'good' | 'pending' | 'stale' | 'bad';

export type Provenance = {
  /** Full claim, for wide layouts. */
  label: string;
  /** First word, for narrow layouts. The full label stays in the a11y tree. */
  short: string;
  /** Hover text: what the label means and where the number came from. */
  detail: string;
  tone: ProvenanceTone;
};

/**
 * How long a forecast may go unconfirmed before the badge stops calling it
 * live. Nothing re-fetches faster than `REFRESH_MS` in forecast-status.tsx, so
 * this has to be comfortably longer than that or a healthy console would flap
 * amber between polls. Two missed polls is the threshold.
 */
export const STALE_AFTER_MS = 5 * 60_000;

/** How often the badge re-reads the clock. Age is not state; see below. */
const TICK_MS = 30_000;

function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`;
}

/** The claim for a given engine, before freshness is taken into account. */
function describe(source: ForecastSource): Provenance {
  if (source.engine === 'blend_baseline') {
    const rmse = source.validated_rmse_ugm3;
    return {
      label: rmse ? `Baseline · RMSE ${rmse}` : 'Baseline',
      short: 'Baseline',
      detail:
        `${source.method ?? 'blend baseline'}` +
        (rmse ? ` — validated at ${rmse} µg/m³` : '') +
        (source.stations ? ` across ${source.stations} CPCB stations` : '') +
        (source.beats_raw_cams_by ? `, ${source.beats_raw_cams_by} better than raw CAMS` : '') +
        (source.mode === 'archive_replay'
          ? '. Replays the scored archive rather than a live feed.'
          : ''),
      tone: 'good',
    };
  }

  if (source.engine === 'coupled_model') {
    return {
      label: 'Coupled model',
      short: 'Model',
      detail: 'Served by the trained coupled ConvLSTM.',
      tone: 'good',
    };
  }

  // Weights present but never trained: the output is noise wearing a real shape.
  return {
    label: 'Untrained',
    short: 'Untrained',
    detail: 'Model weights are untrained — this output is not a forecast.',
    tone: 'bad',
  };
}

export function useProvenance(): Provenance {
  const source = useAppStore((s) => s.source);
  const liveStatus = useAppStore((s) => s.liveStatus);
  const lastFetchedAt = useAppStore((s) => s.lastFetchedAt);

  // Age is derived from the wall clock, which is not state, so nothing here
  // would re-render as it passes: the badge would render once when the
  // forecast landed and then hold that wording for the life of the tab. Making
  // the clock state is what lets a stale forecast actually look stale - and
  // keeps render pure, rather than reading Date.now() on the way past.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (lastFetchedAt == null) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  // Nothing from the backend has ever arrived.
  if (!source) {
    if (liveStatus === 'idle' || liveStatus === 'loading') {
      return {
        label: 'Connecting',
        short: 'Connecting',
        detail: 'Fetching the forecast from the backend.',
        tone: 'pending',
      };
    }
    return {
      label: 'Demo / Synthetic',
      short: 'Demo',
      detail:
        'Backend unreachable — these readings are modelled by the built-in ' +
        'generator, not measured.',
      tone: 'bad',
    };
  }

  // Past here, the frames on screen did come from the backend. The only
  // question left is whether we can still call them current.
  const base = describe(source);
  if (base.tone !== 'good') return base;

  // Clamped at zero, which also covers the moment a fetch lands: the clock was
  // last sampled up to TICK_MS ago, so `now` briefly trails `lastFetchedAt` and
  // a plain subtraction would go negative. Zero is the right reading there -
  // the forecast did just arrive - and the next tick catches the clock up.
  const ageMs = lastFetchedAt == null ? null : Math.max(now - lastFetchedAt, 0);
  const unconfirmed = liveStatus === 'offline';
  const aged = ageMs != null && ageMs >= STALE_AFTER_MS;
  if (!unconfirmed && !aged) return base;

  const age = ageMs == null ? null : formatAge(ageMs);
  return {
    ...base,
    label: unconfirmed
      ? `${base.short} · backend down`
      : `${base.short} · ${age} old`,
    detail:
      base.detail +
      (unconfirmed
        ? ' — the backend stopped answering, so these are the last figures it sent'
        : ' — not confirmed with the backend recently') +
      (age ? `. Last fetched ${age} ago.` : '.'),
    tone: 'stale',
  };
}
