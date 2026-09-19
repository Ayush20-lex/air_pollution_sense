import * as THREE from 'three';
import * as React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { useTheme } from 'next-themes';
import { PARTICLE } from '@/lib/tokens';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { LAND_FRACTION, isLandAtDirection } from '@/lib/earth-mask';
import { seeded } from '@/lib/utils';

const COUNT = 34000;

/**
 * Share of points that should land on land.
 *
 * Land is 29% of Earth, so even coverage spends 71% of the budget on ocean —
 * which is the part with nothing to say. Oversampling the lattice and
 * discarding most ocean candidates buys continent definition at the same
 * point count and the same per-frame cost, since the frame loop walks COUNT
 * either way.
 *
 * Ocean is thinned, never emptied: without it the globe stops being a globe
 * and becomes a handful of floating continents.
 */
const LAND_SHARE = 0.94;
/**
 * Candidate lattice size, sized so the two quotas meet exactly.
 *
 * It cannot simply be "generous". The lattice runs pole to pole in order, so
 * a lattice that offers more points than COUNT stops early and the points it
 * never reaches are the last ones — the south polar cap. Oversampling by a
 * round 2.2x shaved Antarctica off the globe. Solving for the exact size
 * means the loop runs to the end.
 */
const CANDIDATES = Math.ceil((COUNT * LAND_SHARE) / LAND_FRACTION);
/**
 * Probability an ocean candidate survives.
 *
 * Solved rather than tuned: the lattice offers CANDIDATES * (1 - LAND_FRACTION)
 * ocean points and the quota needs COUNT * (1 - LAND_SHARE) of them. Written
 * this way, changing LAND_SHARE changes the globe and nothing else has to be
 * re-guessed.
 */
const OCEAN_KEEP =
  (COUNT * (1 - LAND_SHARE)) / (CANDIDATES * (1 - LAND_FRACTION));
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

/**
 * The globe's material.
 *
 * A PointsMaterial with its vertex stage rewritten, rather than a
 * ShaderMaterial from scratch: three's own chunks still handle point sizing,
 * tone mapping and colour space, and only the two things they cannot do are
 * injected.
 *
 * 1. Displacement. Drift, wobble and the radial blast used to run in a JS
 *    loop over every point every frame. That loop, not the renderer, was the
 *    ceiling on point count — and this look needs roughly four times the
 *    points. On the GPU the cost is the same whether there are 9000 or 34000.
 *
 * 2. Depth fade, which is the reason the globe did not read as Earth. Points
 *    are transparent and write no depth, so the far hemisphere drew straight
 *    through the near one: measured at 3035 far-side points over 4078
 *    near-side, with Africa laid over the Pacific. Fading by view-space
 *    facing is what turns a cloud of dots into a sphere with a front.
 *
 * The fade relaxes to nothing as the field disperses. Once the points have
 * left the sphere there is no near or far side to respect, and holding the
 * fade would make half the blast vanish.
 */
