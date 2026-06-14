import { Rng } from './rng';
import { DEFAULT_LAYOUT, GameMap, MAP_H, MAP_W, TilePos } from './map';
import { findPath } from './path';

/**
 * Procedural battlefield generator. Every map is:
 *  - 180°-rotationally symmetric (fair by construction),
 *  - connected (mountains never seal a player in — validated, not hoped),
 *  - economically fair (mirrored home / mid / contested gold + oil),
 *  - varied: winding rivers (horizontal or vertical), 2-3 bridges,
 *    scattered ridges and forests.
 */

const W = MAP_W;
const H = MAP_H;
const HQ_A: TilePos = { c: 2, r: 10 };
const HQ_B: TilePos = { c: 10, r: 2 };

class Canvas13 {
  grid: string[][];
  constructor() {
    this.grid = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
  }
  get(c: number, r: number): string {
    return this.grid[r][c];
  }
  /** set a cell and its 180°-mirror (HQ markers swap) */
  set(c: number, r: number, ch: string): void {
    this.grid[r][c] = ch;
    const mc = W - 1 - c;
    const mr = H - 1 - r;
    const mirrored = ch === '1' ? '2' : ch === '2' ? '1' : ch;
    this.grid[mr][mc] = mirrored;
  }
  rows(): string[] {
    return this.grid.map((row) => row.join(''));
  }
}

function cheb(a: TilePos, b: TilePos): number {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}

/** cells in the canonical half (scan order before the center cell) */
function inHalf(c: number, r: number): boolean {
  return r * W + c < (H * W - 1) / 2;
}

interface GenState {
  cv: Canvas13;
  rng: Rng;
  riverCells: TilePos[];
  horizontal: boolean;
  mountainClusters: TilePos[][];
}

function carveRiver(st: GenState): void {
  const { cv, rng } = st;
  const horizontal = rng.next() < 0.5;
  st.horizontal = horizontal;
  // walk from the edge to the center with vertical jitter; the mirror
  // completes the other half so the river always spans the map
  let cross = 3 + rng.int(7); // start row (or column) in [3..9]
  for (let along = 0; along <= 6; along++) {
    const remaining = 6 - along;
    const prev = cross;
    // bias toward hitting the center as we approach it
    if (Math.abs(cross - 6) >= remaining) {
      cross += Math.sign(6 - cross);
    } else if (along > 0 && rng.next() < 0.45) {
      const dir = rng.next() < 0.5 ? -1 : 1;
      const next = Math.min(9, Math.max(3, cross + dir));
      if (Math.abs(next - 6) <= remaining) cross = next;
    }
    // seal every elbow: when the channel shifts, this column carries BOTH cells,
    // so the river stays 4-connected — no corner-only gaps, and it renders as a
    // continuous bend instead of disconnected pools
    if (along > 0 && cross !== prev) {
      const elbow = horizontal ? { c: along, r: prev } : { c: prev, r: along };
      cv.set(elbow.c, elbow.r, '~');
      st.riverCells.push(elbow);
    }
    const cell = horizontal ? { c: along, r: cross } : { c: cross, r: along };
    cv.set(cell.c, cell.r, '~');
    st.riverCells.push(cell);
  }
}

