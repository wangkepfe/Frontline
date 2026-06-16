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

  it('the home gold mine sits BEHIND the HQ (safe rear, never raided turn one)', () => {
    for (const seed of SEEDS) {
      const map = new GameMap(generateMap(seed));
      const [hq0, hq1] = map.hq;
      // the only mine within cheb 2 of the HQ is the home/safe mine
      const home = map.goldMines.find((m) => Math.max(Math.abs(m.c - hq0.c), Math.abs(m.r - hq0.r)) <= 2);
      expect(home, `seed ${seed} home mine`).toBeDefined();
      // "behind" = the projection onto the toward-enemy axis is negative
      const dot = (home!.c - hq0.c) * (hq1.c - hq0.c) + (home!.r - hq0.r) * (hq1.r - hq0.r);
      expect(dot, `seed ${seed} home mine behind HQ`).toBeLessThan(0);
    }
  });

  describe('unbalanced (elite/boss) sectors', () => {
    const cheb = (a: { c: number; r: number }, b: { c: number; r: number }) =>
      Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));

    for (const bias of [0.5, 0.85, 1.0]) {
      it(`bias ${bias}: stays connected & fair-to-traverse but tilts to the defender`, () => {
        for (const seed of SEEDS.slice(0, 20)) {
          const layout = generateMap(seed, { bias });
          const map = new GameMap(layout); // throws on malformed
          const [hq0, hq1] = map.hq;

          // still playable: every objective reachable by the ATTACKER (team 0)
          const blocked = new Uint8Array(MAP_W * MAP_H);
          expect(findPath(map, blocked, hq0, hq1), `seed ${seed} HQ path`).not.toBeNull();
          for (const m of [...map.goldMines, ...map.oilFields]) {
            expect(findPath(map, blocked, hq0, m), `seed ${seed} mine ${m.c},${m.r}`).not.toBeNull();
          }

          // deliberately NOT symmetric (the whole point of a biased map)
          let asymmetric = false;
          for (let r = 0; r < MAP_H && !asymmetric; r++) {
            for (let c = 0; c < MAP_W; c++) {
              if (map.terrainAt(c, r) !== map.terrainAt(MAP_W - 1 - c, MAP_H - 1 - r)) {
                asymmetric = true;
                break;
              }
            }
          }
          expect(asymmetric, `seed ${seed} should be asymmetric`).toBe(true);

          // defender economy edge: more gold than the fair 6, and more of it on
          // the enemy's side than the attacker's
          expect(map.goldMines.length, `seed ${seed} gold count`).toBeGreaterThan(6);
          const def = map.goldMines.filter((m) => cheb(m, hq1) < cheb(m, hq0)).length;
          const atk = map.goldMines.filter((m) => cheb(m, hq0) < cheb(m, hq1)).length;
          expect(def, `seed ${seed} defender mines > attacker mines`).toBeGreaterThan(atk);
        }
      });
    }

    it('is deterministic per (seed, bias)', () => {
      expect(generateMap(42, { bias: 0.85 }).join('\n')).toBe(generateMap(42, { bias: 0.85 }).join('\n'));
      // a biased map differs from the fair one for the same seed
      expect(generateMap(42, { bias: 1 }).join('\n')).not.toBe(generateMap(42).join('\n'));
    });
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
