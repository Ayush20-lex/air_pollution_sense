/**
 * Coarse land/ocean mask for the intro globe.
 *
 * The aerosol field was always a sphere — a Fibonacci lattice at RADIUS 2.45 —
 * but its surface was three rotated sine lobes standing in for continents, so
 * it read as a planet rather than as Earth. This is the real coastline.
 *
 * Baked, not fetched. Natural Earth 110m land (public domain) rasterised to a
 * 2-degree grid, 8x supersampled and thresholded at 35% cell coverage, then
 * bit-packed: 16200 cells become 2025 bytes, 2700 base64 characters. An image
 * would have been sharper and also an async asset with a loading state and a
 * first frame without continents; at 2 degrees the difference is invisible on
 * a 9200-point cloud, and this way the globe is correct on frame one.
 *
 * Accuracy check at build time: 30.7% area-weighted land against Earth's
 * 29.2%. The excess is coastline cells rounding to land, which is the right
 * direction to err — it keeps small nations from dropping out entirely.
 *
 * Row 0 is +90 latitude, column 0 is -180 longitude.
 */

const W = 180;
const H = 90;

/**
 * Area-weighted share of the sphere this mask calls land, measured when the
 * mask was baked. Earth is 0.292; the excess is coastline cells rounding up.
 * Exported so samplers can solve for a land quota instead of guessing a
 * rejection rate and checking the result by eye.
 */
export const LAND_FRACTION = 0.307;