function placeBridges(st: GenState): void {
  const { cv, rng, horizontal } = st;
  // "thin" crossings: exactly one water cell on that column (or row)
  const thickness = (along: number) => {
    let n = 0;
    for (let x = 0; x < W; x++) {
      const ch = horizontal ? cv.get(along, x) : cv.get(x, along);
      if (ch === '~') n++;
    }
    return n;
  };
  const thin = st.riverCells.filter((cell) => {
    const along = horizontal ? cell.c : cell.r;
    return along >= 1 && along <= 5 && thickness(along) === 1;
  });
  rng.shuffle(thin);
  const centerBridge = rng.next() < 0.4;
  if (centerBridge && thickness(6) === 1) cv.set(6, 6, 'B');
  const want = centerBridge ? 1 : 1 + (rng.next() < 0.6 ? 1 : 0);
  const placed: number[] = [];
  for (const cell of thin) {
    if (placed.length >= want) break;
    const along = horizontal ? cell.c : cell.r;
    if (placed.some((p) => Math.abs(p - along) < 3)) continue;
    if (centerBridge && Math.abs(along - 6) < 3) continue;
    cv.set(cell.c, cell.r, 'B'); // mirror adds the partner bridge
    placed.push(along);
  }
  // guarantee at least one crossing even on a very kinked river — but only on a
  // thin column: a bridge on an elbow column would dead-end into the second cell
  const anyBridge = st.riverCells.some((x) => cv.get(x.c, x.r) === 'B') || cv.get(6, 6) === 'B';
  if (!anyBridge) {
    const cell =
      st.riverCells.find((x) => (horizontal ? x.c : x.r) <= 5 && thickness(horizontal ? x.c : x.r) === 1) ??
      st.riverCells.find((x) => thickness(horizontal ? x.c : x.r) === 1) ??
      st.riverCells[0];
    cv.set(cell.c, cell.r, 'B');
  }
}

function placeMountains(st: GenState): void {
  const { cv, rng } = st;
  const ok = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= W || r >= H) return false;
    if (cv.get(c, r) !== '.') return false;
    if (cheb({ c, r }, HQ_A) <= 2 || cheb({ c, r }, HQ_B) <= 2) return false;
    // keep river banks and bridge approaches open
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
        const ch = cv.get(cc, rr);
        if (ch === 'B' || ch === '~') return false;
      }
    }
    return true;
  };
  const clusters = 3 + rng.int(3);
  for (let k = 0; k < clusters; k++) {
    const seedC = rng.int(W);
    const seedR = rng.int(H);
    if (!inHalf(seedC, seedR) || !ok(seedC, seedR)) continue;
    const cluster: TilePos[] = [];
    let cur = { c: seedC, r: seedR };
    const size = 1 + rng.int(3);
    for (let i = 0; i < size; i++) {
      if (!ok(cur.c, cur.r)) break;
      cv.set(cur.c, cur.r, 'M');
      cluster.push({ ...cur });
      const dirs = rng.shuffle([
        { c: cur.c + 1, r: cur.r }, { c: cur.c - 1, r: cur.r },
        { c: cur.c, r: cur.r + 1 }, { c: cur.c, r: cur.r - 1 }
      ]);
      const next = dirs.find((d) => ok(d.c, d.r));
      if (!next) break;
      cur = next;
    }
    if (cluster.length > 0) st.mountainClusters.push(cluster);
  }
}

function pickLand(st: GenState, filter: (c: number, r: number) => boolean): TilePos | null {
  const opts: TilePos[] = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (st.cv.get(c, r) === '.' && filter(c, r)) opts.push({ c, r });
    }
  }
  return opts.length > 0 ? opts[st.rng.int(opts.length)] : null;
}

function placeResources(st: GenState): boolean {
  const { cv, rng } = st;
  const nearWater = (c: number, r: number) => {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
        const ch = cv.get(cc, rr);
        if (ch === '~' || ch === 'B') return true;
      }
    }
    return false;
  };
  // home mine: safe, by the HQ
  const home = pickLand(st, (c, r) => cheb({ c, r }, HQ_A) >= 1 && cheb({ c, r }, HQ_A) <= 2);
  if (!home) return false;
  cv.set(home.c, home.r, 'G');
  // mid mine: your half, must be defended on purpose
  const mid = pickLand(st, (c, r) => cheb({ c, r }, HQ_A) >= 3 && cheb({ c, r }, HQ_A) <= 5 && cheb({ c, r }, HQ_B) >= 6 && cheb({ c, r }, home) >= 2);
  if (!mid) return false;
  cv.set(mid.c, mid.r, 'G');
  // contested mine: out by the river/center
  const contested =
    pickLand(st, (c, r) => cheb({ c, r }, HQ_A) >= 5 && cheb({ c, r }, HQ_B) >= 5 && nearWater(c, r)) ??
    pickLand(st, (c, r) => cheb({ c, r }, HQ_A) >= 5 && cheb({ c, r }, HQ_B) >= 5);
  if (!contested) return false;
  cv.set(contested.c, contested.r, 'G');
  // oil: one per side, mid-depth (sometimes a second for armor-heavy maps)
  const oil = pickLand(st, (c, r) => cheb({ c, r }, HQ_A) >= 3 && cheb({ c, r }, HQ_A) <= 6 && cheb({ c, r }, HQ_B) >= 4);
  if (!oil) return false;
  cv.set(oil.c, oil.r, 'O');
  if (rng.next() < 0.3) {
    const oil2 = pickLand(st, (c, r) => cheb({ c, r }, HQ_A) >= 5 && cheb({ c, r }, HQ_B) >= 5 && cheb({ c, r }, oil) >= 3);
    if (oil2) cv.set(oil2.c, oil2.r, 'O');
  }
  return true;
}

