import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import gsap from 'gsap'
import ScrollTrigger from 'gsap/ScrollTrigger'

import CinematicGlobe from './CinematicGlobe'
import { fetchDashboardData } from '@/lib/api'

gsap.registerPlugin(ScrollTrigger)

function drawTrajectoryChart(canvasId) {
  const canvas = document.getElementById(canvasId)
  if(!canvas) return
  const wrapEl = canvas.parentElement
  if(!wrapEl) return
  
  const dpr = Math.min(window.devicePixelRatio, 2)
  canvas.width = wrapEl.clientWidth * dpr
  canvas.height = wrapEl.clientHeight * dpr
  const ctx = canvas.getContext('2d')
  if(!ctx) return
  
  ctx.scale(dpr, dpr)
  const w = wrapEl.clientWidth, h = wrapEl.clientHeight
  ctx.clearRect(0,0,w,h)

  const N = 40
  const pm = [], wind = []
  for(let i=0;i<N;i++){
    const x = i/(N-1)
    const peak = Math.exp(-Math.pow((x-0.22)/0.16,2))
    const rebound = 0.18*Math.exp(-Math.pow((x-0.75)/0.12,2))
    pm.push(0.28 + 0.62*peak + rebound + 0.03*Math.sin(x*20))
    wind.push(0.12 + 0.10*Math.sin(x*10+1) + 0.05*Math.cos(x*6))
  }

  function drawLine(data, color){
    ctx.beginPath()
    data.forEach((v,i)=>{
      const x = (i/(data.length-1))*w
      const y = h - v*h*0.85 - 8
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  drawLine(wind, '#a1a1aa')
  drawLine(pm, '#fafafa')
}

// Static fallback data used when backend is unavailable
const FALLBACK_CURRENT = { pm25: 107, pbl: 302, temp: 28, solar: 306 }
const FALLBACK_INVERSIONS = [
  { zone_id: 'DELHI-NCR-CENTRAL', severity: 'EMERGENCY', isi_score: 0.85 },
  { zone_id: 'DELHI-NCR-NORTH', severity: 'WARNING', isi_score: 0.78 }
]

export default function CoupledSolutionDashboard() {
  const wrapRef = useRef(null)
  const tooltipRef = useRef(null)
  const [appOpen, setAppOpen] = useState(false)
  const [clockText, setClockText] = useState('LST UPDT: —')
  const [triggerScan, setTriggerScan] = useState(false)

  // API data — starts with fallbacks so the UI always renders
  const [current, setCurrent] = useState(FALLBACK_CURRENT)
  const [inversionData, setInversionData] = useState(FALLBACK_INVERSIONS)
  const [modelStatus, setModelStatus] = useState(null)

  // Fire-and-forget API fetch — UI renders immediately with fallbacks
  useEffect(() => {
    const controller = new AbortController()
    fetchDashboardData().then(result => {
      if (controller.signal.aborted) return
      if (result.fatalError) {
        console.warn('[AirSense] Backend unavailable:', result.fatalError)
        return
      }
      if (result.modelStatus) setModelStatus(result.modelStatus)
      if (result.series?.length > 0) setCurrent(result.series[0])
      if (result.inversionAlerts?.length > 0) setInversionData(result.inversionAlerts)
    }).catch(err => {
      console.warn('[AirSense] Backend unavailable, using fallback data:', err.message)
    })
    return () => controller.abort()
  }, [])

  const mainInversion = inversionData?.[0] ?? null

  const handleScanClick = (e) => {
    e.preventDefault()
    setAppOpen(true)
    document.body.style.overflow = 'hidden'
    const now = new Date()
    setClockText('LST UPDT: ' + now.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', second:'2-digit'}))
    setTimeout(() => drawTrajectoryChart('trajChart2'), 50)
    setTriggerScan(true)
  }

  const handleClose = () => {
    setAppOpen(false)
    document.body.style.overflow = ''
    setTriggerScan(false)
  }

  // Three.js background effect — exact match of reference
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 100)
    camera.position.set(0,0,9)

    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true})
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6))
    renderer.setSize(window.innerWidth, window.innerHeight)
    wrap.appendChild(renderer.domElement)

    const COUNT = 3200
    const cloudPos = new Float32Array(COUNT*3)
    const mapPos = new Float32Array(COUNT*3)
    const colors = new Float32Array(COUNT*3)

    const cCyan = new THREE.Color('#fafafa')
    const cDanger = new THREE.Color('#ef4444')
    const cWarn = new THREE.Color('#f59e0b')
    const cDim = new THREE.Color('#27272a')

    for(let i=0;i<COUNT;i++){
      const r = 2.4*Math.pow(Math.random(),0.5)
      const theta = Math.random()*Math.PI*2
      const phi = Math.acos(2*Math.random()-1)
      cloudPos[i*3]   = r*Math.sin(phi)*Math.cos(theta)
      cloudPos[i*3+1] = r*Math.sin(phi)*Math.sin(theta)*0.7
      cloudPos[i*3+2] = r*Math.cos(phi)

      const gx = (Math.random()-0.5)*11
      const gz = (Math.random()-0.5)*7
      mapPos[i*3]   = gx
      mapPos[i*3+1] = (Math.random()-0.5)*0.15
      mapPos[i*3+2] = gz

      const dHot = Math.hypot(gx-2.3, gz-1.1)
      const dWarn = Math.hypot(gx+2.8, gz+2.0)
      let col
      if(dHot < 2.2) col = cDanger.clone().lerp(cWarn, dHot/2.2)
      else if(dWarn < 2.4) col = cWarn.clone().lerp(cDim, dWarn/2.4)
      else col = cDim.clone().lerp(cCyan, 0.25*Math.random())
      colors[i*3]=col.r; colors[i*3+1]=col.g; colors[i*3+2]=col.b;
    }

    const basePos = new Float32Array(COUNT*3)
    const velocity = new Float32Array(COUNT*3)
    for (let i = 0; i < COUNT * 3; i++) {
      basePos[i] = cloudPos[i]
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(basePos.slice(), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const posAttr = geo.getAttribute('position')

    const hitGeo = new THREE.PlaneGeometry(100, 100)
    const hitMat = new THREE.MeshBasicMaterial({ visible: false })
    const hitPlane = new THREE.Mesh(hitGeo, hitMat)
    scene.add(hitPlane)

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2(-999, -999)

    const mat = new THREE.PointsMaterial({
      size:0.045, vertexColors:true, transparent:true, opacity:0.85,
      depthWrite:false, blending:THREE.AdditiveBlending
    })
    const points = new THREE.Points(geo, mat)
    scene.add(points)

    let idleAngle = 0, dragRotY = 0, dragRotX = 0
    let mouseScreenX = 0, mouseScreenY = 0
    const targetObj = { t: 0 }
    let animationFrameId
    function animate(){
      animationFrameId = requestAnimationFrame(animate)
      idleAngle += 0.0009
      points.rotation.y = idleAngle + dragRotY
      points.rotation.x = dragRotX

      hitPlane.quaternion.copy(camera.quaternion)
      raycaster.setFromCamera(mouse, camera)
      let hoverPoint = null
      const intersects = raycaster.intersectObject(hitPlane)
      if (intersects.length > 0) {
        hoverPoint = points.worldToLocal(intersects[0].point.clone())
      }

      let showTooltip = false
      let tooltipHtml = ''

      if (hoverPoint && targetObj.t > 0.5) {
        const distCentral = Math.hypot(hoverPoint.x - 2.3, hoverPoint.z - 1.1)
        const distNorth = Math.hypot(hoverPoint.x + 2.8, hoverPoint.z + 2.0)
        
        if (distCentral < 2.0) {
          showTooltip = true
          tooltipHtml = '<b>DELHI-NCR-CENTRAL</b>PM2.5: 145 µg/m³<br/><span style="color:var(--danger)">EMERGENCY</span>'
        } else if (distNorth < 2.2) {
          showTooltip = true
          tooltipHtml = '<b>DELHI-NCR-NORTH</b>PM2.5: 85 µg/m³<br/><span style="color:var(--warn)">WARNING</span>'
        }
      }

      if (tooltipRef.current) {
        if (showTooltip && !appOpen) {
          tooltipRef.current.style.opacity = '1'
          tooltipRef.current.style.transform = `translate(${mouseScreenX + 15}px, ${mouseScreenY + 15}px)`
          if (tooltipRef.current.innerHTML !== tooltipHtml) {
            tooltipRef.current.innerHTML = tooltipHtml
          }
        } else {
          tooltipRef.current.style.opacity = '0'
        }
      }

      for (let i = 0; i < COUNT; i++) {
        const i3 = i * 3
        const tx = basePos[i3]
        const ty = basePos[i3+1]
        const tz = basePos[i3+2]
        let px = posAttr.array[i3]
        let py = posAttr.array[i3+1]
        let pz = posAttr.array[i3+2]

        if (hoverPoint) {
          const dx = px - hoverPoint.x
          const dy = py - hoverPoint.y
          const dz = pz - hoverPoint.z
          const distSq = dx*dx + dy*dy + dz*dz
          const minDist = 1.6
          if (distSq < minDist*minDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq)
            const force = (minDist - dist) / minDist
            velocity[i3] += (dx/dist) * force * 0.18
            velocity[i3+1] += (dy/dist) * force * 0.18
            velocity[i3+2] += (dz/dist) * force * 0.18
          }
        }

        velocity[i3] += (tx - px) * 0.08
        velocity[i3+1] += (ty - py) * 0.08
        velocity[i3+2] += (tz - pz) * 0.08

        velocity[i3] *= 0.82
        velocity[i3+1] *= 0.82
        velocity[i3+2] *= 0.82

        posAttr.array[i3] += velocity[i3]
        posAttr.array[i3+1] += velocity[i3+1]
        posAttr.array[i3+2] += velocity[i3+2]
      }
      posAttr.needsUpdate = true

      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      camera.aspect = window.innerWidth/window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
      drawTrajectoryChart('trajChart')
      drawTrajectoryChart('trajChart2')
    }
    window.addEventListener('resize', handleResize)

    function morphTo(t){
      for(let i=0;i<COUNT*3;i++){
        basePos[i] = cloudPos[i]*(1-t) + mapPos[i]*t
      }
    }

    const tl = gsap.timeline({
      scrollTrigger:{ trigger:'.hero-pin', start:'top top', end:'bottom bottom', scrub:0.8 }
    })

    tl.to('.eyebrow',{opacity:1, duration:0.08})
      .to('.title',{opacity:1, duration:0.1},'<0.02')
      .to('.sub',{opacity:1, duration:0.1},'<0.02')
      .to('.stat-row',{opacity:1, duration:0.1},'<0.05')
      .to('#scrollhint',{opacity:0, duration:0.05})
      .to(camera.position,{x:0, y:5.5, z:13, duration:0.4, ease:'power2.inOut',
          onUpdate:()=>camera.lookAt(0,0,0)},'>')
      .to(targetObj,{t:1, duration:0.4, ease:'power2.inOut',
          onUpdate:()=>{ morphTo(targetObj.t) } },'<')
      .to('.hero-copy',{opacity:0, y:-40, duration:0.2},'<')
      .to('.stat-row',{opacity:0, duration:0.15},'<')
      .to('#tag-central',{opacity:1, duration:0.1},'-=0.15')
      .to('#tag-north',{opacity:1, duration:0.1},'<0.05')
      .to(camera.position,{y:8, z:9, duration:0.3, ease:'power1.inOut',
          onUpdate:()=>camera.lookAt(0,0,0)},'>')
      .to(mat,{opacity:0.35, duration:0.2},'<0.1')
      .to(['#tag-central','#tag-north'],{opacity:0, duration:0.15},'<')

    gsap.to('.panel', {
      opacity:1, y:0, duration:0.7, stagger:0.12, ease:'power2.out',
      scrollTrigger:{ trigger:'.dash', start:'top 75%' }
    })
    gsap.to('.cta-row',{
      opacity:1, duration:0.6,
      scrollTrigger:{ trigger:'.cta-row', start:'top 90%' }
    })
    gsap.to('#dragHint',{
      opacity:1, duration:0.6,
      scrollTrigger:{ trigger:'.dash-head', start:'top 80%' }
    })

    let isDragging = false, prevX = 0, prevY = 0
    const MAX_TILT = 0.5

    const onPointerDown = (e)=>{
      isDragging = true; prevX = e.clientX; prevY = e.clientY;
      wrap.classList.add('dragging')
    }
    const onPointerUp = ()=>{ isDragging = false; wrap.classList.remove('dragging') }
    const onPointerMove = (e)=>{
      mouseScreenX = e.clientX
      mouseScreenY = e.clientY
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
      if(!isDragging) return
      const dx = e.clientX - prevX, dy = e.clientY - prevY
      prevX = e.clientX; prevY = e.clientY
      dragRotY += dx * 0.004
      dragRotX = Math.max(-MAX_TILT, Math.min(MAX_TILT, dragRotX + dy * 0.003))
    }
    const onPointerLeave = () => { mouse.set(-999, -999) }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointermove', onPointerMove)

    setTimeout(() => {
      drawTrajectoryChart('trajChart')
      drawTrajectoryChart('trajChart2')
    }, 50)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      cancelAnimationFrame(animationFrameId)
      tl.kill()
      ScrollTrigger.getAll().forEach(t => t.kill())
      renderer.dispose()
      geo.dispose()
      mat.dispose()
      if (wrap) wrap.innerHTML = ''
    }
  }, [])

  return (
    <>
      <div 
        id="canvas-wrap" 
        ref={wrapRef} 
        style={{ opacity: appOpen ? 0 : 1, transition: 'opacity 0.5s ease', pointerEvents: appOpen ? 'none' : 'auto' }}
      ></div>
      
      {/* MapLibre Globe layer - visible when appOpen is true */}
      <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ opacity: appOpen ? 1 : 0, transition: 'opacity 0.5s ease', pointerEvents: appOpen ? 'auto' : 'none' }}>
        {triggerScan && <CinematicGlobe step={0} triggerScan={triggerScan} layers={{ heatmap: true, particles: true, pbl: true, plume: true }} />}
      </div>

      <div ref={tooltipRef} className="particle-tooltip" style={{ display: appOpen ? 'none' : 'block' }}></div>

      <div className="hero-pin">
        <div className="hero-stage">
          <div className="hero-copy">
            <h1 className="title">AirSense / NCR</h1>
            <p className="sub">Two-way aerosol–weather coupling for Delhi NCR — predicting how pollution suppresses irradiance, lowers the boundary layer, and traps itself in a feedback loop.</p>
          </div>
          <div className="stat-row">
            <div className="stat"><div className="num">{current.pm25}</div><div className="lbl">PM2.5 µg/m³</div></div>
            <div className="stat"><div className="num">{current.pbl}</div><div className="lbl">PBL HEIGHT m</div></div>
            <div className="stat"><div className="num">{mainInversion ? mainInversion.isi_score.toFixed(2) : '0.85'}</div><div className="lbl">INVERSION IDX</div></div>
          </div>
          <div className="zone-tag" id="tag-central">DELHI-NCR-CENTRAL &middot; EMERGENCY</div>
          <div className="zone-tag warn" id="tag-north">DELHI-NCR-NORTH &middot; WARNING</div>
          <div className="scroll-hint" id="scrollhint">SCROLL</div>
        </div>
      </div>

      <div className="dash">
        <div className="dash-head" style={{position:'relative'}}>
          <h2>LOCAL FORECAST COUPLED</h2>
          <div className="tag">T+27H PROJECTION</div>
          <div className="drag-hint" id="dragHint"><span>⟲</span> DRAG BACKGROUND TO ROTATE</div>
        </div>
        <div className="grid">
          <div className="panel" data-p="1">
            <h3>CURRENT TELEMETRY <span>T+0H</span></h3>
            <div className="metric-row"><span>PM2.5 AVG</span><span><span className="val">{current.pm25}</span><span className="unit">µg/m³</span></span></div>
            <div className="metric-row"><span>PBL HEIGHT</span><span><span className="val">{current.pbl}</span><span className="unit">m</span></span></div>
            <div className="metric-row"><span>TEMPERATURE</span><span><span className="val">{current.temp}</span><span className="unit">°C</span></span></div>
            <div className="metric-row"><span>SOLAR IRR.</span><span><span className="val">{current.solar}</span><span className="unit">W/m²</span></span></div>
          </div>
          <div className="panel" data-p="2">
            <h3>72H TRAJECTORY <span className="chart-peak">PEAK @ T+15h</span></h3>
            <div className="chart-wrap"><canvas id="trajChart"></canvas></div>
            <div className="chart-axis"><span>+12h</span><span>+24h</span><span>+36h</span><span>+48h</span><span>+66h</span></div>
            <div className="legend-row">
              <span><i className="dot" style={{background:'var(--text)'}}></i>PM2.5</span>
              <span><i className="dot" style={{background:'var(--text-dim)'}}></i>WIND</span>
            </div>
          </div>
          <div className="panel" data-p="3">
            <h3>ATMOSPHERIC DRIVERS <span>AUTO-ANALYSIS</span></h3>
            <div className="note"><b>TWO-WAY COUPLING</b><br/>Aerosol load suppresses solar irradiance, which lowers the PBL and traps more pollution — a self-reinforcing feedback loop.</div>
            <div className="note danger"><b>INVERSION TRAP</b><br/>Critical inversion detected (ISI: {mainInversion ? mainInversion.isi_score.toFixed(2) : '0.85'}). Low PBL and stagnation are severely restricting ventilation.</div>
          </div>
          <div className="panel" data-p="4">
            <h3>INVERSION RISK <span>ISI &gt; 0.75</span></h3>
            {inversionData.slice(0, 2).map((zone) => (
              <div key={zone.zone_id} className="metric-row">
                <span>{zone.zone_id}</span>
                <span style={{color: zone.severity === 'EMERGENCY' ? 'var(--danger)' : 'var(--warn)'}}>{zone.severity}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cta-row">
          <button className="btn" id="scanBtn" onClick={handleScanClick}>SCAN NCR →</button>
        </div>
      </div>

      <div id="appView" className={appOpen ? 'open' : ''}>
        <div className="app-topbar">
          <span className="app-back" id="appBack" onClick={handleClose}>←</span>
          <div className="app-logo">AirSense / NCR</div>
          <div className="app-sub hidden sm:block">COUPLED FORECASTING SYSTEM V4.2</div>
          <div className="app-right">
            <span className="badge-demo hidden sm:block">● DEMO / SYNTHETIC</span>
            <span id="appClock">{clockText}</span>
          </div>
        </div>

        <div className="app-body">
          <div className="app-col">
            <div className="panel dash-panel" style={{ transitionDelay: '0.1s' }}>
              <h3>CURRENT TELEMETRY <span>T+0H</span></h3>
              <div className="metric-row"><span>PM2.5 AVG</span><span><span className="val">{current.pm25}</span><span className="unit">µg/m³</span></span></div>
              <div className="metric-row"><span>PBL HEIGHT</span><span><span className="val">{current.pbl}</span><span className="unit">m</span></span></div>
              <div className="metric-row"><span>TEMPERATURE</span><span><span className="val">{current.temp}</span><span className="unit">°C</span></span></div>
              <div className="metric-row"><span>SOLAR IRR.</span><span><span className="val">{current.solar}</span><span className="unit">W/m²</span></span></div>
            </div>
            <div className="panel dash-panel" style={{ transitionDelay: '0.2s' }}>
              <h3>72H TRAJECTORY <span className="chart-peak">PEAK @ T+15h</span></h3>
              <div className="chart-wrap"><canvas id="trajChart2"></canvas></div>
              <div className="chart-axis"><span>+12h</span><span>+24h</span><span>+36h</span><span>+48h</span><span>+66h</span></div>
              <div className="legend-row">
                <span><i className="dot" style={{background:'var(--text)'}}></i>PM2.5</span>
                <span><i className="dot" style={{background:'var(--text-dim)'}}></i>WIND</span>
              </div>
            </div>
          </div>

          <div className="app-col app-center">
            <div className="mode-row dash-anim" style={{ transitionDelay: '0.15s' }}>
              <div className="mode-pill active">PM2.5</div>
              <div className="mode-pill">WIND</div>
              <div className="mode-pill">PBL</div>
              <div className="mode-pill">PLUME</div>
            </div>
            <div className="status-pill dash-anim" style={{ transitionDelay: '0.25s' }}>LOCAL FORECAST COUPLED</div>
          </div>

          <div className="app-col">
            <div className="panel dash-panel" style={{ transitionDelay: '0.2s' }}>
              <h3>ATMOSPHERIC DRIVERS <span>AUTO-ANALYSIS</span></h3>
              <div className="note"><b>TWO-WAY COUPLING</b><br/>Aerosol load suppresses solar irradiance, which lowers the PBL and traps more pollution — a self-reinforcing feedback loop.</div>
              <div className="note danger"><b>INVERSION TRAP</b><br/>Critical inversion detected (ISI: {mainInversion ? mainInversion.isi_score.toFixed(2) : '0.85'}). Low PBL and stagnation are severely restricting ventilation.</div>
            </div>
            <div className="panel dash-panel" style={{ transitionDelay: '0.3s' }}>
              <h3>INVERSION RISK <span>ISI &gt; 0.75</span></h3>
              {inversionData.slice(0, 2).map((zone) => (
                <div key={zone.zone_id} className="metric-row">
                  <span>{zone.zone_id}</span>
                  <span style={{color: zone.severity === 'EMERGENCY' ? 'var(--danger)' : 'var(--warn)'}}>{zone.severity}</span>
                </div>
              ))}
            </div>
            <div className="panel dash-panel" style={{ transitionDelay: '0.4s' }}>
              <h3>DATA LINEAGE <span>SYSTEM</span></h3>
              <div className="lineage-line"><span>SOURCE</span><b>{modelStatus?.sources?.cpcb_waqi || 'CPCB + IMD MERGED'}</b></div>
              <div className="lineage-line"><span>MODEL</span><b>{modelStatus?.model_name || 'WRF-CHEM COUPLED V4.2'}</b></div>
              <div className="lineage-line"><span>LATENCY</span><b>340ms</b></div>
              <div className="lineage-line"><span>CONFIDENCE</span><b>91%</b></div>
            </div>
          </div>
        </div>

        <div className="app-timeline">
          <div className="tl-top"><span className="now">T+0H PROJECTION</span><span>TOTAL DOMAIN: 72H</span></div>
          <div className="tl-controls">
            <div className="tl-btn">⏮</div>
            <div className="tl-btn play">▶</div>
            <div className="tl-btn">⏭</div>
            <div className="tl-track"><div className="tl-fill"></div></div>
            <div className="tl-speed"><span>0.5x</span><span className="active">1.0x</span><span>2.0x</span></div>
          </div>
          <div className="tl-ticks"><span>+0h</span><span>+12h</span><span>+24h</span><span>+36h</span><span>+48h</span><span>+60h</span><span>+72h</span></div>
        </div>
      </div>
    </>
  )
}
