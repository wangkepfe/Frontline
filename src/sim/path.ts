import { GameMap, TilePos, MAP_W, MAP_H } from './map';

/** Deterministic per-tile noise in [0,1) — keyed so each seed gets its own terrain "taste". */
function tileNoise(idx: number, seed: number): number {
  let h = (idx * 374761393 + seed * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const SQRT2 = Math.SQRT2;

/**
 * A* over the tile grid, 8-connected (orthogonal + diagonal moves).
 * `blocked` is the building-occupancy bitmap maintained by the sim.
 * The goal tile is allowed to be blocked (units path *to* buildings to attack them).
 *
 * Diagonal steps are open passage unless sealed: the destination must be
 * passable AND at least one of the two orthogonal side tiles must be passable,
 * so units never phase through a corner pinched shut by river/mountain/
 * buildings (river elbows are painted 4-connected by mapgen, which makes every
 * cross-river corner sealed).
 *
 * `jitterSeed` (optional) adds a small deterministic per-tile cost noise unique
 * to that seed: same seed → same preferred route, different seeds → different
 * routes. Attacking units pass their id so a column doesn't single-file down
 * one identical shortest path.
 */
export function findPath(
  map: GameMap,
  blocked: Uint8Array,
  start: TilePos,
  goal: TilePos,
  jitterSeed?: number
): TilePos[] | null {
  const w = MAP_W;
  const n = MAP_W * MAP_H;
  const startIdx = start.r * w + start.c;
  const goalIdx = goal.r * w + goal.c;
  if (startIdx === goalIdx) return [];

  const gScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  gScore[startIdx] = 0;

  // tiny binary heap of [f, idx]
  const heap: number[] = []; // pairs flattened: f at 2i, idx at 2i+1
  const push = (f: number, idx: number) => {
    heap.push(f, idx);
    let i = heap.length / 2 - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p * 2] <= heap[i * 2]) break;
      const tf = heap[p * 2], ti = heap[p * 2 + 1];
      heap[p * 2] = heap[i * 2]; heap[p * 2 + 1] = heap[i * 2 + 1];
      heap[i * 2] = tf; heap[i * 2 + 1] = ti;
      i = p;
    }
  };
  const pop = (): number => {
    const idx = heap[1];
    const lf = heap.pop()!, li = heap.pop()!;
    // note: popped in reverse order — li is the last f, lf is the last idx
    if (heap.length > 0) {
      heap[0] = li; heap[1] = lf;
      let i = 0;
      const size = heap.length / 2;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let m = i;
        if (l < size && heap[l * 2] < heap[m * 2]) m = l;
        if (r < size && heap[r * 2] < heap[m * 2]) m = r;
        if (m === i) break;
        const tf = heap[m * 2], ti = heap[m * 2 + 1];
        heap[m * 2] = heap[i * 2]; heap[m * 2 + 1] = heap[i * 2 + 1];
        heap[i * 2] = tf; heap[i * 2 + 1] = ti;
        i = m;
      }
    }
    return idx;
  };

  // octile distance — admissible with diagonal moves at cost √2
  const hCost = (idx: number) => {
    const c = idx % w, r = (idx / w) | 0;
    const dx = Math.abs(c - goal.c), dy = Math.abs(r - goal.r);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };

  // a side tile seals a diagonal when it's unwalkable terrain or a building
  const passable = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= w || r >= MAP_H) return false;
    return map.props(c, r).walkable && !blocked[r * w + c];
  };

  push(hCost(startIdx), startIdx);
  const DIRS: Array<[number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  while (heap.length > 0) {
    const cur = pop();
    if (cur === goalIdx) {
      const path: TilePos[] = [];
      let i = goalIdx;
      while (i !== startIdx) {
        path.push({ c: i % w, r: (i / w) | 0 });
        i = cameFrom[i];
      }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % w, cr = (cur / w) | 0;
    for (const [dc, dr] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= w || nr >= MAP_H) continue;
      const nb = nr * w + nc;
      const props = map.props(nc, nr);
      if (!props.walkable) continue;
      if (blocked[nb] && nb !== goalIdx) continue;
      const diagonal = dc !== 0 && dr !== 0;
      // never slip through a sealed corner (both side tiles shut)
      if (diagonal && !passable(cc + dc, cr) && !passable(cc, cr + dr)) continue;
      const noise = jitterSeed === undefined ? 0 : tileNoise(nb, jitterSeed) * 0.65;
      const g = gScore[cur] + props.moveCost * (diagonal ? SQRT2 : 1) + noise;
      if (g < gScore[nb]) {
        gScore[nb] = g;
        cameFrom[nb] = cur;
        push(g + hCost(nb), nb);
      }
    }
  }
  return null;
}

/** Bresenham line-of-sight between tile centers; mountains block sight. */
export function hasLineOfSight(map: GameMap, a: TilePos, b: TilePos): boolean {
  let x0 = a.c, y0 = a.r;
  const x1 = b.c, y1 = b.r;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (!(x0 === a.c && y0 === a.r) && !(x0 === x1 && y0 === y1)) {
      if (map.props(x0, y0).blocksSight) return false;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return true;
}
