import * as THREE from 'three';
import * as React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { useTheme } from 'next-themes';
import { PARTICLE } from '@/lib/tokens';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { seeded } from '@/lib/utils';

const COUNT = 9200;
/** Radius of the aerosol globe, in world units. */
const RADIUS = 2.45;
/** Golden angle — the spacing that keeps a Fibonacci sphere free of seams. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Low-frequency field over the sphere. Three rotated sine lobes stand in for
 * fbm noise: enough to break the globe into continent-sized clean and loaded
 * regions, cheap enough to evaluate once per particle at build time.
 */
function loadAt(x: number, y: number, z: number) {
  const v =
    Math.sin(x * 2.1 + z * 1.3) * 0.45 +
    Math.sin(y * 3.3 - x * 1.7) * 0.33 +
    Math.sin(z * 2.7 + y * 2.1) * 0.22;
  return Math.min(1, Math.max(0, 0.5 + v * 0.5));
}

/** Round, soft-edged sprite so points read as aerosol, not squares. */
function makeSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/** Live scroll position, 0 at the top of the intro track and 1 at its end. */
export type ProgressRef = React.MutableRefObject<number>;

type CloudProps = { dispersing: boolean; dark: boolean; progress?: ProgressRef };

/**
 * PM2.5 aerosol cloud: a stratified slab of particles (dense near the surface,
 * thinning above the inversion) that drifts, breathes and disperses on scan.
 */
function AerosolCloud({ dispersing, dark, progress }: CloudProps) {
  const points = React.useRef<THREE.Points>(null);
  const sprite = React.useMemo(() => makeSprite(), []);
  const eased = React.useRef(0);

  const { positions, colors, seeds } = React.useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);

    // Light mode needs deeper pigments: the neon set greys out against white.
    const p = dark ? PARTICLE.dark : PARTICLE.light;
    const good = new THREE.Color(p.good);
    const warn = new THREE.Color(p.warn);
    const bad = new THREE.Color(p.bad);
    const cool = new THREE.Color(p.cool);
    const tmp = new THREE.Color();

    for (let i = 0; i < COUNT; i++) {
      // Fibonacci lattice: even coverage of the sphere, with none of the
      // polar clustering naive lat/long sampling produces.
      const t = i / (COUNT - 1);
      const dy = 1 - t * 2;
      const ring = Math.sqrt(Math.max(0, 1 - dy * dy));
      const theta = GOLDEN_ANGLE * i;
      const dx = Math.cos(theta) * ring;
      const dz = Math.sin(theta) * ring;

      // Most mass sits in a thin shell; the rest drifts inside as depth haze.
      const u = seeded(i * 2.71);
      const shell =
        u < 0.78 ? 0.94 + seeded(i * 5.19) * 0.06 : Math.pow(seeded(i * 7.13), 0.4) * 0.9;
      const rad = RADIUS * shell;

      positions[i * 3] = dx * rad;
      positions[i * 3 + 1] = dy * rad;
      positions[i * 3 + 2] = dz * rad;

      seeds[i * 3] = seeded(i * 7.77);
      seeds[i * 3 + 1] = seeded(i * 9.11);
      seeds[i * 3 + 2] = seeded(i * 11.31);

      // Pollution patches over the globe -> colour ramps good -> emergency
      const load = loadAt(dx * 2, dy * 2, dz * 2);
      if (load > 0.82) tmp.copy(bad);
      else if (load > 0.6) tmp.lerpColors(warn, bad, (load - 0.6) / 0.22);
      else if (load > 0.35) tmp.lerpColors(cool, warn, (load - 0.35) / 0.25);
      else tmp.lerpColors(good, cool, load / 0.35);

      // Interior haze sits behind the shell, so cool and dim it for depth.
      if (u >= 0.78) tmp.lerp(cool, 0.32).multiplyScalar(0.7);

      // A small fraction burn bright as "hot" monitored parcels
      const hot = seeded(i * 13.7) > 0.965;
      if (hot) tmp.lerp(new THREE.Color(p.hot), 0.5);

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
      sizes[i] = hot ? 0.09 : 0.02 + seeded(i * 17.3) * 0.04;
    }
    return { positions, colors, seeds, sizes };
  }, [dark]);

  const base = React.useMemo(() => positions.slice(), [positions]);

  useFrame((state, delta) => {
    const p = points.current;
    if (!p) return;
    const t = state.clock.elapsedTime;
    const arr = p.geometry.attributes.position.array as Float32Array;

    // Scroll drives a slow, continuous spread; the scan click overrides it
    // with a fast full blast. Whichever is further along wins.
    const scrolled = (progress?.current ?? 0) * 0.82;
    const target = Math.max(dispersing ? 1 : 0, scrolled);
    eased.current += (target - eased.current) * Math.min(1, delta * (dispersing ? 1.9 : 6));
    const d = eased.current;

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      const sx = seeds[ix];
      const sy = seeds[ix + 1];
      const sz = seeds[ix + 2];

      // Slow advective drift + turbulent wobble.
      const drift = Math.sin(t * 0.22 + sx * 6.28) * 0.09;
      const wobble = Math.sin(t * 0.6 + sy * 6.28) * 0.045;
      const rise = Math.sin(t * 0.35 + sz * 6.28) * 0.06;

      const bx = base[ix];
      const by = base[ix + 1];
      const bz = base[ix + 2];

      // Radial blast-out during the scan transition.
      const blast = d * (2.6 + sx * 5.5);
      const len = Math.hypot(bx, by, bz) || 1;

      arr[ix] = bx + drift + (bx / len) * blast;
      arr[ix + 1] = by + rise + (by / len) * blast;
      arr[ix + 2] = bz + wobble + (bz / len) * blast;
    }
    p.geometry.attributes.position.needsUpdate = true;

    // Gentle autorotation; accelerates as the field breaks apart.
    p.rotation.y += delta * (0.045 + d * 0.9);

    const mat = p.material as THREE.PointsMaterial;
    mat.opacity = (dark ? 0.95 : 0.9) * (1 - d * 0.95);
    mat.size = 0.055 + d * 0.05;
  });

  return (
    <points ref={points} frustumCulled={false} rotation={[0, 0, 0.22]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={sprite}
        size={0.055}
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        sizeAttenuation
        blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  );
}