function placeForests(st: GenState): void {
  const { cv, rng } = st;
  const clusters = 4 + rng.int(3);
  for (let k = 0; k < clusters; k++) {
    let cur: TilePos | null = pickLand(st, (c, r) => inHalf(c, r) && cheb({ c, r }, HQ_A) >= 1 && cheb({ c, r }, HQ_B) >= 1);
    if (!cur) return;
    const size = 1 + rng.int(3);
    for (let i = 0; i < size && cur; i++) {
      cv.set(cur.c, cur.r, 'F');
      const dirs: TilePos[] = rng.shuffle([
        { c: cur.c + 1, r: cur.r }, { c: cur.c - 1, r: cur.r },
        { c: cur.c, r: cur.r + 1 }, { c: cur.c, r: cur.r - 1 }
      ]);
      cur = dirs.find((d) => d.c >= 0 && d.r >= 0 && d.c < W && d.r < H && cv.get(d.c, d.r) === '.') ?? null;
    }
  }
}

/** mountains must never seal anything off: validate, peel clusters if needed */
function validate(st: GenState): boolean {
  let layout: string[];
  for (let attempt = 0; attempt <= st.mountainClusters.length; attempt++) {
    layout = st.cv.rows();
    let map: GameMap;
    try {
      map = new GameMap(layout);
    } catch {
      return false;
    }
    const blocked = new Uint8Array(W * H);
    const connected = findPath(map, blocked, map.hq[0], map.hq[1]) !== null;
    const minesOk =
      map.goldMines.length >= 4 &&
      map.goldMines.every((m) => findPath(map, blocked, map.hq[0], m) !== null) &&
      map.oilFields.every((o) => findPath(map, blocked, map.hq[0], o) !== null);
    // breathing room for the opening build
    let openNearHq = 0;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const c = HQ_A.c + dc, r = HQ_A.r + dr;
        if (c < 0 || r < 0 || c >= W || r >= H) continue;
        if (map.terrainAt(c, r) === 'land') openNearHq++;
      }
    }
    if (connected && minesOk && openNearHq >= 10) return true;
    // peel a mountain cluster and try again
    const cluster = st.mountainClusters.pop();
    if (!cluster) return false;
    for (const cell of cluster) st.cv.set(cell.c, cell.r, '.');
  }
  return false;
}

export function generateMap(seed: number): string[] {
  for (let attempt = 0; attempt < 30; attempt++) {
    const rng = new Rng((seed + attempt * 7919) >>> 0);
    const st: GenState = {
      cv: new Canvas13(),
      rng,
      riverCells: [],
      horizontal: true,
      mountainClusters: []
    };
    st.cv.set(HQ_A.c, HQ_A.r, '1'); // mirror writes the '2'
    carveRiver(st);
    placeBridges(st);
    placeMountains(st);
    if (!placeResources(st)) continue;
    placeForests(st);
    if (validate(st)) return st.cv.rows();
  }
  // pathological seed: fall back to the curated map (never expected in practice)
  return [...DEFAULT_LAYOUT];
}
