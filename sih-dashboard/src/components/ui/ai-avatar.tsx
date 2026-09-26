/**
 * The assistant's face: a glossy orb that blinks.
 *
 * Dropped in from a component library, with three changes for this stack:
 *
 *   - `motion/react` -> `framer-motion`. They are the same library; `motion` is
 *     the rebrand and this project already carries framer-motion 12. Installing
 *     `motion` alongside it would ship two copies of the same animation runtime.
 *   - `"use client"` removed. That directive is a React Server Components
 *     marker; this is a Vite SPA where every component is already a client one,
 *     and leaving it in implies a boundary that does not exist here.
 *   - `blur-xs` -> `blur-[2px]`. `blur-xs` is a Tailwind v4 class and this
 *     project is on 3.4, where it silently resolves to nothing - the shadow
 *     under the orb would simply not have been blurred.
 *
 * The eyes blink on a CSS keyframe rather than a React timer: it runs on the
 * compositor, costs no re-renders, and keeps working on a phone that is
 * throttling JavaScript - which is most of the devices this site is tuned for.
 */
import { useEffect, useId, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

export type AvatarColor =
  | 'blue'
  | 'orange'
  | 'red'
  | 'green'
  | 'purple'
  | 'yellow'
  | 'cyan'
  | 'pink'
  | 'indigo'
  | 'lime'
  | 'turquoise'
  | 'violet'
  /** The assistant's own colour - see the PRESETS entry for why it is this. */
  | 'airsense';
export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'square' | 'squircle';

export interface AvatarProps {
  blinking?: boolean;
  color?: AvatarColor;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
  /**
   * Eyes follow the pointer. Desktop only and off under reduced motion - a
   * touch device has no cursor to follow, and running a pointermove listener
   * there costs battery for nothing.
   */
  track?: boolean;
  /**
   * `listening` is what the orb does while someone is typing to it: it opens
   * its eyes wider, brightens, and drops its gaze toward the composer. It is
   * feedback that the input is live, not decoration.
   */
  state?: 'idle' | 'listening';
  /** A slow iridescent ring behind the orb. Compositor-only; see av-spin. */
  halo?: boolean;
}

const BLINK_KEYFRAMES = `
@keyframes av-blink {
  0%, 88%, 100% { transform: scaleY(1); }
  93%            { transform: scaleY(0.07); }
  97%            { transform: scaleY(0.07); }
}
@keyframes av-spin { to { transform: rotate(360deg); } }
`;

const PRESETS: Record<
  AvatarColor,
  { gradient: string; boxShadow: string; iris: string; shine: string }
> = {
  blue: {
    gradient:
      'radial-gradient(circle at 50% 45%, #0d4d9a 0%, #3d7dd8 40%, #6fb3ff 68%, #e0eeff 100%)',
    boxShadow:
      '0 0 4px 0px rgba(20,102,216,.35), 0 0 16px 6px rgba(20,102,216,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #d4ecff 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  orange: {
    gradient:
      'radial-gradient(circle at 50% 45%, #a63e10 0%, #e27a2a 40%, #ffb46a 68%, #ffe8cc 100%)',
    boxShadow:
      '0 0 4px 0px rgba(232,100,0,.35), 0 0 16px 6px rgba(232,100,0,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #ffd9b8 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  red: {
    gradient:
      'radial-gradient(circle at 50% 45%, #a60033 0%, #e74668 40%, #ff8aaa 68%, #ffd6e8 100%)',
    boxShadow:
      '0 0 4px 0px rgba(223,24,92,.35), 0 0 16px 6px rgba(223,24,92,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #ffcde4 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  green: {
    gradient:
      'radial-gradient(circle at 50% 45%, #0d6632 0%, #2a9d5f 40%, #6dd187 68%, #d1fadd 100%)',
    boxShadow:
      '0 0 4px 0px rgba(12,168,82,.35), 0 0 16px 6px rgba(12,168,82,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #c5f5d8 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  purple: {
    gradient:
      'radial-gradient(circle at 50% 45%, #4a0080 0%, #8b3fd1 40%, #c896ff 68%, #e8d4ff 100%)',
    boxShadow:
      '0 0 4px 0px rgba(110,46,224,.35), 0 0 16px 6px rgba(110,46,224,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #e0c9ff 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  yellow: {
    gradient:
      'radial-gradient(circle at 50% 45%, #8a5500 0%, #d4a000 40%, #ffc93a 68%, #fff5cc 100%)',
    boxShadow:
      '0 0 4px 0px rgba(214,142,0,.35), 0 0 16px 6px rgba(214,142,0,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #fff0a8 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  cyan: {
    gradient:
      'radial-gradient(circle at 50% 45%, #003d66 0%, #0a8fb5 40%, #5dd4ff 68%, #cdf5ff 100%)',
    boxShadow:
      '0 0 4px 0px rgba(10,143,181,.35), 0 0 16px 6px rgba(10,143,181,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #d0f0ff 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  pink: {
    gradient:
      'radial-gradient(circle at 50% 45%, #7a0055 0%, #d63384 40%, #ff6bb3 68%, #ffe5f5 100%)',
    boxShadow:
      '0 0 4px 0px rgba(214,51,132,.35), 0 0 16px 6px rgba(214,51,132,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #ffd6ed 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  indigo: {
    gradient:
      'radial-gradient(circle at 50% 45%, #2d157a 0%, #4f46e5 40%, #8b7eff 68%, #ddd6ff 100%)',
    boxShadow:
      '0 0 4px 0px rgba(79,70,229,.35), 0 0 16px 6px rgba(79,70,229,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #e0d9ff 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  lime: {
    gradient:
      'radial-gradient(circle at 50% 45%, #4a5910 0%, #84cc16 40%, #bef264 68%, #ecfccf 100%)',
    boxShadow:
      '0 0 4px 0px rgba(132,204,22,.35), 0 0 16px 6px rgba(132,204,22,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #f7fee8 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  turquoise: {
    gradient:
      'radial-gradient(circle at 50% 45%, #1a5555 0%, #0d9488 40%, #2dd4bf 68%, #ccfbf1 100%)',
    boxShadow:
      '0 0 4px 0px rgba(13,148,136,.35), 0 0 16px 6px rgba(13,148,136,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #c0fdf5 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  /**
   * The assistant's own colour, and the only preset written for this site.
   *
   * Magenta is the one hue with no meaning in this dashboard's palette:
   * severity runs green / lime / yellow / orange / red / purple, and the
   * measurement series take cyan and violet. An orb in any of those reads as a
   * value - a green assistant beside a green Good band is a reading, not a
   * button. This one cannot be mistaken for data, which is exactly what UI
   * chrome should be.
   *
   * It keeps the dark-core, light-rim shape every other preset uses, and that
   * is not a stylistic choice - the irises are white, so the core is their
   * background. A first pass lit this one from the middle instead, to carry
   * better on a near-black page; it did, and it erased the face. The orb read
   * as a glowing blank. Brightness belongs in the rim and the bloom, where it
   * makes the control visible, not in the centre, where it eats the eyes.
   */
  airsense: {
    gradient:
      'radial-gradient(circle at 50% 45%, #4a0b3d 0%, #c2188c 38%, #ff5ecf 66%, #e4c6ff 100%)',
    boxShadow:
      '0 0 8px 0px rgba(255,94,207,.45), 0 0 24px 8px rgba(177,76,255,.24), 0 0 46px 16px rgba(76,125,255,.10), inset 0 0 0 1px rgba(255,255,255,.08)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #ffe9fb 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.72) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
  violet: {
    gradient:
      'radial-gradient(circle at 50% 45%, #4a2a7a 0%, #a855f7 40%, #d8b4fe 68%, #f3e8ff 100%)',
    boxShadow:
      '0 0 4px 0px rgba(168,85,247,.35), 0 0 16px 6px rgba(168,85,247,.18), inset 0 0 0 1px rgba(255,255,255,.05)',
    iris: 'linear-gradient(135deg, #ffffff 0%, #ede9fe 100%)',
    shine:
      'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)',
  },
};

const SIZE: Record<AvatarSize, { orb: string; eye: string; eyeGap: string; eyeY: string }> = {
  sm: { orb: 'size-8', eye: 'w-1 h-1.5', eyeGap: 'gap-1.5', eyeY: '-translate-y-0.5' },
  md: { orb: 'size-12', eye: 'w-1.5 h-2.5', eyeGap: 'gap-2.5', eyeY: '-translate-y-0.5' },
  lg: { orb: 'size-16', eye: 'w-2 h-3', eyeGap: 'gap-3.5', eyeY: '-translate-y-1' },
};

const SHAPE_RADIUS: Record<AvatarShape, string> = {
  circle: 'rounded-full',
  square: 'rounded-[0%]',
  squircle: 'rounded-[40%]',
};

interface EyeProps {
  blinking: boolean;
  delayMs?: number;
  irisGradient: string;
  sizeClass: string;
}

function Eye({ blinking, delayMs = 0, irisGradient, sizeClass }: EyeProps) {
  return (
    <div
      className={['rounded-full', sizeClass].filter(Boolean).join(' ')}
      style={{
        background: irisGradient,
        ...(blinking ? { animation: `av-blink 3.6s ease-in-out ${delayMs}ms infinite` } : {}),
      }}
    />
  );
}

function Avatar({
  blinking = true,
  color = 'blue',
  size = 'md',
  shape = 'circle',
  className = '',
  track = false,
  state = 'idle',
  halo = false,
}: AvatarProps) {
  const uid = useId();
  const noiseId = `av-n${uid.replace(/\W/g, '')}`;
  const preset = PRESETS[color] ?? PRESETS.blue;
  const dims = SIZE[size] ?? SIZE.md;
  const orbRef = useRef<HTMLDivElement>(null);

  // Gaze. Motion values rather than state: a pointer move must not re-render
  // React - this orb sits on every terminal route, and a setState per mouse
  // move would re-run the page's component tree a hundred times a second.
  // The spring is what makes it read as looking rather than snapping.
  const gazeX = useMotionValue(0);
  const gazeY = useMotionValue(0);
  const x = useSpring(gazeX, { stiffness: 260, damping: 20, mass: 0.3 });
  const y = useSpring(gazeY, { stiffness: 260, damping: 20, mass: 0.3 });

  useEffect(() => {
    if (!track) return;
    // No cursor to follow on a touch screen, and someone who asked for less
    // motion did not ask for a thing that watches them.
    if (typeof window === 'undefined') return;
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      // Coalesced to one read per frame. `getBoundingClientRect` is a layout
      // read, and doing it per event rather than per frame is how a smooth
      // idea turns into a janky one.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = orbRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        // The eyes travel a fraction of the orb, and only reach full deflection
        // once the cursor is a few hundred pixels away - so a cursor resting
        // just off the orb does not peg them at the edge.
        const reach = Math.min(1, dist / 260);
        const max = r.width * 0.1;
        gazeX.set((dx / dist) * max * reach);
        gazeY.set((dy / dist) * max * reach);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [track, gazeX, gazeY]);

  const listening = state === 'listening';

  return (
    <>
      <style>{BLINK_KEYFRAMES}</style>
      <span className="relative inline-flex shrink-0 items-center justify-center">
        {/* Iridescent ring, behind and slightly larger than the orb. A conic
            gradient rotated by transform: the compositor owns it, so it costs
            nothing per frame and keeps turning on a phone that is throttling
            JavaScript. Sibling rather than child because the orb clips. */}
        {halo && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[3px] rounded-full opacity-70 blur-[3px]"
            style={{
              background:
                'conic-gradient(from 0deg, #ff5ecf, #b14cff, #4c7dff, #35e6ff, #ff5ecf)',
              animation: 'av-spin 7s linear infinite',
            }}
          />
        )}
      <motion.div
        ref={orbRef}
        aria-label="AI Avatar"
        role="img"
        whileTap={{ scaleX: 1.15, scaleY: 1.3 }}
        transition={{ type: 'tween', duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
        className={[
          'relative flex cursor-pointer items-center justify-center overflow-hidden',
          dims.orb,
          SHAPE_RADIUS[shape],
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        animate={listening ? { scale: 1.06 } : { scale: 1 }}
        style={{
          background: preset.gradient,
          // Brighter while it is being spoken to, so the state is visible
          // without a second indicator to read.
          boxShadow: listening
            ? `${preset.boxShadow}, 0 0 34px 12px rgba(255,255,255,.14)`
            : preset.boxShadow,
        }}
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.2] mix-blend-overlay"
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id={noiseId} x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.72"
                numOctaves="4"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          </defs>
          <rect width="100%" height="100%" filter={`url(#${noiseId})`} />
        </svg>

        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.2] mix-blend-overlay"
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter
              id={`grain-${uid.replace(/\W/g, '')}`}
              x="0%"
              y="0%"
              width="100%"
              height="100%"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="3.2"
                numOctaves="1"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          </defs>
          <rect
            width="100%"
            height="100%"
            filter={`url(#grain-${uid.replace(/\W/g, '')})`}
          />
        </svg>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: preset.shine }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 blur-[2px]"
          style={{
            background:
              'radial-gradient(circle at 62% 68%, rgba(0,0,0,0.18) 0%, transparent 55%)',
          }}
        />

        <motion.div
          className={['relative z-10 flex items-center', dims.eyeGap, dims.eyeY].join(' ')}
          // The gaze offset rides here rather than on each eye, so both move
          // together and the pair keeps its spacing.
          style={{ x, y }}
          // Listening widens the eyes a little. Scale on the pair, not the
          // orb, so the blink keyframe on each eye is untouched.
          animate={listening ? { scaleY: 1.18, scaleX: 1.06 } : { scaleY: 1, scaleX: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        >
          <Eye blinking={blinking} delayMs={0} irisGradient={preset.iris} sizeClass={dims.eye} />
          <Eye blinking={blinking} delayMs={60} irisGradient={preset.iris} sizeClass={dims.eye} />
        </motion.div>
      </motion.div>
      </span>
    </>
  );
}

export default Avatar;