/** Orbital scan ring — the inversion cap, wrapped around the globe. */
function ScanRing({ dark, dispersing, progress }: CloudProps) {
  const ref = React.useRef<THREE.Mesh>(null);
  useFrame((state, delta) => {
    if (!ref.current) return;
    const m = ref.current.material as THREE.MeshBasicMaterial;
    const faded = 1 - Math.min(1, (progress?.current ?? 0) * 1.6);
    const target = dispersing ? 0 : (dark ? 0.22 : 0.16) * faded;
    m.opacity += (target - m.opacity) * Math.min(1, delta * 3);
    ref.current.rotation.z += delta * 0.1;
    ref.current.rotation.x = -Math.PI / 2 + Math.sin(state.clock.elapsedTime * 0.25) * 0.07;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[RADIUS * 1.16, RADIUS * 1.19, 128]} />
      <meshBasicMaterial
        color={dark ? PARTICLE.dark.cool : PARTICLE.light.cool}
        transparent
        opacity={0.2}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Mouse-parallax rig + scan camera dolly. */
function Rig({ dispersing, progress }: { dispersing: boolean; progress?: ProgressRef }) {
  const { camera, pointer } = useThree();
  const group = React.useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 2.4);
    // Tilt the whole field toward the cursor.
    if (group.current) {
      group.current.rotation.x += (-pointer.y * 0.22 - group.current.rotation.x) * k;
      group.current.rotation.z += (pointer.x * 0.1 - group.current.rotation.z) * k;
    }
    // Scrolling dollies the camera in and lifts it, so the field opens out
    // beneath the content rising over it.
    const p = progress?.current ?? 0;
    const targetZ = dispersing ? 0.35 : 5.5 - pointer.y * 0.25 - p * 2.6;
    const targetY = dispersing ? 0.1 : 0.55 + pointer.y * 0.2 + p * 0.9;
    // Mutating the camera inside useFrame is how R3F drives a camera; the rule
    // cannot see that this runs in a frame loop rather than during render.
    // Setting camera state through React would re-render sixty times a second.
    // oxlint-disable-next-line react/immutability
    camera.position.z += (targetZ - camera.position.z) * Math.min(1, delta * (dispersing ? 2.1 : 1.6));
    camera.position.y += (targetY - camera.position.y) * Math.min(1, delta * 1.6);
    camera.position.x += (pointer.x * 0.7 - camera.position.x) * Math.min(1, delta * 1.6);
    camera.lookAt(0, 0, 0);
  });

  return (
    <group ref={group}>
      <AerosolCloudWrapper dispersing={dispersing} progress={progress} />
    </group>
  );
}

function AerosolCloudWrapper({ dispersing, progress }: { dispersing: boolean; progress?: ProgressRef }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== 'light';
  return (
    <>
      <AerosolCloud dispersing={dispersing} dark={dark} progress={progress} />
      <ScanRing dispersing={dispersing} dark={dark} progress={progress} />
    </>
  );
}

export function ParticleField({ dispersing, progress }: { dispersing: boolean; progress?: ProgressRef }) {
  // Gate 27: the canvas is continuous motion, so honour the OS setting by
  // rendering a single static frame instead of running the loop.
  const reduced = usePrefersReducedMotion();

  return (
    <Canvas
      aria-hidden
      frameloop={reduced ? 'demand' : 'always'}
      className="!absolute inset-0"
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0.55, 5.5], fov: 55, near: 0.01, far: 100 }}
    >
      <Rig dispersing={dispersing} progress={progress} />
      <AdaptiveDpr pixelated />
      <Preload all />
    </Canvas>
  );
}
