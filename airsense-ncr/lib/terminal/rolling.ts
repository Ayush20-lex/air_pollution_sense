/**
 * Maths behind the rolling AQI readouts.
 *
 * Kept separate from the React component so the digit handling and the
 * playback-rate coupling can be tested without a DOM.
 */

/** Digits of a value, most significant first. Always at least one digit. */
export function toDigits(value: number): number[] {
  const n = Math.max(0, Math.round(value));
  const s = String(n);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) - 48);
  return out;
}

/**
 * Stable React keys for digit columns.
 *
 * Keyed by position *from the right*, so 98 -> 104 keeps the tens and units
 * columns mounted and only adds a hundreds column. Keying left-to-right would
 * remount every column and restart every roll.
 */
export function columnKeys(length: number): number[] {
  const keys: number[] = [];
  for (let i = 0; i < length; i++) keys.push(length - 1 - i);
  return keys;
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** Interpolate, clamped at both ends. */
export function tween(from: number, to: number, t: number): number {
  return from + (to - from) * easeOutCubic(t);
}

/**
 * How long a roll should take, in ms.
 *
 * The timeline advances every `900 / rate` ms, so at 4x a 500ms roll would
 * never land and at 12x it would be sixty overlapping animations a second.
 * Above 4x the number snaps — there is no time to read it anyway. Stepping or
 * scrubbing (not playing) always gets the full roll.
 */
export function rollDuration(rate: number, playing: boolean, reduced = false): number {
  if (reduced) return 0;
  if (!playing) return 520;
  if (rate >= 12) return 0;
  return Math.min(520, Math.round((900 / rate) * 0.7));
}
