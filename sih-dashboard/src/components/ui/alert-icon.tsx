import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { AlertLevel } from '@/lib/aqi';

/**
 * Severity glyph for an alert level.
 *
 * Pairs with ALERT_COLOR in lib/aqi: both map an AlertLevel onto its visual
 * treatment. The choice lived inline in StatusPills and ParticleProbe, which
 * meant adding a level would have had to be remembered in two places.
 */
export function AlertIcon({
  level,
  className = 'size-3',
}: {
  level: AlertLevel;
  className?: string;
}) {
  const Glyph = level === 'EMERGENCY' ? ShieldAlert : AlertTriangle;
  return <Glyph className={className} />;
}
