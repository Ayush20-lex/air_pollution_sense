/**
 * Marching-squares iso-contour extraction.
 *
 * Deliberately dependency-free and in grid space (no lat/lng, no Leaflet), so
 * it can be reasoned about and tested on its own. The caller projects the
 * returned points onto the map.
 *
 * Replaces the old "outline every cell above a cutoff" plume layer, which drew
 * right-angled staircases around the hot core instead of real contours.
 */

/** Row-major scalar field. `values[y * w + x]`. */
export type ScalarGrid = { w: number; h: number; values: number[] };

/** A point in grid space; x in [0, w-1], y in [0, h-1], fractional. */
export type GridPoint = [number, number];

type Edge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Which edges each marching-squares case connects.
 *
 * Bits, high to low: top-left, top-right, bottom-right, bottom-left — set when
 * that corner is at or above the threshold. Cases 5 and 10 are the ambiguous
 * saddles and are resolved below using the cell average.
 */
const CASES: Record<number, [Edge, Edge][]> = {
  1: [['left', 'bottom']],
  2: [['bottom', 'right']],
  3: [['left', 'right']],
  4: [['top', 'right']],
  6: [['top', 'bottom']],
  7: [['left', 'top']],
  8: [['left', 'top']],
  9: [['top', 'bottom']],
  11: [['top', 'right']],
  12: [['left', 'right']],
  13: [['bottom', 'right']],
  14: [['left', 'bottom']],
};

/** Linear interpolation of the crossing point along one cell edge. */
function crossing(
  edge: Edge,
  x: number,
  y: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
  t: number,
): GridPoint {
  const lerp = (a: number, b: number) => {
    const d = b - a;
    // A flat edge has no meaningful crossing; park it at the midpoint.
    return Math.abs(d) < 1e-9 ? 0.5 : (t - a) / d;
  };
  switch (edge) {
    case 'top':
      return [x + lerp(tl, tr), y];
    case 'right':
      return [x + 1, y + lerp(tr, br)];
    case 'bottom':
      return [x + lerp(bl, br), y + 1];
    case 'left':
      return [x, y + lerp(tl, bl)];
  }
}

const KEY_PRECISION = 1e4;
const key = (p: GridPoint) =>
  `${Math.round(p[0] * KEY_PRECISION)}:${Math.round(p[1] * KEY_PRECISION)}`;

/**
 * Extract iso-contours at `threshold`.
 *
 * Returns a list of polylines. Rings come back closed (first point repeated at
 * the end); contours that run off the edge of the grid stay open.
 */
export function isoContours(grid: ScalarGrid, threshold: number): GridPoint[][] {
  const { w, h, values } = grid;
  if (w < 2 || h < 2) return [];

  const at = (x: number, y: number) => values[y * w + x];
  const segments: [GridPoint, GridPoint][] = [];

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);

      const index =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);

      if (index === 0 || index === 15) continue;

      let pairs: [Edge, Edge][];
      if (index === 5 || index === 10) {
        // Saddle: the cell average decides which way the two strands pass.
        const avg = (tl + tr + br + bl) / 4;
        const joined = avg >= threshold;
        pairs =
          index === 5
            ? joined
              ? [
                  ['left', 'top'],
                  ['bottom', 'right'],
                ]
              : [
                  ['left', 'bottom'],
                  ['top', 'right'],
                ]
            : joined
              ? [
                  ['left', 'bottom'],
                  ['top', 'right'],
                ]
              : [
                  ['left', 'top'],
                  ['bottom', 'right'],
                ];
      } else {
        pairs = CASES[index];
      }

      for (const [a, b] of pairs) {
        segments.push([
          crossing(a, x, y, tl, tr, br, bl, threshold),
          crossing(b, x, y, tl, tr, br, bl, threshold),
        ]);
      }
    }
  }

  // A crossing that lands exactly on a grid vertex (corner value == threshold)
  // emits a zero-length segment on two edges at once. Left in, those stitch
  // into degenerate 3-point "rings" beside the real contour.
  return stitch(segments.filter(([a, b]) => key(a) !== key(b)));
}

/** Join loose segments end-to-end into the longest polylines they support. */
function stitch(segments: [GridPoint, GridPoint][]): GridPoint[][] {
  const starts = new Map<string, number[]>();
  const used = new Array(segments.length).fill(false);

  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      const list = starts.get(k);
      if (list) list.push(i);
      else starts.set(k, [i]);
    }
  });

  const paths: GridPoint[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;

    const path: GridPoint[] = [segments[i][0], segments[i][1]];

    // Walk forward from the tail, then backward from the head.
    for (const forward of [true, false]) {
      for (;;) {
        const endpoint = forward ? path[path.length - 1] : path[0];
        const candidates = starts.get(key(endpoint)) ?? [];
        const next = candidates.find((c) => !used[c]);
        if (next === undefined) break;

        used[next] = true;
        const [a, b] = segments[next];
        const joinsAtA = key(a) === key(endpoint);
        const advance = joinsAtA ? b : a;
        if (forward) path.push(advance);
        else path.unshift(advance);

        // Closed the loop.
        if (key(path[0]) === key(path[path.length - 1])) break;
      }
    }

    // A ring needs three distinct vertices to enclose anything.
    const distinct = new Set(path.map(key)).size;
    if (distinct >= 3) paths.push(path);
  }

  return paths;
}

/**
 * Chaikin corner cutting. Two passes turn the marching-squares zig-zag into a
 * smooth curve without pulling it away from the true iso-line.
 */
export function smoothPath(path: GridPoint[], passes = 2): GridPoint[] {
  const closed = path.length > 2 && key(path[0]) === key(path[path.length - 1]);
  let pts = closed ? path.slice(0, -1) : path.slice();

  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) break;
    const out: GridPoint[] = [];
    if (!closed) out.push(pts[0]);

    const last = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }

    if (!closed) out.push(pts[pts.length - 1]);
    pts = out;
  }

  return closed ? [...pts, pts[0]] : pts;
}

/** Bilinear sample, used to verify a contour actually sits on its threshold. */
export function sampleGrid(grid: ScalarGrid, x: number, y: number): number {
  const { w, h, values } = grid;
  const cx = Math.max(0, Math.min(w - 1.0001, x));
  const cy = Math.max(0, Math.min(h - 1.0001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const v = (xx: number, yy: number) => values[yy * w + xx];
  const top = v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx;
  const bottom = v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