const PACKED =
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAf8Af/AAAAAAAAAAAAAAAAAAAAAAAA//////+AAAABgAADgAAAAAAAAAAAAN//////4AB/AAAAAB8AAAAAAAAAABxC34///' +
  '/wAAYAAAEAAPgAAAAAAAAAAPm/wAf//wAAAAADgAf/4AHAAAAAAAH8338AP//gAAAAAMBD///8DAAAgDwACfw3/gP//gAAA4' +
  'AMH///////wAAf////79n4H/+AAAP/gB//////////8P//////h+H/gAAAf/7///////////M///////n8D8A+AB+/f/////' +
  '//////AP/////4g8D4AAAH9/////////////Af/////gHgA4AAAP5///////////P4AHgP///gH0AAAAAH4//////////2MA' +
  'ADQB///8H+AAAAGCx/////////8A8AAIAA////v/gAAAPDr/////////wA4AAAAAf///v/wAAAbv///////////AwAAAAAP/' +
  '////wAAAH////////////AAAAAAAH////8YAAAD///////////9AAAAAAAD////8MAAAB///////////9AAAAAAAD////+AA' +
  'AAB//7/P//////5AAAAAAAD////gAAAAf5vwPP//////jgAAAAAAD////gAAAAfi///n/////+CAAAAAAAD///+AAAAAfCLf' +
  '/n////+MCAAAAAAAB///8AAAAAOeRP///////mOAAAAAAAB///8AAAAAH/AA///////G8AAAAAAAAf//wAAAAAf/gB//////' +
  '/hgAAAAAAAAP//wAAAAAf//////////gAAAAAAAAAP/owAAAAA/////f/////gAAAAAAAAAF/AQAAAAB///+/v/////AAAAA' +
  'AAAAAC+AAAAAAD/////2/////gAAAAAAAAAAeAwAAAAD////f/D///8gAAAAAAAAAAfGGAAAAH////v/B/z/wAAAAAAAAAAA' +
  'PMBwAAAD////v+A/h+gAAAAAAAAAAAH8AAAAAD////38A+B/AgAAAAAAAAAAAfAAAAAH////3wAcAfggAAAAAAAAAAAHAAAA' +
  'AH////+AAcAfgwAAAAAAAAAAABD4AAAD////9wAMAXAYAAAAAAAAAAAA//AAAB/////gAOAQAYAAAAAAAAAAAAH/gAAA////' +
  '/gACAIAYAAAAAAAAAAAAH/8AAAfH///AAAAsGAAAAAAAAAAAAAH/+AAAAB///AAAA8OAAAAAAAAAAAAAP/+AAAAD//8AAAAc' +
  '+wAAAAAAAAAAAAf//gAAAD//4AAAAMeggAAAAAAAAAAAP//8AAAB//wAAAAGdg+AAAAAAAAAAAf///AAAA//wAAAACAQPkAA' +
  'AAAAAAAAP///gAAA//wAAAABwAHwAAAAAAAAAAP///gAAA//wAAAAAAoDYAAAAAAAAAAH///AAAAf/wAAAAAAAAAAAAAAAAA' +
  'AAH//+AAAA//4gAAAAABxAAAAAAAAAAAD//+AAAA//xgAAAAAPxgAAAAAAAAAAA//+AAAA//zgAAAAAf/gAAAAAAAAAAAf/8' +
  'AAAA//DgAAAAA//wAAAAAAAAAAAf/8AAAAf/DAAAAAD//4CAAAAAAAAAAf/4AAAAf/DAAAAAH//8AAAAAAAAAAAf/AAAAAf+' +
  'DAAAAAH//8AAAAAAAAAAA//AAAAAf+AAAAAAH//+AAAAAAAAAAA//AAAAAP8AAAAAAH//+AAAAAAAAAAA/+AAAAAH4AAAAAA' +
  'H//+AAAAAAAAAAA/8AAAAAHwAAAAAAD4f8AAAAAAAAAAA/4AAAAAAAAAAAAACAH8AAAAAAAAAAB/wAAAAAAAAAAAAAAAD4AE' +
  'AAAAAAAAB/AAAAAAAAAAAAAAAABAAGAAAAAAAAB+AAAAAAAAAAAAAAAAAwAMAAAAAAAAB8AAAAAAAAAAAAAAAAAQAYAAAAAA' +
  'AAB4AAAAAAAAAAAAAAAAAABwAAAAAAAAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AAAAAAAAAACAAAAAAAAAAAAAAAAADwAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAA/AB/////gAAAAAAAAAAAsAAAAAAADv/+H//////gA' +
  'AAAAAAAAB+AAAAPf////8////////gAAAAAAPeB/AAAD///////////////gAABf/////8AAAH//////////////+AAB////' +
  '///AAAH///////////////8AAM//////8ABw////////////////+AAAf///////Hj////////////////4AAAf/////////' +
  '/////////////////A//////////////////////////////////////////////////////////////////////////////' +
  '////////////';

let bits: Uint8Array | null = null;

/** Decoded on first use, then kept. Never decoded during a frame. */
function unpack(): Uint8Array {
  if (bits) return bits;
  const raw = atob(PACKED);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  bits = out;
  return out;
}

/** Land at this latitude/longitude in degrees. */
export function isLand(latDeg: number, lonDeg: number): boolean {
  const b = unpack();
  let row = Math.floor(((90 - latDeg) / 180) * H);
  let col = Math.floor(((lonDeg + 180) / 360) * W);
  if (row < 0) row = 0;
  else if (row >= H) row = H - 1;
  // Longitude wraps; latitude clamps. The date line is a seam only if the
  // column is clamped instead of wrapped, which shows as a bald stripe.
  col = ((col % W) + W) % W;
  const i = row * W + col;
  return (b[i >> 3] & (128 >> (i & 7))) !== 0;
}

/**
 * Land under a unit direction vector, y-up.
 *
 * The globe is built in direction space, so this is the form the generator
 * actually calls; it saves every caller repeating the same conversion and
 * getting the pole convention wrong half the time.
 */
export function isLandAtDirection(dx: number, dy: number, dz: number): boolean {
  const latDeg = Math.asin(Math.max(-1, Math.min(1, dy))) * (180 / Math.PI);
  const lonDeg = Math.atan2(dz, dx) * (180 / Math.PI);
  return isLand(latDeg, lonDeg);
}
