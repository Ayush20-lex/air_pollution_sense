import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Gauge, MapPin } from 'lucide-react';
import { ScanButton } from './ScanButton';
import { ALERT_COLOR, aqiColor, bandForPm25 } from '@/lib/aqi';
import { FORECAST_HOURS, MODEL_META, type Frame } from '@/lib/data';
import { useMesh } from '@/lib/terminal/useMesh';
import { INCIDENTS, POLLUTANTS } from '@/lib/terminal/content';
import { cn } from '@/lib/utils';

/**
 * The closing panel of the intro track.
 *
 * It replaced a heading, one line of copy and a lone button sitting in an
 * 85svh box — 602px of empty space on a 1478px row, with the content filling
 * neither axis. The gap was the symptom; the cause was that the section had
 * nothing in it. Three destinations existed and only one of them was reachable
 * from here, with the other two hidden behind the command palette.
 *
 * Deliberately unequal tiles rather than three matching cards: a bento reads
 * as a considered layout, three equal boxes read as a template. The telemetry
 * tile is widest because it is where most visitors should land first.
 *
 * Every figure is real and pulled from the same source the destination uses —
 * the AQI is the live frame, the node count is STATIONS.length, the channel
 * count is POLLUTANTS.length. None of it is written down twice.
 *
 * All three tiles open the public terminal. They used to be three separate
 * surfaces, but the engineering console was removed, so what is left is one
 * destination entered at three different depths.
 */

/** Worst level in the feed, so the count is not painted calmer than it reads. */
const worstIncidentColor = INCIDENTS.some((i) => i.level === 'CRITICAL')
  ? ALERT_COLOR.EMERGENCY
  : ALERT_COLOR.WARNING;

const rise = (i: number) => ({
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: false, amount: 0.3, margin: '0px 0px -10% 0px' },
  transition: { duration: 0.6, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] as const },
});

function Tile({
  to,
  icon,
  eyebrow,
  title,
  body,
  stat,
  statLabel,
  statColor,
  index,
  className,
}: {
  to: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  stat: string;
  statLabel: string;
  statColor?: string;
  index: number;
  className?: string;
}) {
  return (
    <motion.div {...rise(index)} className={cn('min-w-0', className)}>
      <Link
        to={to}
        className={cn(
          'glass glass-hover group flex h-full flex-col justify-between gap-6 p-5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        )}
      >
        <div>
          <span className="panel-title">
            {icon}
            {eyebrow}
          </span>
          <h3 className="mt-3 font-mono text-base font-bold uppercase leading-tight tracking-[0.1em] text-ink [overflow-wrap:anywhere] sm:text-lg">
            {title}
          </h3>
          <p className="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-muted">{body}</p>
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-hairline/60 pt-3">
          <div className="min-w-0">
            <div className="hud-label">{statLabel}</div>
            <div
              className="font-mono text-2xl font-semibold tabular-nums tracking-tight"
              style={{ color: statColor ?? 'rgb(var(--as-ink))' }}
            >
              {stat}
            </div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-faint transition-[color,translate] duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
        </div>
      </Link>
    </motion.div>
  );
}

export function EntryGrid({
  frame,
  onScan,
  scanning,
}: {
  frame: Frame;
  onScan: () => void;
  scanning: boolean;
}) {
  const mesh = useMesh();
  const band = bandForPm25(frame.avgPm25);

  return (
    // Two rows of three on desktop, with the wide tiles at opposite corners so
    // the grid never resolves into even columns. Collapses to two up on
    // tablets and one on phones; every tile carries min-w-0 so a long word
    // cannot push a track wider than its share.
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        index={0}
        className="sm:col-span-2"
        to="/terminal"
        icon={<Gauge className="size-3" />}
        eyebrow="Public terminal"
        title="Live telemetry"
        body={`Composite AQI on the CPCB National scale, ${POLLUTANTS.length}-channel chemical grid with per-species trajectories, and the station mesh with its incident feed.`}
        stat={String(frame.avgAqi)}
        statLabel={`NCR mean · ${band.label}`}
        statColor={aqiColor(frame.avgPm25)}
      />

      <Tile
        index={1}
        to="/terminal/geo-map"
        icon={<MapPin className="size-3" />}
        eyebrow="Public terminal"
        title="Geospatial plume"
        body="Dispersion field, PM2.5 iso-contours, source-to-receptor ribbons and wind streamlines over the NCR basin."
        stat={String(mesh.stations.length)}
        statLabel="Mesh nodes"
      />

      <Tile
        index={2}
        to="/terminal#alerts"
        icon={<AlertTriangle className="size-3" />}
        eyebrow="Public terminal"
        title="Incident warnings"
        body="The advisory feed: plume fronts, inversion events and the corridor each one threatens, newest first."
        stat={String(INCIDENTS.length)}
        statLabel="Open incidents"
        statColor={worstIncidentColor}
      />

      {/* The CTA keeps its own tile so the scan hand-off stays the largest
          target in the row rather than becoming a fourth equal card. */}
      <motion.div {...rise(3)} className="glass flex min-w-0 flex-col justify-between gap-5 p-5 sm:col-span-2">
        <div>
          <span className="panel-title">Start here</span>
          <h3 className="mt-3 font-mono text-base font-bold uppercase leading-tight tracking-[0.1em] text-ink sm:text-lg">
            Open the <span className="text-accent">live terminal</span>
          </h3>
          <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted">
            {MODEL_META.model} on a {MODEL_META.resolution} grid, {MODEL_META.cycle} cycle,{' '}
            {FORECAST_HOURS}-hour horizon.
          </p>
        </div>
        <div>
          <ScanButton onScan={onScan} scanning={scanning} />
        </div>
      </motion.div>
    </div>
  );
}