function makeGlobeMaterial(sprite: THREE.Texture, dark: boolean) {
  const material = new THREE.PointsMaterial({
    map: sprite,
    size: dark ? 0.019 : 0.021,
    transparent: true,
    opacity: dark ? 0.95 : 0.9,
    depthWrite: false,
    sizeAttenuation: true,
    blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const uniforms = {
    uTime: { value: 0 },
    uDisperse: { value: 0 },
  };
  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDisperse = uniforms.uDisperse;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aSeed;
         attribute vec3 aColor;
         uniform float uTime;
         uniform float uDisperse;
         varying float vFade;
         varying vec3 vTint;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
         float drift  = sin(uTime * 0.22 + aSeed.x * 6.28) * 0.09;
         float wobble = sin(uTime * 0.60 + aSeed.y * 6.28) * 0.045;
         float rise   = sin(uTime * 0.35 + aSeed.z * 6.28) * 0.06;
         float len = max(length(position), 1e-4);
         vec3 dir = position / len;
         float blast = uDisperse * (2.6 + aSeed.x * 5.5);
         transformed += vec3(drift, rise, wobble) + dir * blast;

         // w = 0 so the model-view matrix rotates the direction without
         // translating it. Its z in view space is how far the point faces
         // the camera: +1 dead on, -1 directly behind the globe.
         vec3 viewDir = normalize((modelViewMatrix * vec4(dir, 0.0)).xyz);
         vFade = mix(smoothstep(-0.25, 0.30, viewDir.z), 1.0, uDisperse);
         vTint = aColor;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vFade;
         varying vec3 vTint;`,
      )
      .replace(
        '#include <color_fragment>',
        `diffuseColor.rgb *= vTint;
         diffuseColor.a *= vFade;
         if (diffuseColor.a < 0.004) discard;`,
      );
  };

  return material;
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
    const ocean = new THREE.Color(p.ocean);
    const calm = new THREE.Color(p.calm);
    const tmp = new THREE.Color();

    // Two passes over an oversampled lattice. The first takes every land
    // candidate and a slice of the ocean; the second tops the quota back up
    // from the ocean it passed over, so the buffer is always exactly full
    // whatever the mask says. Both are seeded, so the globe is identical on
    // every load — the same reason the lattice is Fibonacci and not random.
    let n = 0;
    for (let pass = 0; pass < 2 && n < COUNT; pass++) {
      for (let i = 0; i < CANDIDATES && n < COUNT; i++) {
        // Fibonacci lattice: even coverage of the sphere, with none of the
        // polar clustering naive lat/long sampling produces.
        const t = i / (CANDIDATES - 1);
        const dy = 1 - t * 2;
        const ring = Math.sqrt(Math.max(0, 1 - dy * dy));
        const theta = GOLDEN_ANGLE * i;
        const dx = Math.cos(theta) * ring;
        const dz = Math.sin(theta) * ring;

        const land = isLandAtDirection(dx, dy, dz);
        const keptFirstPass = land || seeded(i * 3.31) < OCEAN_KEEP;
        if (pass === 0 ? !keptFirstPass : keptFirstPass) continue;

        // Most mass sits in a thin shell; the rest drifts inside as depth haze.
        const u = seeded(i * 2.71);
        const shell =
          u < 0.94 ? 0.985 + seeded(i * 5.19) * 0.015 : Math.pow(seeded(i * 7.13), 0.4) * 0.9;
        const rad = RADIUS * shell;

        positions[n * 3] = dx * rad;
        positions[n * 3 + 1] = dy * rad;
        positions[n * 3 + 2] = dz * rad;

        seeds[n * 3] = seeded(i * 7.77);
        seeds[n * 3 + 1] = seeded(i * 9.11);
        seeds[n * 3 + 2] = seeded(i * 11.31);

        // Ocean carries no reading, so it carries no chroma: it is the thing
        // the continents are legible against. Land keeps the pollution ramp,
        // which is the only reason the globe is here.
        let hot = false;
        if (land) {
          // Most land sits at one calm colour; only loaded regions leave it.
          //
          // The ramp used to spread green-amber-red across every dot, which
          // made the continents a field of noise — the shapes were there and
          // unreadable. A map is legible when most of it agrees and the
          // exceptions stand out, so clean air is the base and pollution is
          // the highlight. It also states the data more honestly: a
          // continuous ramp implies a precision this synthetic field does
          // not have, while "calm, with hotspots" is what it actually says.
          const load = loadAt(dx * 2, dy * 2, dz * 2);
          if (load > 0.86) tmp.copy(bad);
          else if (load > 0.74) tmp.lerpColors(warn, bad, (load - 0.74) / 0.12);
          else if (load > 0.62) tmp.lerpColors(calm, warn, (load - 0.62) / 0.12);
          else tmp.lerpColors(calm, good, (0.62 - load) / 0.62 * 0.35);

          // A small fraction burn bright as "hot" monitored parcels. Land only —
          // a bright reading in the middle of the Pacific is a claim, not a mood.
          hot = seeded(i * 13.7) > 0.965;
          if (hot) tmp.lerp(new THREE.Color(p.hot), 0.5);
        } else {
          tmp.copy(ocean);
        }

        // Interior haze sits behind the shell, so sink it toward the sea
        // colour and dim it for depth. It tinted toward `cool` before, which
        // is now a land hue and would have put blue back inside the planet.
        if (u >= 0.94) tmp.lerp(ocean, 0.42).multiplyScalar(land ? 0.62 : 0.4);

        colors[n * 3] = tmp.r;
        colors[n * 3 + 1] = tmp.g;
        colors[n * 3 + 2] = tmp.b;
        sizes[n] = hot ? 0.09 : 0.02 + seeded(i * 17.3) * 0.04;
        n++;
      }
    }
    return { positions, colors, seeds, sizes };
  }, [dark]);

  // The material is built once and mutated through uniforms. Its vertex
  // shader does the drift, the blast and the depth fade; see FADE_CHUNK.
  const material = React.useMemo(() => makeGlobeMaterial(sprite, dark), [sprite, dark]);
  React.useEffect(() => () => material.dispose(), [material]);

  useFrame((state, delta) => {
    const pts = points.current;
    if (!pts) return;
    const t = state.clock.elapsedTime;

    // Scroll drives a slow, continuous spread; the scan click overrides it
    // with a fast full blast. Whichever is further along wins.
    //
    // This stays on the CPU deliberately. It is one float, it is where the
    // scroll ref and the dispersing prop meet, and keeping it here means the
    // hand-off logic reads the same as it did when the loop was here too.
    const scrolled = (progress?.current ?? 0) * 0.82;
    const target = Math.max(dispersing ? 1 : 0, scrolled);
    eased.current += (target - eased.current) * Math.min(1, delta * (dispersing ? 1.9 : 6));
    const d = eased.current;

    // Two uniform writes replace a 34000-iteration loop with three sines in
    // it. The loop is why the count could not rise: at 9200 points it already
    // ran 27600 sines a frame, and the reference look needs four times that.
    // Read off the object rather than the memo: same material, but mutating
    // the captured value is a render-time value being written after render.
    const mat = pts.material as THREE.PointsMaterial;
    const u = mat.userData.uniforms as { uTime: { value: number }; uDisperse: { value: number } };
    u.uTime.value = t;
    u.uDisperse.value = d;

    mat.opacity = (dark ? 0.95 : 0.9) * (1 - d * 0.95);
    mat.size = (dark ? 0.019 : 0.021) + d * 0.05;

    // Gentle autorotation; accelerates as the field breaks apart.
    pts.rotation.y += delta * (0.045 + d * 0.9);
  });

  return (
    // 0.409 rad is Earth's 23.44 degree obliquity. It was 0.22 when the
    // sphere was an abstract cloud and any lean would do.
    <points ref={points} frustumCulled={false} rotation={[0, 0, 0.409]} material={material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 3]} />
      </bufferGeometry>
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
