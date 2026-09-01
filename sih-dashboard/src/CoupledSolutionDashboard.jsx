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
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
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

import CinematicGlobe from './CinematicGlobe'
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
        <AreaChart data={data} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorPm25" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorPbl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.2} vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={(v) => `+${v}h`}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 9, fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false}
          />
          <YAxis hide />
          <Tooltip content={<ChartTip />} />
          <Area type="monotone" dataKey="temp" name="Temp °C" stroke="#38bdf8" fillOpacity={1} fill="url(#colorTemp)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="pm25" name="PM2.5" stroke="#f87171" fillOpacity={1} fill="url(#colorPm25)" strokeWidth={2} />
          <Area type="monotone" dataKey="pbl" name="PBL m" stroke="#818cf8" fillOpacity={1} fill="url(#colorPbl)" strokeWidth={1.5} />
        </AreaChart>
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
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1">
        <CheckCircle2 className="size-3 text-emerald-400" />
        <span className="font-mono text-[9px] text-emerald-400 uppercase tracking-[0.16em]">Live Data</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1">
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
      className="absolute inset-0 z-0 h-full w-full overflow-hidden bg-[#04090b]"
      ref={canvasContRef}
    >
      <CinematicGlobe step={activeHour} layers={layers} />

      {/* Layer toggles */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-row items-center gap-1.5 glass-panel p-1.5 rounded-full">
        <span className="hidden px-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/80 sm:flex items-center gap-1 border-r border-border/40 mr-1">
          <Layers className="size-2.5" /> Map Layers
        </span>
        {[
          ['heatmap',   'PM2.5'],
          ['particles', 'Wind'],
          ['pbl',       'PBL'],
          ['plume',     'Plume'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={layers[key] ? 'secondary' : 'ghost'}
            size="sm"
            className={`h-7 rounded-full px-3 font-mono text-[9px] transition-all hover:bg-background/80 ${layers[key] ? 'bg-background/60 shadow-[0_0_10px_rgba(56,189,248,0.2)] text-primary' : ''}`}
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
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-[#04090b] font-mono text-primary">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-xs">Establishing link to AirSense Backend...</p>
      </div>
    )
  }

  if (apiError && !forecastData) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-[#04090b] px-8 text-center font-mono">
        <AlertCircle className="size-10 text-destructive" />
        <p className="text-sm text-foreground">Connection Lost</p>
        <p className="max-w-md text-[10px] text-muted-foreground">{apiError}</p>
        <Button size="sm" onClick={fetchData} variant="outline" className="mt-2 h-7 text-xs border-white/20">Retry Connection</Button>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-[#04090b] text-foreground font-sans">
      {/* ── Top App Bar ── */}
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-background/60 px-4 md:px-6 backdrop-blur-xl">
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

      {/* ── Main Workspace ── */}
      <div className="relative flex min-h-0 flex-1">
        
        {/* Full-bleed absolute background map */}
        <SimulationMap activeHour={activeHour} gridData={gridData} />

        {/* Floating Sidebars Layer */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col lg:flex-row justify-between p-4 gap-4 overflow-y-auto lg:overflow-hidden">
          
          {/* LEFT COLUMN: Current Risk & Forecast Trajectory */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 shrink-0 lg:h-full lg:w-[320px] lg:overflow-y-auto lg:pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            
            {/* Hero: Current AQI */}
            <Card className="glass-panel p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/80">Regional AQI Peak</p>
                {grapStage !== null && (
                  <Badge variant="outline" className="severity-badge h-5 px-1.5 font-mono text-[8px] text-orange-400 border-orange-500/30 bg-orange-500/10">
                    GRAP {grapStage}
                  </Badge>
                )}
              </div>
              <div className="mt-1">
                <h2 className="font-mono text-5xl font-light tracking-tighter text-foreground">{aqiScore ?? '—'}</h2>
                <p className="mt-2 font-sans text-[10px] leading-relaxed text-muted-foreground">
                  {grapCategory ?? 'Evaluating conditions...'}
                </p>
              </div>
            </Card>

            {/* Current Key Telemetry */}
            <Card className="glass-panel shrink-0 p-4">
              <PanelTitle icon={CloudRain} meta={`T+${activeHour}H`}>Conditions</PanelTitle>
              <div className="flex flex-col gap-2">
                <Metric label="PM2.5 Avg"     value={current.pm25}  unit="µg/m³" />
                <Metric label="PBL Height"    value={current.pbl}   unit="m"     />
                <Metric label="Temperature"   value={current.temp}  unit="°C"    />
                <Metric label="Solar Irr."    value={current.solar} unit="W/m²"  />
              </div>
            </Card>

            {/* Forecast Chart */}
            <Card className="glass-panel flex flex-1 flex-col p-4 min-h-[260px]">
              <PanelTitle icon={Activity} meta="72H PROJECTION">Trajectory</PanelTitle>
              <div className="mb-3 flex items-center justify-between rounded border border-red-500/20 bg-red-500/10 px-2 py-1.5 shadow-[0_0_15px_rgba(248,113,113,0.1)]">
                <span className="font-mono text-[9px] text-red-300 uppercase tracking-wider">Peak Expected</span>
                <span className="font-mono text-[10px] text-red-400 font-bold">{peakPm25} µg/m³ @ T+{peakHour}h</span>
              </div>
              <div className="flex-1">
                <AtmosphericChart activeHour={activeHour} data={sounding} />
              </div>
            </Card>
          </div>

          {/* RIGHT COLUMN: Drivers & Status */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 shrink-0 mt-4 lg:mt-0 lg:ml-auto lg:h-full lg:w-[320px] lg:overflow-y-auto lg:pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            
            {/* Explanation Engine */}
            <Card className="glass-panel p-4">
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
              <Card className="glass-panel p-4">
                <PanelTitle icon={AlertTriangle} meta={`ISI > 0.75`}>Inversion Risk Zones</PanelTitle>
                <div className="flex flex-col gap-2">
                  {inversionData?.slice(0, 3).map(zone => (
                    <div key={zone.zone_id} className="flex flex-col gap-1 rounded border border-white/10 bg-white/5 p-2">
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
            <Card className="glass-panel mt-auto p-4">
              <PanelTitle icon={Radio} meta="SYSTEM">Data Lineage</PanelTitle>
              <div className="flex flex-col gap-1.5 font-mono text-[9px]">
                {[
                  ['Model',       modelStatus?.model_name?.split('Coupled')?.[1] || 'Forecaster'],
                  ['Weights',     modelStatus?.weights_loaded ? 'LOADED' : 'RANDOM (DEMO)'],
                  ['CPCB/AQI',    modelStatus?.sources?.cpcb_waqi?.toUpperCase()],
                  ['IMD Met',     modelStatus?.sources?.imd_met?.toUpperCase()],
                  ['NASA FIRMS',  modelStatus?.sources?.nasa_firms?.toUpperCase()],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between border-b border-white/10 pb-1 last:border-0">
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
      </div>

      {/* ── Footer Playback Timeline ── */}
      <footer className="relative z-20 shrink-0 border-t border-white/10 bg-background/60 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-4">
          
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground hover:shadow-[0_0_15px_rgba(255,255,255,0.1)]"
              onClick={() => setActiveHour(h => Math.max(0, h - 3))}>
              <SkipBack className="size-3" />
            </Button>
            <Button size="icon" className="size-7 bg-primary text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[0_0_15px_rgba(56,189,248,0.4)]"
              onClick={() => setPlaying(p => !p)}>
              {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground hover:shadow-[0_0_15px_rgba(255,255,255,0.1)]"
              onClick={() => setActiveHour(h => Math.min(71, h + 3))}>
              <SkipForward className="size-3" />
            </Button>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-4 px-2">
            <div className="w-16 shrink-0 text-right font-mono">
              <p className="text-[10px] text-primary drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]">T+{String(activeHour).padStart(2, '0')}h</p>
            </div>
            <Slider
              value={[activeHour]}
              min={0} max={71} step={3}
              onValueChange={(v) => setActiveHour(v[0])}
              className="flex-1 cursor-pointer opacity-90 hover:opacity-100 transition-opacity"
            />
            <div className="hidden w-[280px] shrink-0 justify-between font-mono text-[9px] text-muted-foreground xl:flex">
              {timeline.map(h => (
                <span key={h} className={h === activeHour ? 'text-primary font-medium drop-shadow-[0_0_5px_rgba(56,189,248,0.5)]' : ''}>+{h}</span>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-1.5 sm:flex border-l border-white/10 pl-4">
            <span className="font-mono text-[9px] uppercase text-muted-foreground">Speed</span>
            {[0.5, 1, 2].map(v => (
              <Button
                key={v}
                variant={speed === v ? 'secondary' : 'ghost'}
                size="sm"
                className={`h-5 px-1.5 font-mono text-[9px] transition-all hover:bg-white/10 ${speed === v ? 'bg-white/10 text-primary shadow-[0_0_10px_rgba(56,189,248,0.2)]' : ''}`}
                onClick={() => setSpeed(v)}
              >{v}x</Button>
            ))}
          </div>

        </div>
      </footer>
    </main>
  )
}
