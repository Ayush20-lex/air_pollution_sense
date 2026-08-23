import { useEffect, useMemo, useState, useRef } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bot, BrainCircuit, CloudRain, Gauge, Layers3, Pause, Play, Radio, RotateCcw, Satellite, Search, Settings2, ShieldCheck, SkipBack, SkipForward, Wind, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import GridCanvas3D from './GridCanvas3D'

const navItems = [
  { key: 'coupling', icon: Activity, label: 'Two-Way Coupling' },
  { key: 'inversion', icon: Satellite, label: 'Inversion Tracker' },
  { key: 'convlstm', icon: BrainCircuit, label: 'ConvLSTM Grid' },
  { key: 'stubble', icon: Wind, label: 'Stubble Plume' },
]

function Metric({ label, value, unit, trend, positive }) {
  return <div className="flex items-end justify-between gap-3 border-b border-border/50 pb-3 last:border-0 last:pb-0"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-medium tracking-tight text-foreground">{value}<span className="ml-1 text-xs text-muted-foreground">{unit}</span></p></div>{trend && <span className={`flex items-center gap-1 font-mono text-[10px] ${positive ? 'text-primary' : 'text-destructive'}`}>{positive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{trend}</span>}</div>
}
function PanelTitle({ icon: Icon, children, meta }) { return <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Icon className="size-3.5 text-primary" /><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{children}</span></div>{meta && <span className="font-mono text-[10px] text-muted-foreground">{meta}</span>}</div> }
function ChartTip({ active, payload, label }) { if (!active || !payload?.length) return null; return <div className="rounded-md border border-border bg-popover px-3 py-2 font-mono text-[10px] text-popover-foreground"><p className="mb-1 text-muted-foreground">T+{label}h</p>{payload.map((entry) => <p key={entry.name}>{entry.name}: {entry.value}</p>)}</div> }
function AtmosphericChart({ activeHour, data = [], inversion = false }) { return <div className="h-52 w-full"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><LineChart data={data} margin={{ top: 8, right: 8, left: -25, bottom: 0 }}><CartesianGrid stroke="var(--border)" strokeOpacity={0.35} vertical={false} /><XAxis dataKey="hour" tickFormatter={(v) => `+${v}h`} tick={{ fill: 'var(--muted-foreground)', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="temp" name="Temp °C" stroke="var(--primary)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="pm25" name="PM2.5" stroke="var(--accent)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="pbl" name={inversion ? 'Inv. Lid' : 'PBL'} stroke="var(--chart-4)" strokeWidth={2} dot={false} />{activeHour > 0 && <Line data={data.filter((d) => d.hour <= activeHour)} type="monotone" dataKey="pm25" stroke="var(--foreground)" strokeWidth={3} dot={false} />}</LineChart></ResponsiveContainer></div> }

function SimulationMap({ activeHour }) {
  const [layers, setLayers] = useState({
    heatmap: true, particles: true, pbl: true, plume: true
  });
  const canvasContRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ w: 800, h: 500 });

  useEffect(() => {
    const handleResize = () => {
      if (canvasContRef.current) {
        setCanvasDims({
          w: canvasContRef.current.offsetWidth,
          h: canvasContRef.current.offsetHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    setTimeout(handleResize, 100);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="relative flex min-h-[460px] flex-1 overflow-hidden rounded-lg border border-border/70 bg-[#071416]" ref={canvasContRef}>
      <GridCanvas3D
        step={activeHour}
        layers={layers}
        width={canvasDims.w}
        height={canvasDims.h}
      />
      
      <div className="absolute left-5 top-5 flex flex-col gap-2 z-10 pointer-events-none">
        <Badge className="w-fit border-primary/30 bg-background/80 text-primary backdrop-blur pointer-events-auto">LIVE MODEL</Badge>
      </div>
      
      <div className="absolute right-5 top-5 flex flex-col gap-2 z-10 bg-background/80 p-2 rounded-md border border-border/70 backdrop-blur">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground px-1 mb-1">Map Layers</span>
        <Button 
          variant={layers.heatmap ? "secondary" : "ghost"} 
          size="sm" 
          className="h-7 justify-start font-mono text-[10px]" 
          onClick={() => setLayers(l => ({ ...l, heatmap: !l.heatmap }))}
        >
          <div className={`mr-2 size-1.5 rounded-full ${layers.heatmap ? 'bg-primary' : 'bg-muted-foreground'}`} />
          PM2.5 Heatmap
        </Button>
        <Button 
          variant={layers.particles ? "secondary" : "ghost"} 
          size="sm" 
          className="h-7 justify-start font-mono text-[10px]" 
          onClick={() => setLayers(l => ({ ...l, particles: !l.particles }))}
        >
          <div className={`mr-2 size-1.5 rounded-full ${layers.particles ? 'bg-primary' : 'bg-muted-foreground'}`} />
          Wind Particles
        </Button>
        <Button 
          variant={layers.pbl ? "secondary" : "ghost"} 
          size="sm" 
          className="h-7 justify-start font-mono text-[10px]" 
          onClick={() => setLayers(l => ({ ...l, pbl: !l.pbl }))}
        >
          <div className={`mr-2 size-1.5 rounded-full ${layers.pbl ? 'bg-primary' : 'bg-muted-foreground'}`} />
          PBL Surface
        </Button>
        <Button 
          variant={layers.plume ? "secondary" : "ghost"} 
          size="sm" 
          className="h-7 justify-start font-mono text-[10px]" 
          onClick={() => setLayers(l => ({ ...l, plume: !l.plume }))}
        >
          <div className={`mr-2 size-1.5 rounded-full ${layers.plume ? 'bg-primary' : 'bg-muted-foreground'}`} />
          Stubble Plumes
        </Button>
      </div>
    </div>
  )
}

function SeverityGauge({ score, label }) { return <div className="relative grid size-28 place-items-center overflow-hidden rounded-full border-[8px] border-accent/20 before:absolute before:inset-[-8px] before:rounded-full before:border-[8px] before:border-transparent before:border-l-primary before:border-t-primary before:rotate-[-30deg]"><div className="text-center"><p className="font-mono text-2xl font-medium">{score}</p><p className="font-mono text-[9px] text-muted-foreground">{label}</p></div></div> }

export default function CoupledSolutionDashboard() {
  const [activeTab, setActiveTab] = useState('coupling')
  const [activeHour, setActiveHour] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1)
  
  const [forecastData, setForecastData] = useState(null)
  const [inversionData, setInversionData] = useState(null)
  const [policyData, setPolicyData] = useState(null)
  const [stubbleData, setStubbleData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const fetchChannel = async (ch, station="DELHI", lat=28.63, lon=77.22) => {
          try {
            const res = await fetch(`http://localhost:8000/api/v1/forecast/station/${station}?channel=${ch}&lat=${lat}&lon=${lon}`);
            if (!res.ok) {
              console.warn(`Failed to fetch channel ${ch} for ${station}: ${res.status}`);
              return { values: Array(72).fill(0) };
            }
            return await res.json();
          } catch (err) {
            console.error(`Error fetching channel ${ch} for ${station}:`, err);
            return { values: Array(72).fill(0) };
          }
        }
        const [pm25, temp, pbl, solar] = await Promise.all([
          fetchChannel(0), fetchChannel(6), fetchChannel(9), fetchChannel(8)
        ]);

        const mergedSeries = pm25.values.map((_, i) => ({
          hour: i,
          pm25: pm25.values[i],
          temp: temp.values[i],
          pbl: pbl.values[i],
          solar: solar.values[i]
        }));
        setForecastData(mergedSeries);

        const invRes = await fetch(`http://localhost:8000/api/v1/alerts/inversion`);
        const invData = await invRes.json();
        setInversionData(invData);

        const polRes = await fetch(`http://localhost:8000/api/v1/policy/grap`);
        const polData = await polRes.json();
        setPolicyData(polData);

        const pm25Punjab = await fetchChannel(0, "PUNJAB", 30.9, 75.8);
        const mergedPlume = pm25.values.map((_, i) => ({
          hour: i,
          punjab: pm25Punjab.values[i],
          delhi: pm25.values[i]
        }));
        setStubbleData(mergedPlume.filter((_, i) => i % 2 === 0).slice(0, 9));

      } catch (err) {
        console.error("Failed to fetch backend data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const timeline = useMemo(() => Array.from({ length: 13 }, (_, i) => i * 6), [])
  useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setActiveHour((hour) => hour >= 71 ? 0 : hour + 3), 900 / speed); return () => window.clearInterval(timer) }, [playing, speed])

  const current = forecastData ? (forecastData.find((item) => item.hour === activeHour) ?? forecastData[0]) : {pm25: 0, pbl: 0, temp: 0, solar: 0};
  const sounding = forecastData ? forecastData.filter((_, i) => i % 2 === 0) : [];
  
  const mainInversion = inversionData?.[0] || { isi_score: 0.697, severity: "MODERATE", pm25_peak: 250, pbl_min: 300 };

  const metricCards = <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Metric label="PM2.5" value={current.pm25} unit="µg/m³" /><Metric label="Solar irradiance" value={current.solar} unit="W/m²" positive trend="+8.4%" /><Metric label="PBL height" value={current.pbl} unit="m" /><Metric label="Temperature" value={current.temp} unit="°C" /></div>
  const couplingView = <><Card className="border-border/70 bg-card/65 p-4">{metricCards}</Card><div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Activity} meta="TEMP / PM2.5 / PBL">Atmospheric Sounding Profile</PanelTitle><AtmosphericChart activeHour={activeHour} data={sounding} /></Card><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Bot} meta="SIH26082">Source Apportionment</PanelTitle><Bars items={[['Stubble', 22], ['Vehicular', 28], ['Road', 22], ['Industrial', 28]]} /></Card></div><Card className="mt-4 border-border/70 bg-card/65 p-4"><PanelTitle icon={BrainCircuit} meta="ML INSIGHT FEED">ML Insight Feed</PanelTitle><div className="grid gap-3 md:grid-cols-3"><Insight title="Coupling stable" text="Meteorology and chemistry feedback remains within confidence bounds." /><Insight title="Plume arrival" text="Northern agricultural pixels are not contributing to the current PM2.5 field." /><Insight title="Next inflection" text="Solar forcing increases after T+18h as the boundary layer recovers." /></div></Card></>
  const inversionView = <><div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><Card className="border-border/70 bg-card/65 p-5"><PanelTitle icon={Gauge} meta="INDEX">Inversion Severity Index</PanelTitle><div className="flex items-center justify-center py-5"><SeverityGauge score={mainInversion.isi_score} label={mainInversion.severity} /></div><p className="text-center font-mono text-[10px] text-muted-foreground">{mainInversion.message || "Stable cap detected across the sounding profile."}</p></Card><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Satellite} meta="AGL / THERMODYNAMIC">Inversion Tracker</PanelTitle><div className="grid gap-4 sm:grid-cols-2"><Metric label="PBL height (min)" value={mainInversion.pbl_min} unit="m" /><Metric label="PM2.5 (peak)" value={mainInversion.pm25_peak} unit="µg/m³" /><Metric label="CAPE" value="−48" unit="J/kg" /><Metric label="ΔT/Δz" value="+2.4" unit="°C/80m" /></div></Card></div><div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Activity} meta="PROFILE TRACE">Atmospheric Sounding Profile</PanelTitle><AtmosphericChart activeHour={activeHour} data={sounding} inversion /></Card><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Radio} meta="TELEMETRY">Inv. Lid telemetry</PanelTitle><div className="flex flex-col gap-4"><Metric label="INV. LID" value="365–485" unit="m" /><Metric label="ΔT/Δz" value="+4.2" unit="°C/100m" positive trend="STABLE" /><Metric label="TRAP EFF." value="54" unit="%" /></div></Card></div></>
  const convlstmView = <><Card className="border-border/70 bg-card/65 p-5"><PanelTitle icon={BrainCircuit} meta="ARCHITECTURE">Model Architecture Flow Diagram</PanelTitle><div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-foreground sm:gap-4">{['Input 12-Ch', 'ConvLSTM Cell×2', 'Spatial Attn', 'Decoder Head'].map((step, i) => <div key={step} className="flex items-center gap-2"><div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-primary">{step}</div>{i < 3 && <span className="text-accent">→</span>}</div>)}</div></Card><div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]"><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Layers3} meta="SIH26082">Model Spec Grid</PanelTitle><div className="grid gap-4 sm:grid-cols-2"><Metric label="Resolution" value="1km × 1km" unit="GRID" /><Metric label="Grid shape" value="70 × 80" unit="CELLS" /><Metric label="Channels" value="12" unit="MET + CHEM" /><Metric label="Horizon" value="72h" unit="AUTOREGRESSIVE" /><Metric label="Parameters" value="~1.2M" unit="TRAINED" /></div></Card><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Activity} meta="FEATURE WEIGHTS">Feature Importance</PanelTitle><div className="h-56"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><BarChart data={[{ name: 'PM2.5', value: 92 }, { name: 'PBL', value: 78 }, { name: 'Solar', value: 61 }, { name: 'Temp', value: 48 }]} layout="vertical" margin={{ left: 4, right: 12 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={55} tick={{ fill: 'var(--muted-foreground)', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} /><Bar dataKey="value" fill="var(--primary)" radius={[0, 3, 3, 0]} barSize={14} /></BarChart></ResponsiveContainer></div></Card></div></>
  const stubbleViewView = <><div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{[['Punjab Fires', '847', 'pixels'], ['Haryana Fires', '312', 'pixels'], ['FRP Mean', '38', 'MW/km²'], ['Wind', '4', 'km/h NW'], ['Arrival ETA', 'T+14', 'hours'], ['PM2.5 Boost', '+0', 'µg/m³']].map(([label, value, unit]) => <Card key={label} className="border-border/70 bg-card/65 p-4"><Metric label={label} value={value} unit={unit} /></Card>)}</div><Card className="mt-4 border-border/70 bg-card/65 p-4"><PanelTitle icon={Wind} meta="TRANSPORT MODEL">Punjab Origin → Delhi NCR</PanelTitle><div className="h-64"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><LineChart data={stubbleData || []} margin={{ left: -25, right: 8 }}><CartesianGrid stroke="var(--border)" strokeOpacity={0.35} vertical={false} /><XAxis dataKey="hour" tickFormatter={(v) => `T+${v}h`} tick={{ fill: 'var(--muted-foreground)', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="punjab" name="Punjab origin" stroke="var(--accent)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="delhi" name="Delhi NCR" stroke="var(--primary)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></Card></>
  
  if (loading) {
    return <div className="h-screen w-full flex items-center justify-center bg-background text-primary font-mono text-sm">INITIALIZING AERIS/OPS DATA FEEDS...</div>
  }

  const aqiScore = policyData ? policyData.worst_case_aqi : 68;
  const grapStage = policyData ? `Stage ${policyData.grap.stage}` : "Stage I";

  return <main className="h-screen w-full overflow-hidden bg-background text-foreground"><header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-xl lg:px-7"><div className="flex items-center gap-5"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"><BrainCircuit className="size-4" /></span><span className="font-sans text-sm font-semibold tracking-tight">AERIS<span className="text-primary">/</span>OPS</span></div><Separator orientation="vertical" className="hidden h-5 md:block" /><div className="hidden items-center gap-2 md:flex"><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Atmospheric Intelligence</span><Badge variant="outline" className="border-primary/30 text-primary">V 2.4.1</Badge></div></div><div className="flex items-center gap-3"><div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" /> SYSTEM NOMINAL</div><Button variant="ghost" size="icon" aria-label="Search"><Search /></Button><Button variant="outline" size="sm"><Settings2 data-icon="inline-start" /> Configure</Button></div></header><div className="mx-auto flex h-[calc(100vh-56px)] flex-col lg:flex-row"><aside className="hidden w-56 shrink-0 overflow-y-auto panel-scroll border-r border-border/60 p-4 lg:block"><div className="mb-7"><p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Workspace</p><p className="mt-2 text-sm font-medium">Pacific Northwest</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">SIH26082 / Forecast</p></div><nav className="flex flex-col gap-1" aria-label="Primary navigation">{navItems.map(({ key, icon: Icon, label }) => <Button key={key} variant="ghost" onClick={() => setActiveTab(key)} aria-current={activeTab === key ? 'page' : undefined} className={`justify-start gap-3 border ${activeTab === key ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}><Icon className="size-3.5" />{label}</Button>)}</nav><Separator className="my-6" /><PanelTitle icon={Radio} meta="SYNCED">Data feeds</PanelTitle><div className="flex flex-col gap-3">{['GOES-18 satellite', 'NOAA / HRRR', 'Urban sensors'].map((feed) => <div key={feed} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-primary" /><span className="font-mono text-[10px] text-muted-foreground">{feed}</span></div>)}</div><div className="mt-auto pt-20"><div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><ShieldCheck className="mb-3 size-4 text-primary" /><p className="font-mono text-[10px] leading-relaxed text-muted-foreground">All model outputs are traceable and confidence-scored.</p></div></div></aside><section className="min-w-0 flex-1 flex flex-col p-4 lg:p-6 overflow-y-auto panel-scroll"><div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{navItems.find((item) => item.key === activeTab)?.label} / Run 0099</span><span className="size-1 rounded-full bg-border" /><span className="font-mono text-[10px] text-muted-foreground">UPDATED 14:32:08 UTC</span></div><h1 className="text-balance font-sans text-2xl font-medium tracking-tight lg:text-3xl">{activeTab === 'stubble' ? 'Stubble plume' : activeTab === 'convlstm' ? 'ConvLSTM grid' : activeTab === 'inversion' ? 'Inversion conditions' : 'Atmospheric conditions'} <span className="text-muted-foreground">in motion.</span></h1></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setActiveHour(0)}><RotateCcw data-icon="inline-start" /> Reset view</Button><Button size="sm" onClick={() => setPlaying(true)}><Zap data-icon="inline-start" /> Run forecast</Button></div></div><div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_270px]">{activeTab === 'coupling' ? <SimulationMap activeHour={activeHour} /> : <div className="min-h-[460px] rounded-lg border border-border/70 bg-[#071416] p-4"><PanelTitle icon={activeTab === 'stubble' ? Wind : activeTab === 'convlstm' ? BrainCircuit : Satellite} meta="SIH26082">Active scientific module</PanelTitle><div className="flex h-[calc(100%-32px)] items-center justify-center"><div className="max-w-md text-center"><div className="mx-auto mb-5 grid size-20 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary"><Activity className="size-8" /></div><p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">{navItems.find((item) => item.key === activeTab)?.label}</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Select the scientific module below to inspect the current SIH26082 model outputs and telemetry.</p></div></div></div>}<div className="flex flex-col gap-4"><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={Gauge} meta="INDEX">Air quality score</PanelTitle><div className="flex items-center gap-4"><div className="relative grid size-24 place-items-center rounded-full border-[7px] border-primary/20 before:absolute before:inset-[-7px] before:rounded-full before:border-[7px] before:border-transparent before:border-t-primary before:border-r-primary"><div className="text-center"><p className="font-mono text-2xl font-medium">{aqiScore}</p><p className="font-mono text-[9px] text-muted-foreground">AQI</p></div></div><div className="flex flex-col gap-2"><Badge className="w-fit border-primary/30 bg-primary/10 text-primary">{grapStage}</Badge><p className="font-mono text-[10px] leading-relaxed text-muted-foreground">Based on worst-case prediction.</p></div></div></Card><Card className="border-border/70 bg-card/65 p-4"><PanelTitle icon={CloudRain} meta="NEXT 72H">Forecast signals</PanelTitle><div className="flex flex-col gap-4"><Metric label="PM 2.5 concentration" value={`${current.pm25}`} unit="µg/m³" trend="+4.2%" /><Metric label="Solar irradiance" value={`${current.solar}`} unit="W/m²" trend="+8.4%" positive /><Metric label="PBL height" value={`${current.pbl}`} unit="m" /></div></Card></div></div><div className="mt-4">{activeTab === 'coupling' ? couplingView : activeTab === 'inversion' ? inversionView : activeTab === 'convlstm' ? convlstmView : stubbleViewView}</div><div className="h-20 shrink-0"></div></section></div><footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur-xl lg:px-7"><div className="mx-auto flex max-w-[1800px] flex-col gap-3 lg:flex-row lg:items-center"><div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="Skip back" onClick={() => setActiveHour(Math.max(0, activeHour - 6))}><SkipBack /></Button><Button size="icon" aria-label={playing ? 'Pause simulation' : 'Play simulation'} onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" aria-label="Skip forward" onClick={() => setActiveHour(Math.min(71, activeHour + 6))}><SkipForward /></Button></div><div className="flex min-w-0 flex-1 items-center gap-3"><div className="hidden shrink-0 sm:block"><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Temporal forecast</p><p className="font-mono text-xs text-primary">T + {String(activeHour).padStart(2, '0')}H</p></div><Slider aria-label="Forecast timeline" value={[activeHour]} min={0} max={71} step={3} onValueChange={(value) => setActiveHour(value[0])} className="min-w-0" /><div className="hidden w-80 shrink-0 justify-between font-mono text-[9px] text-muted-foreground xl:flex">{timeline.map((hour) => <span key={hour} className={hour === activeHour ? 'text-primary' : ''}>+{hour}h</span>)}</div></div><div className="flex items-center justify-between gap-2 sm:justify-end"><span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Playback</span><div className="flex gap-1">{[0.5, 1, 2].map((value) => <Button key={value} variant={speed === value ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 font-mono text-[10px]" onClick={() => setSpeed(value)}>{value}x</Button>)}</div><Badge variant="outline" className="hidden border-primary/30 text-primary sm:flex"><span className="mr-1.5 size-1.5 rounded-full bg-primary" />{playing ? 'PLAYING' : 'PAUSED'}</Badge></div></div></footer></main>
}

function Bars({ items }) { return <div className="flex flex-col gap-4">{items.map(([name, value], i) => <div key={name}><div className="flex items-center justify-between"><p className="text-xs">{name}</p><p className="font-mono text-sm text-primary">{value}%</p></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${i % 2 ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${value}%` }} /></div></div>)}</div> }
function Insight({ title, text }) { return <div className="rounded-md border border-border/60 bg-background/30 p-3"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{title}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{text}</p></div> }
