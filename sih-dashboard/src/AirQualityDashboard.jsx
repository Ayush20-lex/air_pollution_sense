/**
 * SIH26082 — Air Pollution–Weather Coupled Forecasting System
 * Ministry of Earth Sciences (MoES) / NCMRWF — Delhi NCR Focus
 *
 * Design System (ui-ux-pro-max):
 *   Pattern  : Real-Time / Operations Landing (dense, dark)
 *   Style    : Glassmorphism over dark tech base
 *   Colors   : Dark-tech navy (#0F172A bg) + #22C55E status accent
 *   Typography: Fira Code (mono/data) + Fira Sans (labels/UI)
 *   Density  : 10/10 — max dashboard density, 8px rhythm
 *   Motion   : Standard stagger (300-450ms back.out(1.4))
 */

"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Wind,
  Thermometer,
  AlertTriangle,
  Activity,
  Layers,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Gauge,
  Satellite,
  MapPin,
  Radio,
  Zap,
  ArrowUp,
  Clock,
} from "lucide-react";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const T = {
  bg: "#0A0F1E",
  bgCard: "#0F172A",
  bgPanel: "#111827",
  border: "rgba(71,85,105,0.55)",
  accent: "#22C55E",
  accentBlue: "#38BDF8",
  accentAmber: "#F59E0B",
  accentRed: "#EF4444",
  accentPurple: "#A78BFA",
  accentOrange: "#F97316",
  fg: "#F8FAFC",
  fgMuted: "#94A3B8",
  fgDim: "#64748B",
  fontMono: "'Fira Code', 'Courier New', monospace",
  fontSans: "'Fira Sans', 'Inter', system-ui, sans-serif",
};

// ─── AQI Color Scale (CPCB Standard) ─────────────────────────────────────────
const AQI_SCALE = [
  { label: "Good",        min: 0,   max: 50,  color: "#22C55E" },
  { label: "Satisfactory",min: 51,  max: 100, color: "#84CC16" },
  { label: "Moderate",    min: 101, max: 200, color: "#EAB308" },
  { label: "Poor",        min: 201, max: 300, color: "#F97316" },
  { label: "Very Poor",   min: 301, max: 400, color: "#EF4444" },
  { label: "Severe",      min: 401, max: 500, color: "#9F1239" },
];

const getAqiColor = (aqi) => {
  const band = AQI_SCALE.find((b) => aqi >= b.min && aqi <= b.max);
  return band ? band.color : "#9F1239";
};

const getAqiLabel = (aqi) => {
  const band = AQI_SCALE.find((b) => aqi >= b.min && aqi <= b.max);
  return band ? band.label : "Severe";
};

// ─── Realistic Delhi NCR Station Data ────────────────────────────────────────
const NCR_STATIONS = [
  { id:"AV01", name:"Anand Vihar",         lat:28.6469, lon:77.3164, x:62, y:38, pm25:412, pm10:587, o3:48, nox:142, so2:28, co:3.8, temp:15.2, humidity:72, aqi:445, inv:0.91, type:"hotspot" },
  { id:"PB02", name:"Punjabi Bagh",         lat:28.6718, lon:77.1311, x:34, y:29, pm25:358, pm10:498, o3:41, nox:118, so2:22, co:3.1, temp:16.1, humidity:68, aqi:387, inv:0.78, type:"station" },
  { id:"DTU03",name:"DTU",                  lat:28.7501, lon:77.1188, x:32, y:18, pm25:284, pm10:401, o3:35, nox:87,  so2:16, co:2.3, temp:16.8, humidity:65, aqi:302, inv:0.64, type:"station" },
  { id:"OKH04",name:"Okhla Phase 2",        lat:28.5355, lon:77.271,  x:55, y:62, pm25:327, pm10:461, o3:44, nox:103, so2:19, co:2.7, temp:15.8, humidity:71, aqi:352, inv:0.72, type:"station" },
  { id:"GGN05",name:"Gurugram Sec-51",      lat:28.4595, lon:77.0266, x:22, y:72, pm25:298, pm10:432, o3:38, nox:94,  so2:17, co:2.5, temp:17.2, humidity:63, aqi:319, inv:0.67, type:"station" },
  { id:"NOI06",name:"Noida Sec-62",         lat:28.6139, lon:77.364,  x:74, y:45, pm25:342, pm10:476, o3:46, nox:112, so2:21, co:2.9, temp:15.5, humidity:74, aqi:367, inv:0.76, type:"station" },
  { id:"GZB07",name:"Ghaziabad Vasundhara", lat:28.6602, lon:77.3726, x:77, y:32, pm25:389, pm10:541, o3:52, nox:131, so2:25, co:3.4, temp:15.0, humidity:76, aqi:421, inv:0.86, type:"hotspot" },
  { id:"FBD08",name:"Faridabad Sec-16A",    lat:28.4089, lon:77.3178, x:58, y:80, pm25:311, pm10:445, o3:40, nox:98,  so2:18, co:2.6, temp:16.4, humidity:70, aqi:334, inv:0.69, type:"station" },
];

// ─── 72-Hour Temporal Simulation Data ────────────────────────────────────────
const generate72HourData = () => {
  const data = [];
  for (let h = 0; h <= 72; h++) {
    const diurnal = Math.sin(((h % 24) - 6) * (Math.PI / 12));
    const plumeFactor = h >= 12 && h <= 20 ? 1 + (h - 12) * 0.08 : 1;
    const inversionNight = h % 24 >= 22 || h % 24 <= 6 ? 1.15 : 1.0;
    const seed = Math.sin(h * 17.3) * 0.5 + 0.5;
    const aqi  = Math.min(500, Math.max(50,  Math.round(380 * plumeFactor * inversionNight + diurnal * 25 + (seed - 0.5) * 18)));
    const pbl  = Math.min(800, Math.max(200, Math.round(320 * (1 / (plumeFactor * 0.85)) + diurnal * 180)));
    const temp = +(16 + diurnal * 4.5 - (plumeFactor - 1) * 2.2).toFixed(1);
    const pm25 = Math.min(500, Math.max(80,  Math.round(360 * plumeFactor * inversionNight + (seed - 0.5) * 22)));
    const solar = Math.max(0, Math.round(720 - aqi * 1.1));
    const windSpeed = +(3.5 + Math.sin(h * 0.3) * 1.8).toFixed(1);
    data.push({ hour: h, label: `T+${h}h`, aqi, pbl, temp, pm25, solar, windSpeed });
  }
  return data;
};

const TEMPORAL_DATA = generate72HourData();

