import { useAppStore } from '@/store/useAppStore';

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
 */

export type ProvenanceTone = 'good' | 'pending' | 'bad';

export type Provenance = {
  /** Full claim, for wide layouts. */
  label: string;
  /** First word, for narrow layouts. The full label stays in the a11y tree. */
  short: string;
  /** Hover text: what the label means and where the number came from. */
  detail: string;
  tone: ProvenanceTone;
};

export function useProvenance(): Provenance {
  const source = useAppStore((s) => s.source);
  const liveStatus = useAppStore((s) => s.liveStatus);

  if (liveStatus === 'idle' || liveStatus === 'loading') {
    return {
      label: 'Connecting',
      short: 'Connecting',
      detail: 'Fetching the forecast from the backend.',
      tone: 'pending',
    };
  }

  // Offline, or answered with nothing usable: lib/data.ts is driving.
  if (liveStatus === 'offline' || !source) {
    return {
      label: 'Demo / Synthetic',
      short: 'Demo',
      detail:
        'Backend unreachable — these readings are modelled by the built-in ' +
        'generator, not measured.',
      tone: 'bad',
    };
  }

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
