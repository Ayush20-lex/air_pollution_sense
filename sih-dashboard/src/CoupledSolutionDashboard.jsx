/**
 * CoupledSolutionDashboard.jsx
 * Canonical dashboard for AirSense — SIH26082 / MoES / NCMRWF
 *
 * P0 compliance:
 *  - No fabricated data, metrics, or timestamps
 *  - SYNTHETIC/DEMO mode clearly labelled when weights are not loaded
 *  - All forecast values from backend APIs only
 *  - Model status from /api/v1/status
 *
 * P1 Redesign:
 *  - Unified Command Center layout (no tabs)
 *  - Dominant 3D spatial map
 *  - Left column: Current Risk + 72h Forecast
 *  - Right column: Drivers + Status
 */
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import {
  Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight,
  BrainCircuit, CloudRain, Gauge, Pause, Play,
  Radio, RotateCcw, Satellite, SkipBack, SkipForward,
  Wind, Zap, AlertCircle, CheckCircle2, Info, Layers
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import GridCanvas3D from './GridCanvas3D'
import { fetchDashboardData } from '@/lib/api'

// ── Utility components ────────────────────────────────────────────────────────
function Metric({ label, value, unit, trend, positive, className="" }) {
  const hasValue = value !== null && value !== undefined && value !== 0
  return (
    <div className={`flex items-end justify-between gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0 ${className}`}>
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 font-mono text-lg font-medium tracking-tight text-foreground">
          {hasValue ? value : '—'}
          {hasValue && unit && <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>}
        </p>
      </div>
      {trend && hasValue && (
        <span className={`flex items-center gap-1 font-mono text-[9px] ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {positive ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
          {trend}
        </span>
      )}
    </div>
  )
}

function PanelTitle({ icon: Icon, children, meta }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{children}</span>
      </div>
      {meta && <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">{meta}</span>}
    </div>
  )
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border/80 bg-background/95 px-2.5 py-1.5 font-mono text-[10px] shadow-lg backdrop-blur">
      <p className="mb-1 text-muted-foreground">T+{label}h</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
        </p>
      ))}
    </div>
  )
}

function AtmosphericChart({ activeHour, data = [] }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <LineChart data={data} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.2} vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={(v) => `+${v}h`}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 9, fontFamily: 'monospace' }}
            axisLine={false} tickLine={false}
          />
          <YAxis hide />
          <Tooltip content={<ChartTip />} />
          <Line type="monotone" dataKey="temp"  name="Temp °C" stroke="#38bdf8" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="pm25"  name="PM2.5"   stroke="#f87171" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="pbl"   name="PBL m"   stroke="#818cf8" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Data mode / synthetic banner ───────────────────────────────────────────────
function DataModeBanner({ modelStatus }) {
  if (!modelStatus) return null
  const isSynthetic = modelStatus.data_mode === 'synthetic' || !modelStatus.weights_loaded

  if (!isSynthetic) {
    return (
      <div className="flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-2 py-1">
        <CheckCircle2 className="size-3 text-emerald-400" />
        <span className="font-mono text-[9px] text-emerald-400 uppercase tracking-[0.16em]">Live Data</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1">
      <AlertTriangle className="size-3 text-amber-400" />
      <span className="font-mono text-[9px] text-amber-400 uppercase tracking-[0.16em]">
        Demo / Synthetic
      </span>
    </div>
  )
}

// ── Simulation map wrapper ─────────────────────────────────────────────────────
function SimulationMap({ activeHour, gridData }) {
  const [layers, setLayers] = useState({
    heatmap: true, particles: true, pbl: true, plume: true
  })
  const canvasContRef = useRef(null)
  const [canvasDims, setCanvasDims] = useState({ w: 800, h: 500 })

  useEffect(() => {
    const handleResize = () => {
      if (canvasContRef.current) {
        setCanvasDims({
          w: canvasContRef.current.offsetWidth,
          h: canvasContRef.current.offsetHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    setTimeout(handleResize, 100)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div
      className="relative flex h-[55vh] min-h-[400px] w-full overflow-hidden rounded-xl border border-border/50 bg-[#071416] lg:h-full lg:min-h-0"
      ref={canvasContRef}
    >
      <GridCanvas3D
        step={activeHour}
        layers={layers}
        width={canvasDims.w}
        height={canvasDims.h}
        gridData={gridData}
      />

      {/* Layer toggles */}
      <div className="absolute right-4 top-4 z-10 flex flex-col gap-1.5 rounded-lg border border-border/40 bg-background/70 p-2 backdrop-blur-md">
        <span className="px-1 pb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/80 flex items-center gap-1">
          <Layers className="size-2.5" /> Map Layers
        </span>
        {[
          ['heatmap',   'PM2.5 Conc.'],
          ['particles', 'Wind Flow'],
          ['pbl',       'PBL Surface'],
          ['plume',     'Plume Trans.'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={layers[key] ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 justify-start px-2 font-mono text-[9px] hover:bg-background/80"
            onClick={() => setLayers(l => ({ ...l, [key]: !l[key] }))}
          >
            <div className={`mr-1.5 size-1.5 rounded-full ${layers[key] ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function CoupledSolutionDashboard() {
  const [activeHour, setActiveHour] = useState(0)
  const [playing,    setPlaying]    = useState(false)
  const [speed,      setSpeed]      = useState(1)

  // Backend state
  const [forecastData,  setForecastData]  = useState(null)
  const [inversionData, setInversionData] = useState(null)
  const [policyData,    setPolicyData]    = useState(null)
  const [modelStatus,   setModelStatus]   = useState(null)
  const [gridData,      setGridData]      = useState(null) // handled by map internally now, but kept for future

  const [loading,   setLoading]   = useState(true)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [apiError,  setApiError]  = useState(null)

  // ── Data fetch via centralized API layer ────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const result = await fetchDashboardData()

      if (result.fatalError) {
        setApiError(result.fatalError)
        return
      }

      setModelStatus(result.modelStatus)
      setForecastData(result.series)
      setInversionData(result.inversionAlerts)
      setPolicyData(result.grapPolicy)

      if (result.errors) {
        Object.entries(result.errors).forEach(([src, err]) => {
          if (err) console.warn(`[api] ${src} error:`, err)
        })
      }

      setFetchedAt(new Date())
    } catch (err) {
      console.error('Unexpected fetch error:', err)
      setApiError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Timeline playback ────────────────────────────────────────────────────
  const timeline = useMemo(() => Array.from({ length: 13 }, (_, i) => i * 6), [])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(
      () => setActiveHour(h => (h >= 71 ? 0 : h + 3)),
      900 / speed
    )
    return () => window.clearInterval(timer)
  }, [playing, speed])

  // ── Derived values from real API data ────────────────────────────────────
  const current = forecastData
    ? (forecastData.find(d => d.hour === activeHour) ?? forecastData[0])
    : {}

  const sounding = forecastData ? forecastData.filter((_, i) => i % 2 === 0) : []
  const mainInversion = inversionData?.[0] ?? null
  const aqiScore  = policyData?.worst_case_aqi  ?? null
  const grapStage = policyData?.grap?.stage      ?? null
  const grapCategory = policyData?.grap?.category ?? null

  const isSynthetic = modelStatus
    ? (modelStatus.data_mode === 'synthetic' || !modelStatus.weights_loaded)
    : true

  // Determine peak PM2.5 in forecast
  const peakPm25 = forecastData?.reduce((max, d) => Math.max(max, d.pm25 ?? 0), 0) ?? 0
  const peakHour = forecastData?.find(d => d.pm25 === peakPm25)?.hour ?? 0

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background font-mono text-primary">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-xs">Establishing link to AirSense Backend...</p>
      </div>
    )
  }

  if (apiError && !forecastData) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-8 text-center font-mono">
        <AlertCircle className="size-10 text-destructive" />
        <p className="text-sm text-foreground">Connection Lost</p>
        <p className="max-w-md text-[10px] text-muted-foreground">{apiError}</p>
        <Button size="sm" onClick={fetchData} variant="outline" className="mt-2 h-7 text-xs">Retry Connection</Button>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-[#02080a] text-foreground">

      {/* ── Top App Bar ── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 bg-background/40 px-4 md:px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary">
            <BrainCircuit className="size-4" />
            <span className="font-sans text-sm font-semibold tracking-tight text-foreground">
              AirSense<span className="text-primary font-light"> / NCR</span>
            </span>
          </div>
          <Separator orientation="vertical" className="hidden h-4 bg-border/50 md:block" />
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground md:block">
            Coupled Forecasting System
          </span>
        </div>
        <div className="flex items-center gap-3">
          <DataModeBanner modelStatus={modelStatus} />
          {fetchedAt && (
            <span className="hidden font-mono text-[9px] text-muted-foreground/70 sm:block">
              UPDT {fetchedAt.toLocaleTimeString()}
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={fetchData} className="size-7 text-muted-foreground hover:text-foreground">
            <RotateCcw className="size-3" />
          </Button>
        </div>
      </header>

      {/* ── Main Workspace Grid ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-4">

        {/* LEFT COLUMN: Current Risk & Forecast Trajectory */}
        <div className="flex w-full flex-col gap-4 lg:w-[320px] shrink-0 overflow-y-auto pr-1 lg:pr-0">
          
          {/* Hero: Current AQI */}
          <Card className="border-border/30 bg-background/50 p-5 shadow-sm backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/80">Regional AQI Peak</p>
              {grapStage !== null && (
                <Badge variant="outline" className="h-5 rounded-sm border-primary/30 bg-primary/5 px-1.5 font-mono text-[8px] text-primary">
                  GRAP {grapStage}
                </Badge>
              )}
            </div>
            <div className="mt-1">
              <h2 className="font-mono text-5xl font-light tracking-tighter text-foreground">{aqiScore ?? '—'}</h2>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {grapCategory ?? 'Evaluating conditions...'}
              </p>
            </div>
          </Card>

          {/* Current Key Telemetry */}
          <Card className="shrink-0 border-border/30 bg-background/50 p-4 shadow-sm backdrop-blur-md">
            <PanelTitle icon={CloudRain} meta={`T+${activeHour}H`}>Conditions</PanelTitle>
            <div className="flex flex-col gap-2">
              <Metric label="PM2.5 Avg"     value={current.pm25}  unit="µg/m³" />
              <Metric label="PBL Height"    value={current.pbl}   unit="m"     />
              <Metric label="Temperature"   value={current.temp}  unit="°C"    />
              <Metric label="Solar Irr."    value={current.solar} unit="W/m²"  />
            </div>
          </Card>

          {/* Forecast Chart */}
          <Card className="flex flex-1 flex-col border-border/30 bg-background/50 p-4 shadow-sm backdrop-blur-md min-h-[260px]">
            <PanelTitle icon={Activity} meta="72H PROJECTION">Trajectory</PanelTitle>
            <div className="mb-3 flex items-center justify-between rounded border border-border/30 bg-background/30 px-2 py-1.5">
              <span className="font-mono text-[9px] text-muted-foreground">Peak Expected</span>
              <span className="font-mono text-[10px] text-red-400">{peakPm25} µg/m³ @ T+{peakHour}h</span>
            </div>
            <div className="flex-1">
              <AtmosphericChart activeHour={activeHour} data={sounding} />
            </div>
          </Card>
        </div>

        {/* CENTER COLUMN: 3D Spatial Map */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border/30 bg-background/30 shadow-sm">
          <SimulationMap activeHour={activeHour} gridData={gridData} />
        </div>

        {/* RIGHT COLUMN: Drivers & Status */}
        <div className="flex w-full flex-col gap-4 lg:w-[320px] shrink-0 overflow-y-auto pl-1 lg:pl-0">
          
          {/* Explanation Engine */}
          <Card className="border-border/30 bg-background/50 p-4 shadow-sm backdrop-blur-md">
            <PanelTitle icon={Info} meta="AUTO-ANALYSIS">Why is it changing?</PanelTitle>
            <div className="space-y-3">
              <div className="rounded border border-primary/20 bg-primary/5 p-2.5">
                <p className="font-mono text-[9px] uppercase tracking-wider text-primary mb-1">Two-Way Coupling</p>
                <p className="text-[10px] leading-relaxed text-muted-foreground font-sans">
                  The model dynamically predicts how aerosol load (PM2.5) suppresses incoming solar irradiance (W/m²), which in turn lowers the Planetary Boundary Layer (PBL), trapping more pollution in a feedback loop.
                </p>
              </div>
              {mainInversion && mainInversion.isi_score > 0.75 && (
                <div className="rounded border border-red-500/20 bg-red-500/5 p-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-red-400 mb-1">Inversion Trap</p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground font-sans">
                    Critical inversion conditions detected (ISI: {mainInversion.isi_score.toFixed(2)}). Low PBL and stagnation are severely restricting atmospheric ventilation.
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Inversion Alerts */}
          {mainInversion && (
            <Card className="border-border/30 bg-background/50 p-4 shadow-sm backdrop-blur-md">
              <PanelTitle icon={AlertTriangle} meta={`ISI > 0.75`}>Inversion Risk Zones</PanelTitle>
              <div className="flex flex-col gap-2">
                {inversionData?.slice(0, 3).map(zone => (
                  <div key={zone.zone_id} className="flex flex-col gap-1 rounded border border-border/40 bg-background/30 p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-foreground">{zone.zone_id}</span>
                      <span className={`font-mono text-[9px] ${zone.severity === 'EMERGENCY' ? 'text-red-400' : 'text-amber-400'}`}>
                        {zone.severity}
                      </span>
                    </div>
                    <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
                      <span>ISI: {zone.isi_score.toFixed(2)}</span>
                      <span>Peak PM2.5: {Math.round(zone.pm25_peak)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Data Lineage & Status */}
          <Card className="mt-auto border-border/30 bg-background/50 p-4 shadow-sm backdrop-blur-md">
            <PanelTitle icon={Radio} meta="SYSTEM">Data Lineage</PanelTitle>
            <div className="flex flex-col gap-1.5 font-mono text-[9px]">
              {[
                ['Model',       modelStatus?.model_name?.split('Coupled')?.[1] || 'Forecaster'],
                ['Weights',     modelStatus?.weights_loaded ? 'LOADED' : 'RANDOM (DEMO)'],
                ['CPCB/AQI',    modelStatus?.sources?.cpcb_waqi?.toUpperCase()],
                ['IMD Met',     modelStatus?.sources?.imd_met?.toUpperCase()],
                ['NASA FIRMS',  modelStatus?.sources?.nasa_firms?.toUpperCase()],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between border-b border-border/20 pb-1 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={
                    val === 'LOADED' || val === 'LIVE' ? 'text-emerald-400' :
                    val === 'RANDOM (DEMO)' || val === 'SYNTHETIC' ? 'text-amber-400' :
                    'text-foreground'
                  }>{val ?? '—'}</span>
                </div>
              ))}
            </div>
          </Card>

        </div>
      </div>

      {/* ── Footer Playback Timeline ── */}
      <footer className="shrink-0 border-t border-border/40 bg-background/70 px-4 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-4">
          
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => setActiveHour(h => Math.max(0, h - 3))}>
              <SkipBack className="size-3" />
            </Button>
            <Button size="icon" className="size-7 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setPlaying(p => !p)}>
              {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => setActiveHour(h => Math.min(71, h + 3))}>
              <SkipForward className="size-3" />
            </Button>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-4 px-2">
            <div className="w-16 shrink-0 text-right font-mono">
              <p className="text-[10px] text-primary">T+{String(activeHour).padStart(2, '0')}h</p>
            </div>
            <Slider
              value={[activeHour]}
              min={0} max={71} step={3}
              onValueChange={(v) => setActiveHour(v[0])}
              className="flex-1 cursor-pointer"
            />
            <div className="hidden w-[280px] shrink-0 justify-between font-mono text-[9px] text-muted-foreground xl:flex">
              {timeline.map(h => (
                <span key={h} className={h === activeHour ? 'text-primary font-medium' : ''}>+{h}</span>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-1.5 sm:flex border-l border-border/40 pl-4">
            <span className="font-mono text-[9px] uppercase text-muted-foreground">Speed</span>
            {[0.5, 1, 2].map(v => (
              <Button
                key={v}
                variant={speed === v ? 'secondary' : 'ghost'}
                size="sm"
                className="h-5 px-1.5 font-mono text-[9px]"
                onClick={() => setSpeed(v)}
              >{v}x</Button>
            ))}
          </div>

        </div>
      </footer>
    </main>
  )
}