// ─── Vertical Sounding Profile (Skew-T simplified) ───────────────────────────
const SOUNDING_PROFILE = [
  { alt:0,    temp:15.2, dewpoint:10.1, label:"Surface"         },
  { alt:100,  temp:14.6, dewpoint:9.3                           },
  { alt:200,  temp:14.1, dewpoint:8.7                           },
  { alt:320,  temp:13.8, dewpoint:8.1,  label:"Inversion Lid 320m"},
  { alt:400,  temp:16.2, dewpoint:4.2,  label:"Inversion Layer" },
  { alt:600,  temp:15.4, dewpoint:3.8                           },
  { alt:800,  temp:14.2, dewpoint:3.1                           },
  { alt:1000, temp:12.8, dewpoint:2.5                           },
  { alt:1200, temp:11.1, dewpoint:1.8                           },
  { alt:1500, temp:8.9,  dewpoint:0.9                           },
  { alt:2000, temp:5.3,  dewpoint:-1.2, label:"Free Atmosphere" },
];

const SOURCE_DATA = [
  { name:"Vehicles",       value:31, color:"#F97316" },
  { name:"Industry",       value:24, color:"#A78BFA" },
  { name:"Stubble Burning",value:28, color:"#EF4444" },
  { name:"Dust",           value:12, color:"#F59E0B" },
  { name:"Biomass",        value:5,  color:"#22C55E" },
];

const TIMELINE_EVENTS = [
  { hour:0,  label:"NOW",             color:T.accent,      priority:"normal"   },
  { hour:6,  label:"Dawn Inversion",  color:T.accentAmber, priority:"medium"   },
  { hour:14, label:"Plume Peak",      color:T.accentRed,   priority:"high"     },
  { hour:22, label:"Severe Trap",     color:"#9F1239",     priority:"critical" },
  { hour:36, label:"Wind Shift",      color:T.accentBlue,  priority:"medium"   },
  { hour:48, label:"Partial Clear",   color:T.accent,      priority:"normal"   },
  { hour:60, label:"Second Plume",    color:T.accentRed,   priority:"high"     },
  { hour:72, label:"72h End",         color:T.fgMuted,     priority:"normal"   },
];

// ─── Live Clock Hook ──────────────────────────────────────────────────────────
const useLiveClock = () => {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(id); }, []);
  return time;
};

const formatIST = (d) => d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
const formatUTC = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

