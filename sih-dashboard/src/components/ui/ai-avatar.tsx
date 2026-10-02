import * as React from 'react';
import { cn } from '@/lib/utils';

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
  | 'airlytics';
export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'square' | 'squircle';

export interface AvatarProps {
  blinking?: boolean;
  color?: AvatarColor;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
  track?: boolean;
  state?: 'idle' | 'listening';
  halo?: boolean;
}

/**
 * Human specialist portrait avatar representing an atmospheric science analyst.
 * Designed with warm, human detailing rather than a cold robotic orb.
 */
export default function Avatar({
  size = 'md',
  shape = 'circle',
  className,
  state = 'idle',
}: AvatarProps) {
  const isListening = state === 'listening';

  const sizePx = size === 'sm' ? 32 : size === 'lg' ? 56 : 42;
  const radiusClass =
    shape === 'circle'
      ? 'rounded-full'
      : shape === 'squircle'
        ? 'rounded-2xl'
        : 'rounded-xl';

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-slate-600/80 bg-gradient-to-b from-slate-800 to-slate-900 shadow-md',
        radiusClass,
        className,
      )}
      style={{ width: sizePx, height: sizePx }}
    >
      {/* Human atmospheric specialist portrait */}
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full select-none"
      >
        <defs>
          <linearGradient id="human-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <linearGradient id="skin" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f7d0ab" />
            <stop offset="100%" stopColor="#e8b184" />
          </linearGradient>
          <linearGradient id="hair" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#332420" />
            <stop offset="100%" stopColor="#1c1310" />
          </linearGradient>
          <linearGradient id="coat" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>
          <linearGradient id="glasses-glint" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Ambient background */}
        <circle cx="50" cy="50" r="50" fill="url(#human-bg)" />

        {/* Shoulders / Professional attire */}
        <path
          d="M18 96 C 18 76, 30 70, 50 70 C 70 70, 82 76, 82 96 Z"
          fill="url(#coat)"
        />
        {/* Shirt collar / V-neck */}
        <path d="M42 70 L50 82 L58 70 Z" fill="#ffffff" />
        <path d="M46 70 L50 76 L54 70 Z" fill="#cbd5e1" />

        {/* Neck */}
        <rect x="44" y="58" width="12" height="15" rx="3" fill="#df9f68" />
        <path d="M44 62 C 47 65, 53 65, 56 62 L 56 69 C 53 71, 47 71, 44 69 Z" fill="#cf8e55" opacity="0.3" />

        {/* Back Hair */}
        <path
          d="M27 48 C 26 30, 36 18, 50 18 C 64 18, 74 30, 73 48 C 73 54, 70 60, 68 62 C 64 56, 64 45, 64 45 C 50 45, 36 45, 36 45 C 36 45, 36 56, 32 62 C 30 60, 27 54, 27 48 Z"
          fill="url(#hair)"
        />

        {/* Face */}
        <ellipse cx="50" cy="47" rx="19" ry="21" fill="url(#skin)" />

        {/* Ears */}
        <ellipse cx="30" cy="48" rx="3.5" ry="5.5" fill="#e8b184" />
        <ellipse cx="70" cy="48" rx="3.5" ry="5.5" fill="#e8b184" />

        {/* Eyebrows */}
        <path d="M37 37 C 40 35, 44 36, 46 37" stroke="#261b17" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M54 37 C 56 36, 60 35, 63 37" stroke="#261b17" strokeWidth="1.8" strokeLinecap="round" />

        {/* Warm, friendly human eyes */}
        <ellipse cx="42" cy="42.5" rx="2.5" ry="2.7" fill="#1e1816" />
        <ellipse cx="58" cy="42.5" rx="2.5" ry="2.7" fill="#1e1816" />
        {/* Eye highlights */}
        <circle cx="41.2" cy="41.5" r="0.9" fill="#ffffff" />
        <circle cx="57.2" cy="41.5" r="0.9" fill="#ffffff" />

        {/* Refined modern eyeglasses */}
        <rect x="34.5" y="36.5" width="14.5" height="12" rx="3" fill="url(#glasses-glint)" stroke="#0f172a" strokeWidth="1.6" />
        <rect x="51" y="36.5" width="14.5" height="12" rx="3" fill="url(#glasses-glint)" stroke="#0f172a" strokeWidth="1.6" />
        {/* Eyeglass bridge */}
        <path d="M49 41 Q 50 40 51 41" stroke="#0f172a" strokeWidth="1.6" fill="none" />
        <path d="M34.5 41 L 30 42" stroke="#0f172a" strokeWidth="1.3" />
        <path d="M65.5 41 L 70 42" stroke="#0f172a" strokeWidth="1.3" />

        {/* Nose */}
        <path d="M50 44 L 48.5 50 Q 50 51.5 51.5 50" stroke="#cf8e55" strokeWidth="1.3" strokeLinecap="round" fill="none" />

        {/* Friendly human smile */}
        <path d="M45 55.5 Q 50 59.5 55 55.5" stroke="#9a432e" strokeWidth="1.8" strokeLinecap="round" fill="none" />

        {/* Front Stylish Hair & Fringe */}
        <path
          d="M29 35 C 30 23, 38 16, 50 16 C 62 16, 70 23, 71 35 C 68 27, 59 25, 50 27 C 42 25, 33 27, 29 35 Z"
          fill="url(#hair)"
        />
        {/* Hair strand accent */}
        <path d="M48 18 Q 55 22 58 29" stroke="#4a3731" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>

      {/* Active status indicator */}
      <span
        className={cn(
          'absolute bottom-0 right-0 rounded-full border-2 border-slate-900',
          size === 'sm' ? 'size-2.5' : 'size-3.5',
          isListening ? 'animate-pulse bg-sky-400 ring-2 ring-sky-400/40' : 'bg-emerald-400',
        )}
        title={isListening ? 'Listening' : 'Online Specialist'}
      />
    </div>
  );
}
