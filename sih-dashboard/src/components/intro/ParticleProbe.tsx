import { motion, AnimatePresence } from 'framer-motion';
import { Crosshair } from 'lucide-react';
import { ALERT_COLOR, bandForPm25, type AlertLevel } from '@/lib/aqi';
import { AlertIcon } from '@/components/ui/alert-icon';
import type { District, Frame } from '@/lib/data';
import { sectorForSlot } from './StatusPills';

export type Probe = {
  district: District;
  /** Cursor position within the stage, in px. */
  x: number;
  y: number;
};

/**
 * Readout that follows the cursor while a concentration band of the aerosol
 * cloud is hovered.
 *
 * The cloud is stratified by load — dense and red at the surface, thinning to
 * cool colours above the inversion — so the vertical position of the cursor
 * already names a concentration. This just puts the matching zone against it.
 */
export function ParticleProbe({ probe, frame }: { probe: Probe | null; frame: Frame }) {
  return (
    <AnimatePresence>
      {probe && (
        <motion.div
          key="probe"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          // Sits above the HUD but never eats the pointer, so the band under it
          // keeps reporting as the cursor moves.
          className="pointer-events-none absolute z-40 hidden md:block"
          style={{
            left: probe.x,
            top: probe.y,
            // Ride above-right of the cursor, flipping near the right edge.
            transform: 'translate(14px, -50%)',
          }}
        >
          <Card district={probe.district} frame={frame} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Card({ district, frame }: { district: District; frame: Frame }) {
  const s = frame.districts[district.id];
  const level: AlertLevel = s.alert;
  const color = ALERT_COLOR[level];
  const band = bandForPm25(s.pm25);

  const isInversionWarning =
    level === 'WARNING' && (s.inversion >= 0.55 || frame.inversionIndex >= 0.55);
  const displayLevel = isInversionWarning ? 'INVERSION WARNING' : level;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border px-3 py-2 backdrop-blur-xl"
      style={{
        borderColor: `${color}66`,
        background: 'rgb(var(--as-surface) / 0.86)',
        boxShadow: `0 0 0 1px ${color}33, 0 14px 34px -14px ${color}`,
      }}
    >
      <span className="flex items-center gap-1.5 font-sans text-xs font-medium text-muted">
        <Crosshair className="size-3 text-accent" />
        Station Reading
      </span>

      <span className="font-sans text-xs font-semibold text-ink">
        {sectorForSlot(district.id) ?? district.zone}
      </span>

      <span
        className="flex items-center gap-1 font-sans text-xs font-semibold"
        style={{ color }}
      >
        <AlertIcon level={level} />
        {displayLevel}
      </span>

      <div className="flex items-baseline gap-1.5 border-t border-hairline/60 pt-1.5 font-sans text-xs text-muted">
        <span>PM2.5</span>
        <span className="text-base font-semibold tabular-nums" style={{ color }}>
          {s.pm25.toFixed(0)}
        </span>
        <span>µg/m³ · {band.label}</span>
      </div>
    </div>
  );
}
