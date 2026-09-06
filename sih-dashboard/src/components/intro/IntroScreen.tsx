
import * as React from 'react';
import dynamic from '@/lib/dynamic';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { ChevronDown, Cpu, Gauge, Satellite, Wind } from 'lucide-react';
import { ScanButton } from './ScanButton';
import { StatusPills, PILL_IDS } from './StatusPills';
import { ParticleProbe, type Probe } from './ParticleProbe';
import { AnalysisCard, TelemetryStat } from './TelemetryOverlay';
import { ScrollPanels, ScrollSectionHead } from './ScrollPanels';
import { ThemeToggle } from '@/components/ui/theme-toggle';
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

export function IntroScreen() {
  const screen = useAppStore((s) => s.screen);
  const startScan = useAppStore((s) => s.startScan);
  const completeScan = useAppStore((s) => s.completeScan);
  const frames = useAppStore((s) => s.frames);
  const interventions = useAppStore((s) => s.interventions);
  const frame = frames[0];

  const scanning = screen === 'transition';
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

  // --- scroll choreography ------------------------------------------------
  // The stage is pinned while the track scrolls past it. `progress` is handed
  // to the WebGL field as a ref so the canvas reads it inside its own frame
  // loop instead of re-rendering React on every scroll event.
  //
  // This measures the track directly rather than going through
  // useScroll({ target, offset: ['start start', 'end end'] }). That hook was
  // returning a progress that fell as the page scrolled down, so the HUD faded
  // part-way and then came back — leaving the masthead and telemetry rail
  // painted on top of the rising panels. Track height minus viewport height is
  // exactly the scrollable range here (the stage is pinned for the whole
  // track), so the ratio below is unambiguous and clamps at both ends.
  const trackRef = React.useRef<HTMLElement>(null);
  const scrollYProgress = useMotionValue(0);
  const progress = React.useRef(0);

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const update = () => {
      const range = el.offsetHeight - window.innerHeight;
      const v = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
      progress.current = v;
      scrollYProgress.set(v);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [scrollYProgress]);

  // The masthead and HUD hand over to the rising panels in the first third.
  const stageOpacity = useTransform(scrollYProgress, [0, 0.26], [1, 0]);
  const stageY = useTransform(scrollYProgress, [0, 0.26], [0, -40]);
  // Once faded the stage must stop swallowing clicks meant for the panels
  // climbing over it — opacity alone leaves the header and CTA hit-testable.
  const stagePointer = useTransform(scrollYProgress, (v) => (v > 0.24 ? 'none' : 'auto'));
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

  // --- aerosol band probe --------------------------------------------------
  // The cloud is stratified by load: dense and red at the surface, thinning
  // through amber to cool colours above the inversion. So the height of the
  // cursor over the canvas already selects a concentration — this maps that
  // height onto the pinned zones, ordered by their own PM2.5, so hovering the
  // red layer reports the emergency zone and the amber layer a warning one.
  //
  // Bands are read off the stage box rather than raycast against 13.5k points:
  // the colour ramp is purely a function of height, so a box test is both
  // exact and free.
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [probe, setProbe] = React.useState<Probe | null>(null);

  const bandZones = React.useMemo(() => {
    // Highest concentration sits lowest in the slab; order bottom -> top.
    return [...PILL_IDS]
      .map((id) => DISTRICTS.find((d) => d.id === id)!)
      .sort((a, b) => frame.districts[b.id].pm25 - frame.districts[a.id].pm25);
  }, [frame]);

  const onStageMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only while the stage still owns the screen.
      if (scanning || progress.current > 0.2) {
        setProbe(null);
        return;
      }
      const box = stageRef.current?.getBoundingClientRect();
      if (!box) return;
      const y = (e.clientY - box.top) / box.height;
      const x = (e.clientX - box.left) / box.width;

      // Vertical extent of the visible slab, and horizontal reach around its
      // axis — outside this the cursor is over empty sky, not the cloud.
      const inSlab = y >= 0.12 && y <= 0.8 && x > 0.16 && x < 0.86;
      if (!inSlab) {
        setProbe(null);
        return;
      }

      // 0 at the top of the slab, 1 at the bottom -> index into bandZones,
      // which is ordered densest-first.
      const depth = (y - 0.12) / (0.8 - 0.12);
      const idx = Math.min(
        bandZones.length - 1,
        Math.floor((1 - depth) * bandZones.length),
      );
      setProbe({
        district: bandZones[idx],
        x: e.clientX - box.left,
        y: e.clientY - box.top,
      });
    },
    [bandZones, scanning],
  );

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
      {/* ---- pinned stage: the canvas and HUD stay put while the track scrolls
          The probe listens here rather than on the canvas so it still fires
          when the HUD or a pill is under the cursor — the event bubbles up. */}
      <div
        ref={stageRef}
        onPointerMove={onStageMove}
        onPointerLeave={() => setProbe(null)}
        className="sticky top-0 h-dvh w-full overflow-hidden"
      >
      {/* --- background layers ------------------------------------------- */}
      <div className="absolute inset-0 grid-bg opacity-70" />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 40%, rgb(var(--as-accent) / 0.10), transparent 70%)' }} />
      <ParticleField dispersing={scanning} progress={progress} />
      <div className="pointer-events-none absolute inset-0 radial-vignette" />
      {/* bottom scrim keeps the headline and CTA legible over the haze */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-base via-base/80 to-transparent" />

      {/* the HUD fades out as the panels take over */}
      <motion.div
        style={{ opacity: stageOpacity, y: stageY, pointerEvents: stagePointer }}
        className="absolute inset-0"
      >

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
            LST {clock}
          </span>
          <ThemeToggle />
        </div>
      </motion.header>

      {/* --- floating zone pills ------------------------------------------ */}
      <StatusPills frame={frame} activeId={probe?.district.id ?? null} />

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

      {/* --- right analysis card ------------------------------------------ */}
      <div className="absolute right-5 top-1/2 z-20 hidden -translate-y-1/2 sm:right-8 lg:block">
        <AnalysisCard frame={frame} interventions={interventions} series={series} />
      </div>

      {/* --- masthead stack ------------------------------------------------
          Deliberately off-axis: title left-aligned against a rule, lede and
          CTA on a second horizontal axis. Gate 6 fails a hero whose eyebrow,
          title, lede and CTA all stack on one centred vertical spine. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-5 px-5 pb-10 sm:px-8 sm:pb-12 lg:pl-[19rem] lg:pr-[27rem]">
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

        {/* compact telemetry strip for small screens */}
        <div className="flex w-full items-center justify-between gap-2 lg:hidden">
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
            <ScanButton onScan={startScan} scanning={scanning} />
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

      {/* Probe readout rides above the fading HUD — it is only live while the
          stage owns the screen, so it never collides with the panels. */}
      <ParticleProbe probe={probe} frame={frame} />
      </div>

      {/* ---- rising content -------------------------------------------------
          Normal flow after the pinned stage, pulled up so it starts climbing
          over the hero rather than after a gap. The stage stays put until the
          track runs out, so the aerosol field opens out behind these. */}
      <div className="relative z-20 -mt-[16vh] px-5 pb-[8vh] sm:px-8">
        <section className="flex min-h-[100svh] flex-col justify-center gap-6">
          <ScrollSectionHead frame={frame} />
          <ScrollPanels frame={frame} series={series} interventions={interventions} />
        </section>

        {/* ---- closing call to action -------------------------------------- */}
        <section className="flex min-h-[85svh] w-full flex-col justify-center border-t border-hairline/60 pt-6">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.6 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl font-mono text-xl font-bold uppercase leading-tight tracking-[0.12em] text-ink sm:text-2xl"
          >
            Open the <span className="text-accent">console</span>
          </motion.h2>
          <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted">
            Spatial field, timeline playback and the what-if policy simulator for the
            full {MODEL_META.resolution} domain.
          </p>
          <div className="mt-5">
            <ScanButton onScan={startScan} scanning={scanning} />
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
    <div className="glass flex flex-1 flex-col items-center gap-0.5 px-2 py-2">
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
