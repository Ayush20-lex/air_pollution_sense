import * as THREE from 'three';
import * as React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { useTheme } from 'next-themes';
import { PARTICLE } from '@/lib/tokens';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { isLandAtDirection } from '@/lib/earth-mask';
import { seeded } from '@/lib/utils';

/**
 * Latitude rows across the globe. 340 rows is one dot every ~0.53 degrees.
 *
 * Rows, not a Fibonacci lattice. Fibonacci gives even coverage and no seams,
 * which is the right answer for a cloud and the wrong one for this: even
 * coverage with no alignment reads as noise, and the dot-globe look depends
 * on the eye finding rows. The lattice was why the continents stayed mushy
 * at any density.
 */
const ROWS_DESKTOP = 340;
/** Phones get a coarser grid: ~62k dots against ~147k. */
const ROWS_COMPACT = 220;

/**
 * Grid resolution for this device, read once at mount.
 *
 * A full-density sphere is 147190 dots. That holds 87fps on a desktop GPU
 * and is not a safe thing to hand a phone, which has a fraction of the fill
 * rate and a screen too small to resolve the difference anyway. Read once
 * rather than on resize: rebuilding 147190 dots mid-drag to gain detail
 * nobody asked for is the more expensive mistake.
 */
function rowsForViewport(): number {
  if (typeof window === 'undefined') return ROWS_COMPACT;
  return window.innerWidth < 768 ? ROWS_COMPACT : ROWS_DESKTOP;
}

/**
 * Dots on the equator, twice the row count. Every other row gets this scaled
 * by cos(latitude), so the rows stay and the polar crowding that ruins a
 * naive lat/long grid does not — the reason Fibonacci was chosen in the first
 * place, recovered without giving up the alignment.
 */
const EQUATOR_FACTOR = 2;

/** Radius of the globe, in world units. */
const RADIUS = 2.45;

/**
 * How large a sea dot is against a land dot.
 *
 * The sea used to be thinned instead — one dot in fourteen — which left the
 * body of the sphere mostly empty and only the continents holding together,
 * so the globe came apart into floating landmasses. Every grid cell is drawn
 * now, and separation is carried by size and value rather than by absence.
 * A complete surface is what makes it a sphere; the continents still lead
 * because their dots are nearly twice the size and far brighter.
 */
