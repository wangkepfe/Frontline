import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/sim/mapgen';
import { GameMap, MAP_H, MAP_W } from '../src/sim/map';
import { findPath } from '../src/sim/path';

describe('procedural map generator', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i * 1237 + 11);

  it('every generated map is well-formed, symmetric, connected, and fair', () => {
    for (const seed of SEEDS) {
      const layout = generateMap(seed);
      expect(layout.length, `seed ${seed} rows`).toBe(MAP_H);
      for (const row of layout) expect(row.length, `seed ${seed} cols`).toBe(MAP_W);

      const map = new GameMap(layout); // throws on malformed maps
      // 180° rotational symmetry — fairness by construction
      for (let r = 0; r < MAP_H; r++) {
        for (let c = 0; c < MAP_W; c++) {
          expect(map.terrainAt(c, r), `seed ${seed} (${c},${r})`).toBe(map.terrainAt(MAP_W - 1 - c, MAP_H - 1 - r));
        }
      }
      // economy: 6 mirrored gold mines, 2-4 oil, at least one crossing
      expect(map.goldMines.length, `seed ${seed} gold`).toBe(6);
      expect(map.oilFields.length, `seed ${seed} oil`).toBeGreaterThanOrEqual(2);
      expect(map.bridges.length, `seed ${seed} bridges`).toBeGreaterThanOrEqual(1);

      // mountains never seal anything: HQs connected, every resource reachable
      const blocked = new Uint8Array(MAP_W * MAP_H);
      expect(findPath(map, blocked, map.hq[0], map.hq[1]), `seed ${seed} HQ path`).not.toBeNull();
      for (const m of [...map.goldMines, ...map.oilFields]) {
        expect(findPath(map, blocked, map.hq[0], m), `seed ${seed} mine ${m.c},${m.r}`).not.toBeNull();
      }
    }
  }, 30000);

  it('is deterministic per seed and varied across seeds', () => {
    expect(generateMap(123).join('\n')).toBe(generateMap(123).join('\n'));
    const distinct = new Set(SEEDS.slice(0, 12).map((s) => generateMap(s).join('')));
    expect(distinct.size).toBeGreaterThanOrEqual(10);
  });

  it('rivers wind: not every generated river is a straight line', () => {
    let bent = 0;
    for (const seed of SEEDS.slice(0, 16)) {
      const map = new GameMap(generateMap(seed));
      const waterRows = new Set<number>();
      const waterCols = new Set<number>();
      for (let r = 0; r < MAP_H; r++) {
        for (let c = 0; c < MAP_W; c++) {
          const t = map.terrainAt(c, r);
          if (t === 'water' || t === 'bridge') {
            waterRows.add(r);
            waterCols.add(c);
          }
        }
      }
      // a straight river occupies exactly one row (or one column)
      if (waterRows.size > 1 && waterCols.size > 1) bent++;
    }
    expect(bent).toBeGreaterThanOrEqual(6);
  });
});
