import * as React from 'react';
import dynamic from '@/lib/dynamic';
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'framer-motion';
import { ChevronDown, Cpu, Gauge, Satellite, Wind } from 'lucide-react';
import { ScanButton } from './ScanButton';
import { ScanTransition } from './ScanTransition';
import { StatusPills, SLOTS } from './StatusPills';
import { ParticleProbe, type Probe } from './ParticleProbe';
import { TelemetryStat } from './TelemetryOverlay';
import { ScrollPanels, ScrollSectionHead } from './ScrollPanels';
import { EntryGrid } from './EntryGrid';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { CommandPalette } from '@/components/ui/command-palette';
import { Badge } from '@/components/ui/badge';
import { aqiColor } from '@/lib/aqi';
import { DISTRICTS, MODEL_META } from '@/lib/data';
import { SEVERITY } from '@/lib/tokens';
import { useAppStore } from '@/store/useAppStore';
import { formatLST } from '@/lib/utils';

const ParticleField = dynamic(
  () => import('./ParticleField').then((m) => m.ParticleField),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-24 animate-pulse rounded-full bg-accent/10 blur-2xl" />
      </div>
    ),
  },
);

/**
 * Stand-in for the aerosol field under prefers-reduced-motion.
 *
 * The field itself already honoured the setting by freezing its loop, but only
 * after the chunk had downloaded and a WebGL context had been created — three
 * plus the renderer is ~884 kB (235 kB gzipped), the largest chunk in the
 * build, spent on a still image for someone who asked for less motion.
 *
 * This paints the same idea in CSS: a loaded core thinning outward, with the
 * horizon line the field draws as a ring. No canvas, no import.
 */
function StaticField() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div
        className="absolute left-1/2 top-[40%] size-[min(78vw,44rem)] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--as-accent) / 0.30) 0%, rgb(var(--as-accent) / 0.14) 34%, rgb(var(--as-accent) / 0.05) 55%, transparent 72%)',
          filter: 'blur(22px)',
        }}
      />
      <div
        className="absolute left-1/2 top-[40%] size-[min(58vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ borderColor: 'rgb(var(--as-accent) / 0.22)' }}
      />
    </div>
  );
}