const OCEAN_SCALE = 0.55;

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
    size: dark ? 0.0145 : 0.016,
    transparent: true,
    opacity: dark ? 0.95 : 0.9,
    depthWrite: false,
    sizeAttenuation: true,
    blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const palette = dark ? PARTICLE.dark : PARTICLE.light;
  const uniforms = {
    uTime: { value: 0 },
    uDisperse: { value: 0 },
    uRim: { value: new THREE.Color(palette.rim) },
  };
  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDisperse = uniforms.uDisperse;
    shader.uniforms.uRim = uniforms.uRim;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aSeed;
         attribute vec3 aColor;
         attribute float aScale;
         uniform float uTime;
         uniform float uDisperse;
         uniform vec3 uRim;
         varying float vFade;
         varying vec3 vTint;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
         // Drift is held almost flat while the globe is at rest and opened
         // up as it disperses. At full amplitude it moved every dot by up to
         // 3.7% of the radius, which knocked the grid out of alignment and
         // put the holes in the continents: the dots were all still there,
         // just no longer in rows. The motion is wanted during the blast and
         // is the enemy of a clean surface before it.
         float stir = 0.12 + 0.88 * uDisperse;
         float drift  = sin(uTime * 0.22 + aSeed.x * 6.28) * 0.09 * stir;
         float wobble = sin(uTime * 0.60 + aSeed.y * 6.28) * 0.045 * stir;
         float rise   = sin(uTime * 0.35 + aSeed.z * 6.28) * 0.06 * stir;
         float len = max(length(position), 1e-4);
         vec3 dir = position / len;
         float blast = uDisperse * (2.6 + aSeed.x * 5.5);
         transformed += vec3(drift, rise, wobble) + dir * blast;

         // w = 0 so the model-view matrix rotates the direction without
         // translating it. Its z in view space is how far the point faces
         // the camera: +1 dead on, -1 directly behind the globe.
         vec3 viewDir = normalize((modelViewMatrix * vec4(dir, 0.0)).xyz);
         float facing = smoothstep(-0.12, 0.12, viewDir.z);

         // The silhouette. Points whose surface has turned edge-on sit on the
         // circle where viewDir.z crosses zero, front and back hemispheres
         // alike, and perspective packs their spacing to nearly nothing there
         // — so the outline draws itself as soon as those points are allowed
         // to be seen. The depth fade was dimming exactly them to half, which
         // is why the globe had no edge and read as a drifting patch.
         //
         // Narrow on purpose: 0.09 is about five degrees of arc, a line
         // rather than a glow. It carries its own colour because ocean at the
         // limb is near black, and alpha cannot brighten a colour that is not
         // there.
         float rim = 1.0 - smoothstep(0.0, 0.09, abs(viewDir.z));
         rim *= 1.0 - uDisperse;

         vFade = mix(max(facing, rim * 0.92), 1.0, uDisperse);
         vTint = mix(aColor, uRim, rim * 0.85);`,
      );

    // three sets a single point size for the whole material; the sea needs
    // its own. Patched rather than reimplemented so size attenuation, which
    // the next lines of the stock chunk apply, still runs untouched.
    shader.vertexShader = shader.vertexShader.replace(
      'gl_PointSize = size;',
      'gl_PointSize = size * aScale;',
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
  // Harder falloff than a plain gradient. The old stops put half the sprite's
  // alpha outside its core, so at globe density every dot bled into its
  // neighbours and the surface turned to haze instead of reading as dots.
  // The edge stays soft enough to avoid square pixels, and no softer.
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.18)');
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

  const [rows] = React.useState(rowsForViewport);

  const { positions, colors, seeds, scales } = React.useMemo(() => {
    const equatorDots = rows * EQUATOR_FACTOR;
    // Light mode needs deeper pigments: the neon set greys out against white.
    const p = dark ? PARTICLE.dark : PARTICLE.light;
    const good = new THREE.Color(p.good);
    const warn = new THREE.Color(p.warn);
    const bad = new THREE.Color(p.bad);
    const ocean = new THREE.Color(p.ocean);
    const calm = new THREE.Color(p.calm);
    const hotCol = new THREE.Color(p.hot);
    const tmp = new THREE.Color();

    // Grown, not pre-sized. The dot count falls out of the grid and the
    // coastline rather than being chosen, so ROWS is the only number to turn
    // and the buffers are always exactly as long as the globe needs.
    const pos: number[] = [];
    const col: number[] = [];
    const sed: number[] = [];
    const scl: number[] = [];

    let k = 0;
    for (let r = 0; r < rows; r++) {
      // Row centres, so no dot sits exactly on a pole.
      const v = (r + 0.5) / rows;
      const lat = Math.PI * (0.5 - v);
      const dy = Math.sin(lat);
      const ring = Math.cos(lat);

      // Columns scale with cos(latitude): rows stay aligned, spacing stays
      // even. A fixed column count would pile the poles with dots.
      const cols = Math.max(1, Math.round(equatorDots * ring));
      for (let c = 0; c < cols; c++) {
        // Half-row stagger, so the rows do not line up into vertical seams.
        const lon = ((c + (r % 2) * 0.5) / cols) * Math.PI * 2;
        const dx = Math.cos(lon) * ring;
        const dz = Math.sin(lon) * ring;

        const land = isLandAtDirection(dx, dy, dz);
        k++;

        pos.push(dx * RADIUS, dy * RADIUS, dz * RADIUS);
        sed.push(seeded(k * 7.77), seeded(k * 9.11), seeded(k * 11.31));
        scl.push(land ? 1 : OCEAN_SCALE);

        // Ocean carries no reading, so it carries no chroma: it is the thing
        // the continents are legible against.
        if (land) {
          // Most land sits at one calm colour; only loaded regions leave it.
          // A ramp across every dot made the continents a field of noise —
          // shapes present and unreadable. A map is legible when most of it
          // agrees and the exceptions stand out.
          const load = loadAt(dx * 2, dy * 2, dz * 2);
          if (load > 0.86) tmp.copy(bad);
          else if (load > 0.74) tmp.lerpColors(warn, bad, (load - 0.74) / 0.12);
          else if (load > 0.62) tmp.lerpColors(calm, warn, (load - 0.62) / 0.12);
          else tmp.lerpColors(calm, good, ((0.62 - load) / 0.62) * 0.35);

          // A few burn bright as monitored parcels. Land only — a bright
          // reading in the middle of the Pacific is a claim, not a mood.
          if (seeded(k * 13.7) > 0.997) tmp.lerp(hotCol, 0.5);
        } else {
          tmp.copy(ocean);
        }

        col.push(tmp.r, tmp.g, tmp.b);
      }
    }

    return {
      positions: new Float32Array(pos),
      colors: new Float32Array(col),
      seeds: new Float32Array(sed),
      scales: new Float32Array(scl),
    };
  }, [dark, rows]);

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
    mat.size = (dark ? 0.0145 : 0.016) + d * 0.055;

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
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
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
