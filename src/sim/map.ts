/**
 * The battlefield: a 13x13 grid rendered as isometric diamonds.
 * 180°-rotationally symmetric so both players get a fair but characterful map.
 *
 * Legend: . land | F forest | M mountain | ~ water | B bridge | G gold mine
 *         O oil field | 1 HQ team 0 | 2 HQ team 1 (HQ tiles are land terrain)
 */

export type Terrain = 'land' | 'forest' | 'mountain' | 'water' | 'bridge' | 'gold' | 'oil';

export interface TilePos {
  c: number;
  r: number;
}

export const MAP_W = 13;
export const MAP_H = 13;

/**
 * Battle maps. All are 180°-rotationally symmetric. Author the south half,
 * mirror the north — the symmetry test enforces it.
 */
export const LAYOUTS: Record<string, string[]> = {
  // two bridges, contested riverside gold, asymmetric flanks
  riverDelta: [
    'MM.........MM', // r0
    'M....F.....G.', // r1
    'MM.....F..2..', // r2
    '..F........F.', // r3
    'M...F..O.F...', // r4
    '...FGFM...FMM', // r5
    '~~~B~~~~~B~~~', // r6  — the river; bridges at c=3 and c=9
    'MMF...MFGF...', // r7
    '...F.O..F...M', // r8
    '.F........F..', // r9
    '..1..F.....MM', // r10
    '.G.....F....M', // r11
    'MM.........MM'  // r12
  ],
  // three bridges, safer economy, wide-open three-lane brawl
  twinCrossing: [
    'MM....M....MM',
    '.......F.....',
    '..M.......2..',
    'M...F...F...M',
    '..G...O...G..',
    '.F...M.M...F.',
    '~~B~~~B~~~B~~',
    '.F...M.M...F.',
    '..G...O...G..',
    'M...F...F...M',
    '..1.......M..',
    '.....F.......',
    'MM....M....MM'
  ],
  // twin center bridges, mountain bastions — a grinding chokepoint fight
  bastion: [
    'MMM.......MMM',
    '..........F..',
    'M.....F...2.M',
    '..M.......M..',
    '.G..F.O.F..G.',
    '...M.....M...',
    '~~~~~B~B~~~~~',
    '...M.....M...',
    '.G..F.O.F..G.',
    '..M.......M..',
    'M.1...F.....M',
    '..F..........',
    'MMM.......MMM'
  ]
};

export const DEFAULT_LAYOUT = LAYOUTS.riverDelta;

const CHAR_TERRAIN: Record<string, Terrain> = {
  '.': 'land',
  F: 'forest',
  M: 'mountain',
  '~': 'water',
  B: 'bridge',
  G: 'gold',
  O: 'oil',
  '1': 'land',
  '2': 'land'
};

export interface TerrainProps {
  walkable: boolean;
  buildable: boolean; // generic buildings; gold/oil tiles only accept their extractor
  moveCost: number;
  cover: number; // fraction of ranged damage absorbed for units standing here
  blocksSight: boolean;
}

export const TERRAIN_PROPS: Record<Terrain, TerrainProps> = {
  land:     { walkable: true,  buildable: true,  moveCost: 1,   cover: 0,   blocksSight: false },
  forest:   { walkable: true,  buildable: false, moveCost: 1,   cover: 0.3, blocksSight: false },
  mountain: { walkable: false, buildable: false, moveCost: Infinity, cover: 0, blocksSight: true },
  water:    { walkable: false, buildable: false, moveCost: Infinity, cover: 0, blocksSight: false },
  bridge:   { walkable: true,  buildable: false, moveCost: 1,   cover: 0,   blocksSight: false },
  gold:     { walkable: true,  buildable: false, moveCost: 1,   cover: 0,   blocksSight: false },
  oil:      { walkable: true,  buildable: false, moveCost: 1,   cover: 0,   blocksSight: false }
};

export class GameMap {
  readonly w = MAP_W;
  readonly h = MAP_H;
  readonly terrain: Terrain[]; // index r * w + c
  readonly hq: [TilePos, TilePos];
  readonly bridges: TilePos[] = [];
  readonly goldMines: TilePos[] = [];
  readonly oilFields: TilePos[] = [];

  constructor(layout: string[] = DEFAULT_LAYOUT) {
    this.terrain = new Array(this.w * this.h);
    let hq0: TilePos | null = null;
    let hq1: TilePos | null = null;
    for (let r = 0; r < this.h; r++) {
      const row = layout[r];
      if (row.length !== this.w) throw new Error(`map row ${r} has length ${row.length}`);
      for (let c = 0; c < this.w; c++) {
        const ch = row[c];
        const t = CHAR_TERRAIN[ch];
        if (!t) throw new Error(`unknown map char '${ch}' at ${c},${r}`);
        this.terrain[r * this.w + c] = t;
        if (ch === '1') hq0 = { c, r };
        if (ch === '2') hq1 = { c, r };
        if (t === 'bridge') this.bridges.push({ c, r });
        if (t === 'gold') this.goldMines.push({ c, r });
        if (t === 'oil') this.oilFields.push({ c, r });
      }
    }
    if (!hq0 || !hq1) throw new Error('map must define both HQs');
    this.hq = [hq0, hq1];
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.w && r < this.h;
  }

  terrainAt(c: number, r: number): Terrain {
    return this.terrain[r * this.w + c];
  }

  props(c: number, r: number): TerrainProps {
    return TERRAIN_PROPS[this.terrainAt(c, r)];
  }

  idx(c: number, r: number): number {
    return r * this.w + c;
  }
}

/**
 * Physical blocking core of an unwalkable tile, as a half-extent from its
 * center. Deliberately smaller than the rounding half-extent (0.5): the outer
 * band of a river/mountain tile is passable space, so a unit hugging a tile
 * edge slides around corners instead of snagging, and the seam between two
 * adjacent unwalkable tiles stays an open lane (1 − 2·HB wide) — a troop can
 * squeeze vertically/horizontally between two side-by-side water tiles.
 * Pathfinding still routes tile-by-tile around water; this only governs where
 * a continuous position may physically rest.
 */
export const TERRAIN_BLOCK_HALF = 0.35;

/**
 * Push a continuous position out of every nearby unwalkable tile's blocking
 * core, along the axis of least penetration (move-and-slide). Per-tick steps
 * (≤ ~0.24) are shallow against the 0.35 core, so ejection always returns the
 * point to the side it entered from — no tunneling.
 */
export function pushOutOfTerrain(map: GameMap, p: { x: number; y: number }): void {
  const HB = TERRAIN_BLOCK_HALF;
  // two sweeps: in a pinched corner one ejection can graze a neighbor's core
  for (let pass = 0; pass < 2; pass++) {
    const c0 = Math.round(p.x), r0 = Math.round(p.y);
    let moved = false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (!map.inBounds(c, r)) continue;
        if (map.props(c, r).walkable) continue;
        const dx = p.x - c, dy = p.y - r;
        if (Math.abs(dx) >= HB || Math.abs(dy) >= HB) continue;
        if (HB - Math.abs(dx) <= HB - Math.abs(dy)) {
          p.x = c + (dx >= 0 ? HB : -HB);
        } else {
          p.y = r + (dy >= 0 ? HB : -HB);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function tileKey(c: number, r: number): number {
  return r * MAP_W + c;
}

export function chebyshev(a: TilePos, b: TilePos): number {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}