export function IntroScreen() {
  const screen = useAppStore((s) => s.screen);
  const startScan = useAppStore((s) => s.startScan);
  const completeScan = useAppStore((s) => s.completeScan);
  const frames = useAppStore((s) => s.frames);
  const interventions = useAppStore((s) => s.interventions);
  const frame = frames[0];

  const scanning = screen === 'transition';
  // Stays true through the route push so the curtain never lifts early.
  const handingOff = screen !== 'intro';
  const [clock, setClock] = React.useState<string>('--:--:--');

  React.useEffect(() => {
    const tick = () => setClock(formatLST(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Hand off to the dashboard once the disperse animation has played out.
  React.useEffect(() => {
    if (!scanning) return;
    const id = setTimeout(completeScan, 1500);
    return () => clearTimeout(id);
  }, [scanning, completeScan]);

  // --- cursor probe --------------------------------------------------------
  // Hovering the cloud names the zone under the cursor. Mapping is
  // nearest-zone against the same SLOTS the pills are placed from, so the
  // readout can never disagree with the pill it is sitting next to.
  //
  // The earlier version mapped the cursor's vertical position to a
  // concentration band, which suited the old flat scatter — the field is now a
  // Fibonacci shell whose loaded patches are distributed over a sphere, so
  // height alone no longer names a concentration.
  const prefersReduced = useReducedMotion();

  const [probe, setProbe] = React.useState<Probe | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);

  const onStageMove = React.useCallback(
    (e: React.PointerEvent) => {
      // Coarse pointers have no hover, and the readout is decorative — a tap
      // would pin a card the user then has to dismiss.
      if (e.pointerType !== 'mouse') return;
      const el = stageRef.current;
      if (!el) return;

      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      // Is the cursor actually over the cloud?
      //
      // Proximity to a zone pill is the wrong test: the pills are placed to
      // frame the cloud rather than cover it, so the nearest one can be a
      // short hop away while the cursor sits on empty sky.
      //
      // The footprint is an ellipse fitted to the rendered field. It is not
      // derived from the camera: the rig dollies on scroll and parallaxes with
      // the pointer, so a projection computed from the nominal camera drifts
      // out of register as soon as the page moves. The drawing buffer is not
      // preserved either, so the canvas cannot be sampled without paying for
      // preserveDrawingBuffer on the heaviest chunk in the build. These are
      // empirical, and the only thing they need to be is a good fit — nudge
      // them if the field's radius changes.
      const CLOUD = { cx: 0.5, cy: 0.4, rx: 0.32, ry: 0.34 };
      const nx = (x / r.width - CLOUD.cx) / CLOUD.rx;
      const ny = (y / r.height - CLOUD.cy) / CLOUD.ry;
      if (nx * nx + ny * ny > 1) {
        setProbe(null);
        return;
      }

      // Inside the cloud, the nearest pill names the zone — it is the same
      // direction the pill itself is pointing at.
      let best: { id: string; d: number } | null = null;
      for (const slot of SLOTS) {
        const sx = (parseFloat(slot.left) / 100) * r.width;
        const sy = (parseFloat(slot.top) / 100) * r.height;
        const dx = (x - sx) / r.width;
        const dy = (y - sy) / r.height;
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { id: slot.id, d };
      }
      if (!best) {
        setProbe(null);
        return;
      }
      const district = DISTRICTS.find((d) => d.id === best!.id);
      if (!district) return;
      setProbe({ district, x, y });
    },
    [],
  );

  // --- scroll choreography ------------------------------------------------
  // The stage is pinned while the track scrolls past it. `progress` is handed
  // to the WebGL field as a ref so the canvas reads it inside its own frame
  // loop instead of re-rendering React on every scroll event.
  const trackRef = React.useRef<HTMLElement>(null);
  // Scroll progress is computed here rather than with `useScroll`.
  //
  // Both `useScroll({ target })` and bare `useScroll()` cache the scroll range,
  // and this page invalidates that cache after first paint: the stage is
  // `sticky h-dvh`, the WebGL canvas mounts lazily, and `min-h-[100svh]`
  // sections resolve late. Progress read ~0.07 at 79% scrolled and snapped back
  // to 0 at the bottom, so the HUD never faded and the closing section scrolled
  // straight into the pinned hero. Re-reading scrollHeight on every event costs
  // one layout read per scroll and cannot go stale.
  const scrollYProgress = useMotionValue(0);
  React.useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollYProgress.set(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [scrollYProgress]);
  const progress = React.useRef(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    progress.current = v;
  });

  // The masthead and HUD hand over to the rising panels in the first third.
  const stageOpacity = useTransform(scrollYProgress, [0, 0.26], [1, 0]);
  const stageY = useTransform(scrollYProgress, [0, 0.26], [0, -40]);
  // the scroll hint retires as soon as the user actually scrolls
  const hintOpacity = useTransform(scrollYProgress, [0, 0.04], [1, 0]);

  // Enter is the keyboard equivalent of the button; scrolling no longer
  // fires the transition on its own, it drives the animation instead.
  React.useEffect(() => {
    if (scanning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') startScan();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scanning, startScan]);

  // Reset to the top whenever the intro mounts (e.g. back from the dashboard).
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const series = frames.map((f) => f.avgPm25);

  // Six-hour tendencies, read off the forecast rather than decorated on.
  const ahead = frames[Math.min(6, frames.length - 1)];
  const pmTrend = ((ahead.avgPm25 - frame.avgPm25) / frame.avgPm25) * 100;
  const pblTrend = ahead.avgPbl - frame.avgPbl;
  const invTrend = ahead.inversionIndex - frame.inversionIndex;
  const signed = (v: number, dp = 0, unit = '%') =>
    `${v >= 0 ? '+' : ''}${v.toFixed(dp)}${unit} / 6h`;

  return (
    <motion.section
      key="intro"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08, filter: 'blur(14px)' }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      ref={trackRef}
      className="relative w-full"
    >
      <ScanTransition active={handingOff} />

      {/* ---- pinned stage: the canvas and HUD stay put while the track scrolls */}
      <div
        ref={stageRef}
        onPointerMove={onStageMove}
        onPointerLeave={() => setProbe(null)}
        className="sticky top-0 h-dvh w-full overflow-hidden"
      >
      {/* --- background layers ------------------------------------------- */}
      <div className="absolute inset-0 grid-bg opacity-70" />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 40%, rgb(var(--as-accent) / 0.10), transparent 70%)' }} />
      {/* Reduced motion skips the import entirely rather than loading three to
          render a frozen frame. */}
      {prefersReduced ? (
        <StaticField />
      ) : (
        <ParticleField dispersing={scanning} progress={progress} />
      )}
      <div className="pointer-events-none absolute inset-0 radial-vignette" />
      {/* bottom scrim keeps the headline and CTA legible over the haze */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-base via-base/80 to-transparent" />

      {/* the HUD fades out as the panels take over */}
      <motion.div style={{ opacity: stageOpacity, y: stageY }} className="absolute inset-0">

      {/* --- top bar ------------------------------------------------------ */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4 sm:px-8"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex size-9 items-center justify-center rounded-lg border border-accent/40 bg-accent/10">
            <Satellite className="size-4 text-accent" />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-good" />
          </div>
          <div className="leading-tight">
            <div className="font-mono text-sm font-bold tracking-[0.2em] text-ink">
              AIRSENSE <span className="text-accent">/ NCR</span>
            </div>
            <div className="hud-label">Coupled forecasting system v4.2</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Badge className="hidden sm:inline-flex">Demo / Synthetic</Badge>
          <Badge color={SEVERITY.good} dot className="hidden md:inline-flex">
            {MODEL_META.cycle} cycle
          </Badge>
          <span className="hidden font-mono text-2xs tabular-nums text-muted sm:inline">
          {clock} IST
          </span>
          <CommandPalette />
          <ThemeToggle />
        </div>
      </motion.header>

      {/* --- floating zone pills ------------------------------------------ */}
      <StatusPills frame={frame} />
      <ParticleProbe probe={probe} frame={frame} />

      {/* --- left telemetry rail ------------------------------------------ */}
      <div className="absolute left-5 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-4 sm:left-8 lg:flex">
        <TelemetryStat
          label="PM2.5 AVG"
          value={frame.avgPm25.toFixed(0)}
          unit="µg/m³"
          accent={aqiColor(frame.avgPm25)}
          delta={signed(pmTrend)}
          delay={0.15}
        />
        <TelemetryStat
          label="PBL Height"
          value={String(frame.avgPbl)}
          unit="m"
          delta={signed(pblTrend, 0, ' m')}
          delay={0.25}
        />
        <TelemetryStat
          label="Inversion Index"
          value={frame.inversionIndex.toFixed(2)}
          accent={frame.inversionIndex > 0.75 ? SEVERITY.bad : SEVERITY.moderate}
          delta={signed(invTrend, 2, '')}
          delay={0.35}
        />
      </div>

      {/* --- masthead stack ------------------------------------------------
          Deliberately off-axis: title left-aligned against a rule, lede and
          CTA on a second horizontal axis. Gate 6 fails a hero whose eyebrow,
          title, lede and CTA all stack on one centred vertical spine. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-5 px-5 pb-10 sm:px-8 sm:pb-12 lg:pl-[19rem] lg:pr-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="hud-label">Problem statement ID26082 · NCMRWF</span>
          <h1 className="mt-2 max-w-3xl font-mono text-2xl font-bold uppercase leading-tight tracking-[0.12em] text-ink [overflow-wrap:anywhere] sm:text-3xl">
            Two-way coupled
            <span className="text-accent"> meteorology / chemistry</span>
          </h1>
        </motion.div>

        {/* Compact telemetry strip for small screens.
            pointer-events-auto because the masthead wrapper above is
            pointer-events-none — it spans the lower half of the stage and would
            otherwise swallow every pointer event heading for the particle
            field. Children that need the cursor opt back in, as the header and
            the CTA do; these cards carry .glass-hover and never got it, so
            their hover treatment could not fire at any width below lg. */}
        <div className="pointer-events-auto flex w-full items-center justify-between gap-2 lg:hidden">
          <MiniStat icon={<Gauge className="size-3" />} label="PM2.5" value={`${frame.avgPm25.toFixed(0)}`} color={aqiColor(frame.avgPm25)} />
          <MiniStat icon={<Wind className="size-3" />} label="PBL" value={`${frame.avgPbl}m`} />
          <MiniStat icon={<Cpu className="size-3" />} label="INV" value={frame.inversionIndex.toFixed(2)} color={SEVERITY.moderate} />
        </div>

        {/* second axis: lede left, action right, divided by a hairline */}
        <div className="flex flex-col gap-4 border-t border-hairline/60 pt-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <p className="max-w-md text-pretty text-sm leading-relaxed text-muted">
            72-hour forecasts for Delhi NCR on a 3 km grid, resolving the
            aerosol-radiation-PBL feedback online rather than as an offline pass.
          </p>

          <div className="pointer-events-auto flex shrink-0 flex-col items-start gap-2.5 sm:items-end">
            <ScanButton onScan={startScan} scanning={handingOff} />
            <motion.span
              style={{ opacity: hintOpacity }}
              className="flex items-center gap-1.5 whitespace-nowrap font-mono text-2xs uppercase tracking-[0.2em] text-faint"
            >
              <ChevronDown className="size-3" />
              Scroll or press enter
            </motion.span>
          </div>
        </div>
      </div>
      </motion.div>
      </div>

      {/* ---- rising content -------------------------------------------------
          Normal flow after the pinned stage, so it starts exactly at the fold
          and climbs over the hero as the track scrolls. It used to carry a
          negative top margin, which lifted it above the fold and printed it on
          top of the CTA on short and mobile viewports. */}
      <div className="relative z-20 px-5 pb-[8vh] sm:px-8">
        <section className="flex min-h-[100svh] flex-col justify-center gap-6">
          <ScrollSectionHead frame={frame} />
          <ScrollPanels frame={frame} series={series} interventions={interventions} />
        </section>

        {/* ---- closing: where to go next ----------------------------------
            Sized by its content. It used to be min-h-[85svh] wrapped around a
            heading, a line and a button — 138px of content in a 740px box. */}
        <section className="w-full border-t border-hairline/60 pb-[6vh] pt-10">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.6 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl font-mono text-xl font-bold uppercase leading-tight tracking-[0.12em] text-ink sm:text-2xl"
          >
            Three ways <span className="text-accent">in</span>
          </motion.h2>
          <p className="mt-2 max-w-lg text-pretty text-sm leading-relaxed text-muted">
            Each one opens the public terminal. Everything it shows is read-only.
          </p>
          <div className="mt-6">
            <EntryGrid frame={frame} onScan={startScan} scanning={handingOff} />
          </div>
        </section>
      </div>
    </motion.section>
  );
}

function MiniStat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="glass glass-hover flex flex-1 flex-col items-center gap-0.5 px-2 py-2">
      <span className="flex items-center gap-1 font-mono text-2xs uppercase tracking-widest text-faint">
        {icon}
        {label}
      </span>
      <span
        className="font-mono text-base font-semibold tabular-nums"
        style={{ color: color ?? 'rgb(var(--as-ink))' }}
      >
        {value}
      </span>
    </div>
  );
}
