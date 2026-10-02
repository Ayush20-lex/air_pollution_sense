import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Gauge, MapPin } from 'lucide-react';
import { ScanButton } from './ScanButton';
import { ALERT_COLOR, aqiColor, bandForPm25 } from '@/lib/aqi';
import { FORECAST_HOURS, MODEL_META, type Frame } from '@/lib/data';
import { useMesh } from '@/lib/terminal/useMesh';
import { useAppStore } from '@/store/useAppStore';
import { POLLUTANTS } from '@/lib/terminal/content';
import { useAdvisories } from '@/lib/terminal/advisories';
import { cn } from '@/lib/utils';

/**
 * Enterprise technical tiles:
 * Light mode: Pure white backgrounds (bg-white), crisp borders (border-slate-200), subtle shadows (shadow-sm),
 * dark text (text-slate-900) and medium gray sub-labels (text-slate-500).
 * Dark mode: Strictly preserved with dark:bg-slate-900/60, dark:border-slate-800, dark:text-white.
 */

function worstColor(items: { level: string }[]): string {
  if (items.some((i) => i.level === 'CRITICAL')) return ALERT_COLOR.EMERGENCY;
  if (items.some((i) => i.level === 'WARNING')) return ALERT_COLOR.WARNING;
  return ALERT_COLOR.ADVISORY;
}

const rise = (i: number) => ({
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15, margin: '0px 0px -8% 0px' },
  transition: { duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as const },
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
  const startScan = useAppStore((s) => s.startScan);

  const handoff = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    startScan(to);
  };

  return (
    <motion.div {...rise(index)} className={cn('min-w-0', className)}>
      <Link
        to={to}
        onClick={handoff}
        className={cn(
          'group flex h-full flex-col justify-between gap-6 rounded-md border border-slate-200 bg-white p-5 shadow-sm',
          'transition-all duration-200 hover:-translate-y-1 hover:border-slate-400 hover:shadow-md',
          'dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:-translate-y-1 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60',
        )}
      >
        <div>
          <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {icon}
            {eyebrow}
          </span>
          <h3 className="mt-2.5 font-sans text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 [overflow-wrap:anywhere] sm:text-lg">
            {title}
          </h3>
          <p className="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800/80">
          <div className="min-w-0">
            <div className="font-mono text-2xs tracking-wider text-slate-500 dark:text-slate-400">{statLabel}</div>
            <div
              className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-100"
              style={{ color: statColor ?? undefined }}
            >
              {stat}
            </div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-slate-400 transition-[color,translate] duration-150 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-cyan-600 dark:text-slate-500 dark:group-hover:text-cyan-400" />
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
  const source = useAppStore((st) => st.source);
  const { items: advisories } = useAdvisories();
  const band = bandForPm25(frame.avgPm25);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        index={0}
        to="/terminal"
        icon={<Gauge className="size-3 text-cyan-600 dark:text-cyan-400" />}
        eyebrow="PUBLIC TERMINAL"
        title="Live station telemetry"
        body={`Now: ${band.label}. ${mesh.stations.length} CAAQMS stations reporting ${POLLUTANTS.length} criteria channels across Delhi, Noida, Ghaziabad, Gurugram, and Faridabad.`}
        stat={frame.avgPm25.toFixed(1)}
        statLabel="NCR PM2.5 · µg/m³"
        statColor={aqiColor(frame.avgPm25)}
      />

      <Tile
        index={1}
        to="/terminal/geo-map"
        icon={<MapPin className="size-3 text-cyan-600 dark:text-cyan-400" />}
        eyebrow="PUBLIC TERMINAL"
        title="Geospatial pollution map"
        body="Dispersion field, PM2.5 iso-contours, source-to-receptor ribbons and wind streamlines over the NCR basin."
        stat={String(mesh.stations.length)}
        statLabel="MESH NODES"
      />

      <Tile
        index={2}
        to="/terminal#alerts"
        icon={<AlertTriangle className="size-3 text-amber-500 dark:text-amber-400" />}
        eyebrow="PUBLIC TERMINAL"
        title="Pollution & incident warnings"
        body="The advisory feed: the GRAP stage in force, the zones about to trap, and how much of the mesh is reporting."
        stat={String(advisories.length)}
        statLabel={advisories.length === 1 ? 'OPEN ADVISORY' : 'OPEN ADVISORIES'}
        statColor={worstColor(advisories)}
      />

      {/* The CTA keeps its own tile with pure white surface, 1px border, rounded-md */}
      <motion.div
        {...rise(3)}
        className="flex min-w-0 flex-col justify-between gap-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:col-span-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-cyan-950/30"
      >
        <div>
          <span className="font-mono text-2xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Start Here</span>
          <h3 className="mt-2.5 font-sans text-base font-semibold tracking-tight text-slate-900 sm:text-lg dark:text-slate-100">
            Open <span className="text-cyan-600 dark:text-cyan-400 font-semibold">Live Terminal</span>
          </h3>
          <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {FORECAST_HOURS}-hour PM2.5 forecast for Delhi NCR on a{' '}
            {MODEL_META.resolution} grid, scored at{' '}
            {(source?.validated_rmse_ugm3 ?? MODEL_META.validatedRmse).toFixed(2)} µg/m³
            against a held-out window. Current conditions are measured, live.
          </p>
        </div>
        <div>
          <ScanButton onScan={onScan} scanning={scanning} />
        </div>
      </motion.div>
    </div>
  );
}
