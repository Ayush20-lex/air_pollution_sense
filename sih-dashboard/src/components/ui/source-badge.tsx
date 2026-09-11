import { Badge } from '@/components/ui/badge';
import { SEVERITY } from '@/lib/tokens';
import { useAppStore } from '@/store/useAppStore';

/**
 * States which engine produced the numbers on screen.
 *
 * The console previously hard-coded "Demo / Synthetic". It now reports what the
 * backend says it is serving, so the label cannot drift away from the truth:
 * the trained network, the scored blend baseline, or the synthetic generator
 * when the backend is unreachable.
 *
 * Badge takes no title prop, so the hover explanation sits on a wrapper rather
 * than changing a shared primitive.
 */
export function SourceBadge({ className = '' }: { className?: string }) {
  const source = useAppStore((s) => s.source);

  let tip: string;
  let badge: React.ReactNode;

  if (!source) {
    // No backend answer — the synthetic generator in lib/data.ts is driving.
    tip = 'Backend unreachable — showing the built-in synthetic forecast';
    badge = <Badge color={SEVERITY.moderate}>Demo / Synthetic</Badge>;
  } else if (source.engine === 'coupled_model') {
    tip = 'Trained coupled ConvLSTM';
    badge = <Badge color={SEVERITY.good} dot>Coupled model</Badge>;
  } else if (source.engine === 'blend_baseline') {
    const rmse = source.validated_rmse_ugm3;
    tip =
      `${source.method ?? 'blend baseline'}` +
      (rmse ? ` — validated RMSE ${rmse} µg/m³` : '') +
      (source.beats_raw_cams_by ? `, ${source.beats_raw_cams_by} better than raw CAMS` : '') +
      (source.mode === 'archive_replay' ? ' · archive replay, not a live feed' : '');
    badge = (
      <Badge color={SEVERITY.good} dot>
        Baseline · RMSE {rmse ?? '—'}
      </Badge>
    );
  } else {
    tip = 'Model weights not loaded — output is from random weights';
    badge = <Badge color={SEVERITY.bad}>Untrained</Badge>;
  }

  return (
    <span className={className} title={tip}>
      {badge}
    </span>
  );
}