// ─── Region A: Top Command Bar ────────────────────────────────────────────────
const CommandBar = ({ currentData, isInversionCritical }) => {
  const time = useLiveClock();
  const [pulse, setPulse] = useState(true);
  useEffect(() => { const id = setInterval(() => setPulse((p) => !p), 600); return () => clearInterval(id); }, []);

  const metrics = [
    { label:"NCR MEAN AQI",   value:currentData.aqi,      unit:"",        color:getAqiColor(currentData.aqi), sub:getAqiLabel(currentData.aqi), Icon:Gauge       },
    { label:"PM₂.₅ SURFACE",  value:currentData.pm25,     unit:"µg/m³",   color:currentData.pm25>300?T.accentRed:T.accentAmber, sub:`NAAQS: 60 µg/m³`, Icon:Activity    },
    { label:"PBL HEIGHT",      value:currentData.pbl,      unit:"m",       color:currentData.pbl<350?T.accentRed:T.accentBlue,   sub:currentData.pbl<350?"⚡ Critical Low":"Compressed",  Icon:ArrowUp     },
    { label:"SOLAR LOSS (AOD)",value:Math.round((1-currentData.solar/720)*100), unit:"%", color:T.accentAmber, sub:`${currentData.solar} W/m² reaching surface`, Icon:Zap  },
    { label:"WIND",            value:currentData.windSpeed, unit:"km/h NW", color:T.accentBlue,   sub:"U:-2.1 V:+3.4 m/s",     Icon:Wind        },
    { label:"NCR TEMP",        value:currentData.temp,     unit:"°C",      color:"#60A5FA",  sub:"Surface Average",             Icon:Thermometer },
  ];

  return (
    <div style={{ background:"linear-gradient(180deg,#070C1A 0%,#0A0F1E 100%)", borderBottom:`1px solid ${T.border}`, fontFamily:T.fontSans }}>
      {/* Header Row */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 12px", borderBottom:`1px solid rgba(71,85,105,0.28)` }}>
        {/* Branding badges */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          {[["MoES","#1D4ED8","#3B82F6"],["NCMRWF","#065F46","#059669"]].map(([label,c1,c2]) => (
            <div key={label} style={{ background:`linear-gradient(135deg,${c1},${c2})`, borderRadius:2, padding:"2px 7px", fontSize:9, fontFamily:T.fontMono, color:"#fff", letterSpacing:"0.08em", fontWeight:700, border:`1px solid ${c2}66` }}>
              {label}
            </div>
          ))}
          <span style={{ color:T.fg, fontSize:11, fontWeight:600, letterSpacing:"0.03em" }}>
            WRF-Chem Coupled Forecasting · Delhi NCR · SIH26082
          </span>
        </div>

        <div style={{ flex:1 }} />

        {/* Engine status */}
        <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(34,197,94,0.07)", border:`1px solid rgba(34,197,94,0.28)`, borderRadius:2, padding:"3px 8px", fontSize:9, fontFamily:T.fontMono }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background:pulse?T.accent:"rgba(34,197,94,0.25)", display:"inline-block", transition:"background 0.3s", boxShadow:pulse?`0 0 6px ${T.accent}`:"none" }} />
          <span style={{ color:T.accent, fontWeight:700 }}>WRF-CHEM COUPLED</span>
          <span style={{ color:T.fgDim }}>· SYNC 100ms · Δt 1km²</span>
        </div>

        {/* Clocks */}
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:10, fontFamily:T.fontMono }}>
          <Clock size={11} color={T.fgDim} />
          <div style={{ textAlign:"right" }}>
            <div style={{ color:T.fgDim, fontSize:8 }}>UTC</div>
            <div style={{ color:T.fg }}>{formatUTC(time)}</div>
          </div>
          <div style={{ width:1, height:22, background:T.border }} />
          <div style={{ textAlign:"right" }}>
            <div style={{ color:T.fgDim, fontSize:8 }}>IST</div>
            <div style={{ color:T.accentBlue }}>{formatIST(time)}</div>
          </div>
        </div>
      </div>

      {/* Emergency Alert Banner */}
      {isInversionCritical && (
        <div style={{ background:"linear-gradient(90deg,rgba(239,68,68,0.18) 0%,rgba(239,68,68,0.06) 100%)", borderBottom:`1px solid rgba(239,68,68,0.45)`, padding:"4px 12px", display:"flex", alignItems:"center", gap:8, animation:"alertPulse 1.5s ease-in-out infinite" }}>
          <AlertTriangle size={12} color={T.accentRed} />
          <span style={{ fontSize:9, fontFamily:T.fontMono, color:T.accentRed, fontWeight:700, letterSpacing:"0.06em" }}>
            ⚠ CRITICAL ATMOSPHERIC INVERSION — PBL HEIGHT {currentData.pbl}m &lt; 350m THRESHOLD · SEVERE POLLUTANT TRAP ACTIVE · OUTDOOR RESTRICTION ADVISED
          </span>
        </div>
      )}

      {/* Metrics ribbon */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)" }}>
        {metrics.map((m, i) => (
          <div key={m.label} style={{ padding:"5px 12px", borderRight:i<5?`1px solid ${T.border}`:"none", display:"flex", flexDirection:"column", gap:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:3, fontSize:8, fontFamily:T.fontMono, color:T.fgDim, letterSpacing:"0.07em" }}>
              <m.Icon size={8} /> {m.label}
            </div>
            <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
              <span style={{ fontSize:17, fontFamily:T.fontMono, fontWeight:700, color:m.color, lineHeight:1, textShadow:`0 0 12px ${m.color}55` }}>{m.value}</span>
              <span style={{ fontSize:9, color:T.fgMuted, fontFamily:T.fontMono }}>{m.unit}</span>
            </div>
            <div style={{ fontSize:8, color:T.fgDim, fontFamily:T.fontMono }}>{m.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Region B: GIS Canvas ─────────────────────────────────────────────────────
const GISCanvas = ({ currentStep, selectedStation, onStationSelect }) => {
  const [layers, setLayers] = useState({ aqiHeatmap:true, windStreamlines:true, stubblePlume:true, pblContours:false });
  const [tooltip, setTooltip] = useState(null);
  const canvasRef   = useRef(null);
  const particlesRef= useRef([]);
  const rafRef      = useRef(null);
  const tRef        = useRef(0);

  // Init wind particles
  useEffect(() => {
    particlesRef.current = Array.from({ length:90 }, () => ({
      x: 90 + Math.random() * 20,
      y: Math.random() * 100,
      vx: -(1.4 + Math.random() * 1.6),
      vy: -(0.7 + Math.random() * 1.3),
      life: Math.random(),
      maxLife: 0.55 + Math.random() * 0.45,
      speed: 0.11 + Math.random() * 0.19,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      const W = canvas.width, H = canvas.height;
      tRef.current += 0.014;
      const t = tRef.current;

      // Background
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, W, H);

      // Grid overlay (1km symbolic)
      ctx.strokeStyle = "rgba(30,41,59,0.65)";
      ctx.lineWidth = 0.5;
      const gs = W / 18;
      for (let x = 0; x <= W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y = 0; y <= H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      // NCR boundary polygon
      ctx.beginPath();
      ctx.moveTo(W*0.08, H*0.12); ctx.lineTo(W*0.92, H*0.10);
      ctx.lineTo(W*0.95, H*0.88); ctx.lineTo(W*0.06, H*0.90);
      ctx.closePath();
      ctx.strokeStyle = "rgba(56,189,248,0.32)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "rgba(15,23,42,0.18)"; ctx.fill();

      // Yamuna river
      ctx.beginPath();
      ctx.moveTo(W*0.60, H*0.05);
      ctx.bezierCurveTo(W*0.62, H*0.30, W*0.58, H*0.60, W*0.61, H*0.92);
      ctx.strokeStyle = "rgba(56,189,248,0.22)"; ctx.lineWidth = 2.5; ctx.stroke();

      // AQI Heatmap blobs
      if (layers.aqiHeatmap) {
        NCR_STATIONS.forEach((s) => {
          const sx=(s.x/100)*W, sy=(s.y/100)*H, col=getAqiColor(s.aqi), r=26+(s.aqi/500)*34;
          const grad = ctx.createRadialGradient(sx,sy,2,sx,sy,r);
          grad.addColorStop(0, col+"99"); grad.addColorStop(0.5, col+"44"); grad.addColorStop(1,"transparent");
          ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.fill();
        });
      }

      // PBL contour isobars
      if (layers.pblContours) {
        [[280,"#EF4444"],[320,"#F97316"],[380,"#EAB308"]].forEach(([pbl,color]) => {
          ctx.beginPath(); ctx.setLineDash([4,4]);
          ctx.strokeStyle=color+"44"; ctx.lineWidth=1;
          ctx.ellipse(W*0.5+Math.sin(t*0.3)*W*0.04, H*0.45, W*0.28+(pbl/500)*W*0.1, H*0.20+(pbl/500)*H*0.06, 0, 0, Math.PI*2);
          ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle=color+"88"; ctx.font=`bold 7px 'Fira Code',monospace`;
          ctx.fillText(`PBL ${pbl}m`, W*0.5+W*0.30, H*0.45);
        });
      }

      // Stubble plume transport
      if (layers.stubblePlume) {
        const ps = Math.min(1, currentStep/14);
        if (ps > 0.05) {
          const grd = ctx.createLinearGradient(0,0,W*0.66,H*0.56);
          grd.addColorStop(0, `rgba(239,68,68,${ps*0.7})`);
          grd.addColorStop(0.6, `rgba(249,115,22,${ps*0.4})`);
          grd.addColorStop(1, `rgba(234,179,8,${ps*0.1})`);
          ctx.beginPath(); ctx.moveTo(W*0.02,H*0.04);
          ctx.bezierCurveTo(W*0.20,H*0.10,W*0.45,H*0.30,W*0.66,H*0.56);
          ctx.lineWidth=14*ps; ctx.strokeStyle=grd; ctx.globalAlpha=0.52; ctx.stroke(); ctx.globalAlpha=1;
          // Origin hotspot
          ctx.beginPath(); ctx.arc(W*0.02+8,H*0.04+8,5+Math.sin(t*4)*2,0,Math.PI*2);
          ctx.fillStyle="#EF4444"; ctx.fill(); ctx.strokeStyle="#FBBF24"; ctx.lineWidth=1.5; ctx.stroke();
          ctx.fillStyle="#EF4444"; ctx.font=`bold 9px 'Fira Code',monospace`;
          ctx.fillText("PUNJAB/HARYANA STUBBLE PLUME",4,14);
        }
      }

      // Wind streamlines (particles)
      if (layers.windStreamlines) {
        particlesRef.current.forEach((p) => {
          const px=(p.x/100)*W, py=(p.y/100)*H, alpha=Math.sin(p.life*Math.PI)*0.65;
          ctx.beginPath(); ctx.arc(px,py,1.3,0,Math.PI*2);
          ctx.fillStyle=`rgba(56,189,248,${alpha})`; ctx.fill();
          p.x+=p.vx*p.speed; p.y+=p.vy*p.speed; p.life+=0.008;
          if (p.life>p.maxLife || p.x<-5 || p.y<-5) {
            p.x=95+Math.random()*10; p.y=Math.random()*100; p.life=0;
          }
        });
      }

      // Station markers
      NCR_STATIONS.forEach((s) => {
        const sx=(s.x/100)*W, sy=(s.y/100)*H, col=getAqiColor(s.aqi);
        const isSel = selectedStation?.id===s.id;
        if (s.type==="hotspot") {
          const pr=13+Math.sin(t*3)*4;
          ctx.beginPath(); ctx.arc(sx,sy,pr,0,Math.PI*2);
          ctx.strokeStyle=col+"55"; ctx.lineWidth=1.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(sx,sy,isSel?7:5,0,Math.PI*2);
        ctx.fillStyle=col; ctx.fill();
        ctx.strokeStyle=isSel?"#fff":"rgba(255,255,255,0.4)"; ctx.lineWidth=isSel?2:1; ctx.stroke();
        ctx.fillStyle=isSel?"#fff":"rgba(248,250,252,0.82)";
        ctx.font=`${isSel?"bold ":""}8px 'Fira Sans',sans-serif`; ctx.fillText(s.name,sx+9,sy+3);
        ctx.fillStyle=col; ctx.font=`bold 7px 'Fira Code',monospace`; ctx.fillText(`AQI ${s.aqi}`,sx+9,sy+12);
      });

      // Map label
      ctx.fillStyle="rgba(248,250,252,0.4)"; ctx.font=`10px 'Fira Sans',sans-serif`;
      ctx.fillText("New Delhi NCR",W*0.40,H*0.44);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layers, currentStep, selectedStation]);

  const handleClick = useCallback((e) => {
    const r=canvasRef.current.getBoundingClientRect();
    const mx=((e.clientX-r.left)/r.width)*100, my=((e.clientY-r.top)/r.height)*100;
    onStationSelect(NCR_STATIONS.find((s)=>Math.hypot(s.x-mx,s.y-my)<5)||null);
  }, [onStationSelect]);

  const handleMove = useCallback((e) => {
    const r=canvasRef.current.getBoundingClientRect();
    const mx=((e.clientX-r.left)/r.width)*100, my=((e.clientY-r.top)/r.height)*100;
    const hit=NCR_STATIONS.find((s)=>Math.hypot(s.x-mx,s.y-my)<5);
    setTooltip(hit?{station:hit,x:e.clientX-r.left,y:e.clientY-r.top}:null);
  },[]);

  const LAYER_CFG = [
    { key:"aqiHeatmap",      label:"AQI Heatmap",     color:"#EF4444"      },
    { key:"windStreamlines", label:"Wind Streamlines", color:T.accentBlue   },
    { key:"stubblePlume",    label:"Stubble Plume",    color:"#F97316"      },
    { key:"pblContours",     label:"PBL Contours",     color:T.accentAmber  },
  ];

  return (
    <div style={{ position:"relative", width:"100%", height:"100%", background:"#030712" }}>
      <canvas
        ref={canvasRef} width={900} height={600}
        onClick={handleClick} onMouseMove={handleMove} onMouseLeave={()=>setTooltip(null)}
        style={{ width:"100%", height:"100%", cursor:"crosshair", display:"block" }}
      />

      {/* Layer Switcher */}
      <div style={{ position:"absolute", top:10, right:10, background:"rgba(7,12,26,0.90)", backdropFilter:"blur(14px)", WebkitBackdropFilter:"blur(14px)", border:`1px solid ${T.border}`, borderRadius:3, padding:"8px 10px", minWidth:162, fontFamily:T.fontSans }}>
        <div style={{ fontSize:8, color:T.fgDim, fontFamily:T.fontMono, letterSpacing:"0.1em", marginBottom:6, display:"flex", alignItems:"center", gap:4 }}>
          <Layers size={8} /> LAYER CONTROL
        </div>
        {LAYER_CFG.map((l) => (
          <div key={l.key} onClick={()=>setLayers((p)=>({...p,[l.key]:!p[l.key]}))} style={{ display:"flex", alignItems:"center", gap:6, padding:"3px 0", cursor:"pointer", opacity:layers[l.key]?1:0.42, transition:"opacity 0.15s" }}>
            <div style={{ width:8, height:8, borderRadius:1, background:layers[l.key]?l.color:T.fgDim, flexShrink:0, transition:"background 0.15s" }} />
            <span style={{ fontSize:10, color:T.fgMuted }}>{l.label}</span>
          </div>
        ))}
        <div style={{ marginTop:8, borderTop:`1px solid ${T.border}`, paddingTop:6 }}>
          <div style={{ fontSize:8, color:T.fgDim, fontFamily:T.fontMono, marginBottom:4 }}>CPCB AQI SCALE</div>
          {AQI_SCALE.map((b) => (
            <div key={b.label} style={{ display:"flex", alignItems:"center", gap:4, marginBottom:2 }}>
              <div style={{ width:6, height:6, borderRadius:1, background:b.color, flexShrink:0 }} />
              <span style={{ fontSize:8, color:T.fgMuted }}>{b.label}</span>
              <span style={{ fontSize:8, color:T.fgDim, marginLeft:"auto", fontFamily:T.fontMono }}>{b.min}–{b.max}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hover Tooltip */}
      {tooltip && (
        <div style={{ position:"absolute", left:tooltip.x+14, top:tooltip.y-10, background:"rgba(7,12,26,0.97)", backdropFilter:"blur(12px)", border:`1px solid ${getAqiColor(tooltip.station.aqi)}55`, borderRadius:3, padding:"8px 10px", minWidth:188, pointerEvents:"none", fontFamily:T.fontMono, fontSize:9, zIndex:50 }}>
          <div style={{ color:T.fg, fontWeight:700, fontSize:10, marginBottom:4, display:"flex", alignItems:"center", gap:4 }}>
            <MapPin size={9} /> {tooltip.station.name}
          </div>
          <div style={{ color:T.fgDim, marginBottom:5, fontSize:8 }}>{tooltip.station.lat.toFixed(4)}°N {tooltip.station.lon.toFixed(4)}°E · {tooltip.station.id}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 10px" }}>
            {[["AQI",tooltip.station.aqi,getAqiColor(tooltip.station.aqi)],["PM₂.₅",`${tooltip.station.pm25}µg/m³`,T.accentRed],["PM₁₀",`${tooltip.station.pm10}µg/m³`,T.accentAmber],["O₃",`${tooltip.station.o3}ppb`,T.accentPurple],["NOx",`${tooltip.station.nox}µg/m³`,"#F59E0B"],["Temp",`${tooltip.station.temp}°C`,"#60A5FA"],["Humidity",`${tooltip.station.humidity}%`,T.accentBlue],["Inv.Idx",tooltip.station.inv.toFixed(2),T.accentOrange]].map(([k,v,c])=>(
              <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:6 }}>
                <span style={{ color:T.fgDim }}>{k}</span>
                <span style={{ color:c, fontWeight:700 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scale bar */}
      <div style={{ position:"absolute", bottom:8, left:8, fontSize:8, fontFamily:T.fontMono, color:T.fgDim, display:"flex", alignItems:"center", gap:4 }}>
        <div style={{ width:32, height:1, background:T.fgDim }} />
        <span>≈5km</span>
        <span style={{ marginLeft:6 }}>Grid 1km×1km</span>
      </div>
    </div>
  );
};

// ─── Region C: Right Telemetry Panel ─────────────────────────────────────────
const TelemetryPanel = ({ currentData, selectedStation }) => {
  const [tab, setTab] = useState(0);
  const TABS = [
    { label:"Two-Way Coupling", Icon:Activity },
    { label:"Vertical Sounding", Icon:ArrowUp  },
    { label:"Source Attribution", Icon:Layers   },
  ];

  const pollutants = [
    { name:"PM₂.₅", value:currentData.pm25, unit:"µg/m³", safe:25,  color:"#EF4444" },
    { name:"PM₁₀",  value:Math.round(currentData.pm25*1.42), unit:"µg/m³", safe:50, color:"#F97316" },
    { name:"O₃",    value:48,               unit:"ppb",    safe:70,  color:"#A78BFA" },
    { name:"NOx",   value:131,              unit:"µg/m³",  safe:40,  color:"#F59E0B" },
    { name:"SO₂",   value:24,              unit:"µg/m³",  safe:20,  color:"#60A5FA" },
    { name:"CO",    value:3.4,             unit:"ppm",    safe:4,   color:"#34D399" },
  ];

  const couplingData = useMemo(() => {
    return TEMPORAL_DATA.slice(Math.max(0, currentData.hour-10), currentData.hour+1).map((d)=>({ hour:d.label, pbl:d.pbl, temp:d.temp }));
  }, [currentData.hour]);

  const solarAttenPct = Math.round((1-currentData.solar/720)*100);
  // SVG arc for gauge
  const gaugeAngle = (solarAttenPct/100)*Math.PI;
  const gx = 8+Math.cos(Math.PI-gaugeAngle)*26, gy = 38-Math.sin(Math.PI-gaugeAngle)*26;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:T.bgPanel, fontFamily:T.fontSans }}>
      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        {TABS.map((t,i)=>(
          <button key={i} onClick={()=>setTab(i)} style={{ flex:1, padding:"6px 2px", background:tab===i?"rgba(34,197,94,0.07)":"transparent", border:"none", borderBottom:tab===i?`2px solid ${T.accent}`:"2px solid transparent", color:tab===i?T.fg:T.fgDim, cursor:"pointer", fontSize:9, fontFamily:T.fontSans, fontWeight:tab===i?600:400, display:"flex", alignItems:"center", justifyContent:"center", gap:3, transition:"all 0.15s" }}>
            <t.Icon size={9} />{t.label}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:8 }}>

        {/* TAB 0 */}
        {tab===0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {/* Solar attenuation */}
            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono, marginBottom:6, letterSpacing:"0.06em" }}>SOLAR ATTENUATION GAUGE (AOD 550nm)</div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <svg width={72} height={48} viewBox="0 0 72 48">
                  <path d="M8 42 A28 28 0 0 1 64 42" fill="none" stroke="rgba(71,85,105,0.4)" strokeWidth="5" strokeLinecap="round"/>
                  <path d={`M8 42 A28 28 0 0 1 ${gx} ${gy}`} fill="none" stroke={solarAttenPct>60?T.accentRed:solarAttenPct>40?T.accentAmber:T.accent} strokeWidth="5" strokeLinecap="round"/>
                  <text x="36" y="37" textAnchor="middle" fill={T.fg} fontSize="12" fontFamily="'Fira Code',monospace" fontWeight="700">{solarAttenPct}%</text>
                  <text x="36" y="47" textAnchor="middle" fill={T.fgDim} fontSize="6" fontFamily="'Fira Code',monospace">BLOCKED</text>
                </svg>
                <div style={{ fontSize:9, color:T.fgMuted, lineHeight:1.7 }}>
                  <div>Surface Irrad: <span style={{ color:T.accentAmber, fontFamily:T.fontMono }}>{currentData.solar} W/m²</span></div>
                  <div>Max (TOA): <span style={{ color:T.fg, fontFamily:T.fontMono }}>720 W/m²</span></div>
                  <div>AOD 550nm: <span style={{ color:T.accentRed, fontFamily:T.fontMono }}>1.42</span></div>
                  <div>Ångström: <span style={{ color:T.fgMuted, fontFamily:T.fontMono }}>0.81</span></div>
                </div>
              </div>
            </div>

            {/* PBL compression chart */}
            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono, marginBottom:4, letterSpacing:"0.06em" }}>PBL COMPRESSION vs GROUND TEMP DROP</div>
              <ResponsiveContainer width="100%" height={95}>
                <LineChart data={couplingData} margin={{ top:2, right:4, left:-22, bottom:0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="rgba(71,85,105,0.18)" />
                  <XAxis dataKey="hour" tick={{ fontSize:7, fill:T.fgDim, fontFamily:T.fontMono }} interval={2} />
                  <YAxis yAxisId="pbl" domain={[200,700]} tick={{ fontSize:7, fill:T.accentBlue, fontFamily:T.fontMono }} />
                  <YAxis yAxisId="temp" orientation="right" domain={[12,22]} tick={{ fontSize:7, fill:"#60A5FA", fontFamily:T.fontMono }} />
                  <Tooltip contentStyle={{ background:T.bgCard, border:`1px solid ${T.border}`, fontSize:8, fontFamily:T.fontMono }} labelStyle={{ color:T.fg }} />
                  <ReferenceLine yAxisId="pbl" y={350} stroke={T.accentRed} strokeDasharray="3 3" strokeWidth={1} />
                  <Line yAxisId="pbl" type="monotone" dataKey="pbl" stroke={T.accentBlue} strokeWidth={1.5} dot={false} name="PBL (m)" />
                  <Line yAxisId="temp" type="monotone" dataKey="temp" stroke="#60A5FA" strokeWidth={1.5} dot={false} name="Temp (°C)" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize:7, color:T.accentRed, fontFamily:T.fontMono, marginTop:2 }}>— Red: Critical PBL threshold 350m · Blue: PBL Height · Dashed: Ground Temp</div>
            </div>

            {/* Pollutant Matrix */}
            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono, marginBottom:6, letterSpacing:"0.06em" }}>POLLUTANT MATRIX · 24h DELTA</div>
              {pollutants.map((p)=>{
                const pct=Math.min(100,(p.value/(p.safe*5))*100), exceed=p.value>p.safe;
                return (
                  <div key={p.name} style={{ marginBottom:5 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                      <span style={{ fontSize:9, color:T.fgMuted, fontFamily:T.fontMono }}>{p.name}</span>
                      <span style={{ fontSize:9, color:p.color, fontFamily:T.fontMono, fontWeight:700 }}>
                        {p.value} {p.unit}
                        {exceed && <span style={{ marginLeft:4, color:T.accentRed, fontSize:8 }}>↑{Math.round((p.value/p.safe-1)*100)}%</span>}
                      </span>
                    </div>
                    <div style={{ height:3, background:"rgba(71,85,105,0.28)", borderRadius:2 }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${p.color}88,${p.color})`, borderRadius:2, transition:"width 0.5s ease" }} />
                    </div>
                    <div style={{ fontSize:7, color:T.fgDim, textAlign:"right", fontFamily:T.fontMono, marginTop:1 }}>Safe: {p.safe} {p.unit}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 1 */}
        {tab===1 && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono, marginBottom:4, letterSpacing:"0.06em" }}>
                ATMOSPHERIC VERTICAL SOUNDING (Skew-T) · Safdarjung Radiosonde
              </div>
              <svg width="100%" viewBox="0 0 265 285" style={{ display:"block" }}>
                {/* Temperature axis lines */}
                {[-5,0,5,10,15,20].map((tmp)=>{
                  const x=30+((tmp+6)/26)*218;
                  return (
                    <g key={tmp}>
                      <line x1={x} y1="8" x2={x} y2="260" stroke="rgba(71,85,105,0.18)" strokeWidth="0.5" strokeDasharray="2,4"/>
                      <text x={x} y="274" fontSize="6" fill={T.fgDim} textAnchor="middle" fontFamily="'Fira Code',monospace">{tmp}°</text>
                    </g>
                  );
                })}
                {/* Altitude axis lines */}
                {[0,500,1000,1500,2000].map((alt)=>{
                  const y=258-(alt/2000)*222;
                  return (
                    <g key={alt}>
                      <line x1="30" y1={y} x2="252" y2={y} stroke="rgba(71,85,105,0.22)" strokeWidth="0.5" strokeDasharray="3,3"/>
                      <text x="26" y={y+3} fontSize="6" fill={T.fgDim} textAnchor="end" fontFamily="'Fira Code',monospace">{alt}</text>
                    </g>
                  );
                })}
                {/* Inversion zone highlight */}
                <rect x="30" y={258-(400/2000)*222} width="222" height={(80/2000)*222} fill="rgba(239,68,68,0.07)" />
                <rect x="30" y={258-(320/2000)*222} width="222" height="1.5" stroke="#EF4444" strokeWidth="1" fill="none" opacity="0.6"/>
                {/* Temperature curve */}
                <polyline
                  points={SOUNDING_PROFILE.map((p)=>`${30+((p.temp+6)/26)*218},${258-(p.alt/2000)*222}`).join(" ")}
                  fill="none" stroke={T.accentRed} strokeWidth="1.8"
                />
                {/* Dewpoint curve */}
                <polyline
                  points={SOUNDING_PROFILE.map((p)=>`${30+((p.dewpoint+6)/26)*218},${258-(p.alt/2000)*222}`).join(" ")}
                  fill="none" stroke={T.accentBlue} strokeWidth="1.6" strokeDasharray="4,2"
                />
                {/* Labeled points */}
                {SOUNDING_PROFILE.filter((p)=>p.label).map((p)=>{
                  const x=30+((p.temp+6)/26)*218, y=258-(p.alt/2000)*222;
                  const isInv=p.label.includes("Inversion");
                  return (
                    <g key={p.label}>
                      <circle cx={x} cy={y} r="2.5" fill={isInv?T.accentRed:T.accent}/>
                      <text x={x+4} y={y+3} fontSize="7" fill={isInv?T.accentRed:T.fg} fontFamily="'Fira Code',monospace" fontWeight={isInv?"bold":"normal"}>{p.label}</text>
                    </g>
                  );
                })}
                {/* Legend */}
                <line x1="32" y1="14" x2="52" y2="14" stroke={T.accentRed} strokeWidth="1.8"/><text x="54" y="17" fontSize="6" fill={T.accentRed} fontFamily="'Fira Code',monospace">Temp</text>
                <line x1="82" y1="14" x2="102" y2="14" stroke={T.accentBlue} strokeWidth="1.6" strokeDasharray="3,2"/><text x="104" y="17" fontSize="6" fill={T.accentBlue} fontFamily="'Fira Code',monospace">Dewpoint</text>
                {/* Axis labels */}
                <text x="140" y="8" fontSize="6" fill={T.fgDim} textAnchor="middle" fontFamily="'Fira Code',monospace">Temperature (°C)</text>
                <text x="-140" y="12" fontSize="6" fill={T.fgDim} textAnchor="middle" fontFamily="'Fira Code',monospace" transform="rotate(-90)">Altitude (m AGL)</text>
                {/* Inversion annotation */}
                <text x="248" y={258-(360/2000)*222} fontSize="7" fill={T.accentRed} textAnchor="end" fontFamily="'Fira Code',monospace" fontWeight="bold">▲ INV. LID</text>
              </svg>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, marginTop:4, paddingTop:5, borderTop:`1px solid ${T.border}` }}>
                {[["Inversion Base","320m AGL",T.accentRed],["Inversion Top","400m AGL",T.accentOrange],["Temp Inv. ΔT","+2.4°C/80m",T.accentAmber],["CAPE","12 J/kg",T.fgMuted],["LCL Height","480m",T.accentBlue],["CIN","-48 J/kg",T.accentPurple]].map(([k,v,c])=>(
                  <div key={k} style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:8, color:T.fgDim, fontFamily:T.fontMono }}>{k}</span>
                    <span style={{ fontSize:8, color:c, fontFamily:T.fontMono, fontWeight:700 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2 */}
        {tab===2 && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono, marginBottom:6, letterSpacing:"0.06em" }}>PM₂.₅ SOURCE APPORTIONMENT</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <PieChart width={100} height={100}>
                  <Pie data={SOURCE_DATA} cx={46} cy={46} innerRadius={28} outerRadius={46} dataKey="value" strokeWidth={0}>
                    {SOURCE_DATA.map((e,i)=><Cell key={i} fill={e.color}/>)}
                  </Pie>
                </PieChart>
                <div style={{ flex:1 }}>
                  {SOURCE_DATA.map((s)=>(
                    <div key={s.name} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                      <div style={{ width:7, height:7, borderRadius:1, background:s.color, flexShrink:0 }}/>
                      <span style={{ fontSize:9, color:T.fgMuted, flex:1 }}>{s.name}</span>
                      <span style={{ fontSize:9, color:s.color, fontFamily:T.fontMono, fontWeight:700 }}>{s.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background:T.bgCard, border:`1px solid rgba(239,68,68,0.32)`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.accentRed, fontFamily:T.fontMono, marginBottom:6, letterSpacing:"0.06em", display:"flex", alignItems:"center", gap:4 }}>
                <Satellite size={9}/>STUBBLE PLUME TRACKER · REAL-TIME
              </div>
              {[
                ["Active Fire Pixels — Punjab",    "847",     "+124 (24h)",    T.accentRed    ],
                ["Active Fire Pixels — Haryana",   "312",     "+48 (24h)",     T.accentOrange ],
                ["Plume Transport Speed",          "18.4 km/h","NW→SE vector", T.accentBlue   ],
                ["Estimated NCR Arrival",          "T+14h",   "±2h window",    T.accentAmber  ],
                ["Peak PM₂.₅ Contribution",        "≈110µg/m³","+28% residue", T.accentRed    ],
                ["Plume Height AGL",               "850–1400m","Above inversion",T.accentPurple],
              ].map(([label,val,delta,color])=>(
                <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:`1px solid rgba(71,85,105,0.18)`, fontSize:8 }}>
                  <span style={{ color:T.fgMuted, fontFamily:T.fontMono }}>{label}</span>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color, fontFamily:T.fontMono, fontWeight:700 }}>{val}</div>
                    <div style={{ color:T.fgDim, fontSize:7 }}>{delta}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:3, padding:8 }}>
              <div style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono, marginBottom:4, letterSpacing:"0.06em" }}>HOURLY SOURCE CONTRIBUTION (µg/m³)</div>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={[
                  { name:"Yesterday",vehicles:118,industry:91,stubble:107,dust:46 },
                  { name:"Now",      vehicles:124,industry:96,stubble:110,dust:52 },
                  { name:"T+6h",     vehicles:118,industry:91,stubble:138,dust:48 },
                  { name:"T+12h",    vehicles:121,industry:94,stubble:162,dust:44 },
                  { name:"T+14h",    vehicles:115,industry:89,stubble:194,dust:42 },
                ]} margin={{ top:2, right:4, left:-24, bottom:0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="rgba(71,85,105,0.18)"/>
                  <XAxis dataKey="name" tick={{ fontSize:7, fill:T.fgDim, fontFamily:T.fontMono }}/>
                  <YAxis tick={{ fontSize:7, fill:T.fgDim, fontFamily:T.fontMono }}/>
                  <Tooltip contentStyle={{ background:T.bgCard, border:`1px solid ${T.border}`, fontSize:8, fontFamily:T.fontMono }}/>
                  <Bar dataKey="vehicles" stackId="a" fill="#F97316" name="Vehicles"/>
                  <Bar dataKey="industry" stackId="a" fill="#A78BFA" name="Industry"/>
                  <Bar dataKey="stubble"  stackId="a" fill="#EF4444" name="Stubble"/>
                  <Bar dataKey="dust"     stackId="a" fill="#F59E0B" name="Dust" radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Selected Station Inspector */}
      {selectedStation && (
        <div style={{ borderTop:`1px solid ${getAqiColor(selectedStation.aqi)}44`, background:`rgba(${selectedStation.aqi>400?"239,68,68":"34,197,94"},0.05)`, padding:"5px 8px", fontSize:9, fontFamily:T.fontMono, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:3 }}>
            <Radio size={9} color={getAqiColor(selectedStation.aqi)}/>
            <span style={{ color:T.fg, fontWeight:700 }}>{selectedStation.name}</span>
            <span style={{ color:T.fgDim, marginLeft:"auto" }}>{selectedStation.id}</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
            {[["AQI",selectedStation.aqi,getAqiColor(selectedStation.aqi)],["PM₂.₅",selectedStation.pm25,T.accentRed],["Temp",`${selectedStation.temp}°`,"#60A5FA"],["Inv.Idx",selectedStation.inv,T.accentOrange]].map(([k,v,c])=>(
              <div key={k}>
                <div style={{ color:T.fgDim, fontSize:7 }}>{k}</div>
                <div style={{ color:c, fontWeight:700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Region D: 72-Hour Temporal Scrubber ─────────────────────────────────────
const TemporalScrubber = ({ currentStep, onStepChange, isPlaying, onPlayToggle, speed, onSpeedChange }) => {
  const trackRef = useRef(null);

  const handleClick = useCallback((e) => {
    const r = trackRef.current.getBoundingClientRect();
    onStepChange(Math.round(Math.max(0, Math.min(1, (e.clientX-r.left)/r.width))*72));
  }, [onStepChange]);

  const curEvent = TIMELINE_EVENTS.find((ev)=>ev.hour===currentStep);
  const step = TEMPORAL_DATA[currentStep] || TEMPORAL_DATA[0];

  return (
    <div style={{ background:"linear-gradient(0deg,#070C1A 0%,#0A0F1E 100%)", borderTop:`1px solid ${T.border}`, padding:"6px 12px", fontFamily:T.fontSans, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
        {/* Playback */}
        <button onClick={()=>onStepChange(Math.max(0,currentStep-1))} style={{ background:"transparent", border:"none", cursor:"pointer", color:T.fgMuted, padding:2 }} title="Step Back"><SkipBack size={12}/></button>
        <button onClick={onPlayToggle} style={{ background:isPlaying?T.accentRed:T.accent, border:"none", cursor:"pointer", color:"#000", padding:"3px 10px", borderRadius:2, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", gap:4 }}>
          {isPlaying?<Pause size={11}/>:<Play size={11}/>}{isPlaying?"PAUSE":"PLAY"}
        </button>
        <button onClick={()=>onStepChange(Math.min(72,currentStep+1))} style={{ background:"transparent", border:"none", cursor:"pointer", color:T.fgMuted, padding:2 }} title="Step Fwd"><SkipForward size={12}/></button>

        {[1,2,5].map((s)=>(
          <button key={s} onClick={()=>onSpeedChange(s)} style={{ background:speed===s?T.secondary:"transparent", border:`1px solid ${speed===s?T.accent:T.border}`, cursor:"pointer", color:speed===s?T.fg:T.fgDim, padding:"2px 5px", borderRadius:2, fontSize:9, fontFamily:T.fontMono }}>
            {s}×
          </button>
        ))}

        <div style={{ width:1, height:16, background:T.border }}/>

        <span style={{ fontSize:9, color:T.fgDim, fontFamily:T.fontMono }}>FORECAST:</span>
        <span style={{ fontSize:14, fontFamily:T.fontMono, fontWeight:700, color:T.accent, textShadow:`0 0 10px ${T.accent}55` }}>T+{currentStep}h</span>
        {curEvent && (
          <div style={{ background:`${curEvent.color}1A`, border:`1px solid ${curEvent.color}44`, borderRadius:2, padding:"1px 6px", fontSize:8, color:curEvent.color, fontFamily:T.fontMono }}>
            ◆ {curEvent.label}
          </div>
        )}
        <div style={{ flex:1 }}/>
        <div style={{ display:"flex", gap:12, fontSize:9, fontFamily:T.fontMono }}>
          {[["AQI",step.aqi,getAqiColor(step.aqi)],["PM₂.₅",`${step.pm25}µg`,T.accentRed],["PBL",`${step.pbl}m`,T.accentBlue],["Temp",`${step.temp}°C`,"#60A5FA"]].map(([k,v,c])=>(
            <div key={k} style={{ display:"flex", gap:4, alignItems:"center" }}>
              <span style={{ color:T.fgDim }}>{k}:</span>
              <span style={{ color:c, fontWeight:700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Event labels */}
      <div style={{ position:"relative", height:18, marginBottom:2 }}>
        {TIMELINE_EVENTS.map((ev)=>(
          <div key={ev.hour} style={{ position:"absolute", left:`${(ev.hour/72)*100}%`, transform:"translateX(-50%)", display:"flex", flexDirection:"column", alignItems:"center" }}>
            <span style={{ fontSize:7, fontFamily:T.fontMono, color:ev.color, whiteSpace:"nowrap", background:"rgba(7,12,26,0.85)", padding:"0 2px", lineHeight:1.5 }}>{ev.label}</span>
            <div style={{ width:1, height:4, background:ev.color }}/>
          </div>
        ))}
      </div>

      {/* Track */}
      <div ref={trackRef} onClick={handleClick} style={{ position:"relative", height:7, background:"rgba(30,41,59,0.85)", borderRadius:3, cursor:"pointer", border:`1px solid ${T.border}` }}>
        {/* AQI waveform */}
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%" }} preserveAspectRatio="none" viewBox="0 0 720 7">
          {TEMPORAL_DATA.map((d,i)=>(
            <rect key={i} x={i*(720/72)} y={0} width={720/72} height={7} fill={getAqiColor(d.aqi)} opacity={0.3+(d.aqi/500)*0.38}/>
          ))}
        </svg>
        {/* Progress */}
        <div style={{ position:"absolute", inset:0, right:`${((72-currentStep)/72)*100}%`, background:"rgba(34,197,94,0.18)", borderRadius:3, transition:"right 0.1s" }}/>
        {/* Playhead */}
        <div style={{ position:"absolute", left:`${(currentStep/72)*100}%`, top:-4, transform:"translateX(-50%)", width:3, height:15, background:T.accent, borderRadius:2, boxShadow:`0 0 8px ${T.accent}`, transition:"left 0.1s" }}/>
      </div>

      {/* Hour ticks */}
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
        {[0,6,12,18,24,30,36,42,48,54,60,66,72].map((h)=>(
          <span key={h} style={{ fontSize:7, fontFamily:T.fontMono, color:T.fgDim }}>T+{h}h</span>
        ))}
      </div>
    </div>
  );
};

// ─── Root Dashboard ───────────────────────────────────────────────────────────
export default function AirPollutionDashboard() {
  const [currentStep,    setCurrentStep]    = useState(0);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [playSpeed,      setPlaySpeed]      = useState(1);
  const [selectedStation,setSelectedStation] = useState(null);
  const intervalRef = useRef(null);

  const currentData = useMemo(() => ({ ...TEMPORAL_DATA[currentStep], hour:currentStep }), [currentStep]);
  const isCritical  = useMemo(() => currentData.pbl<350 || currentData.aqi>400, [currentData]);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentStep((p) => { if (p>=72) { setIsPlaying(false); return 72; } return p+1; });
      }, 1000/playSpeed);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, playSpeed]);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", width:"100vw", background:T.bg, color:T.fg, fontFamily:T.fontSans, overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:rgba(71,85,105,0.5);border-radius:2px;}
        @keyframes alertPulse{0%,100%{opacity:1;}50%{opacity:0.72;}}
        button:focus-visible{outline:2px solid #22C55E;outline-offset:2px;}
      `}</style>

      {/* A: Command Bar */}
      <CommandBar currentData={currentData} isInversionCritical={isCritical}/>

      {/* B + C: Map + Panel */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>
        <div style={{ flex:"0 0 70%", position:"relative", overflow:"hidden" }}>
          <GISCanvas currentStep={currentStep} selectedStation={selectedStation} onStationSelect={setSelectedStation}/>
        </div>
        <div style={{ width:1, background:T.border, flexShrink:0 }}/>
        <div style={{ flex:"0 0 30%", overflow:"hidden", display:"flex", flexDirection:"column" }}>
          <TelemetryPanel currentData={currentData} selectedStation={selectedStation}/>
        </div>
      </div>

      {/* D: Scrubber */}
      <TemporalScrubber
        currentStep={currentStep} onStepChange={setCurrentStep}
        isPlaying={isPlaying} onPlayToggle={()=>setIsPlaying((p)=>!p)}
        speed={playSpeed} onSpeedChange={setPlaySpeed}
      />
    </div>
  );
}
