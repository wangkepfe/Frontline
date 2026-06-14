import { describe, expect, it } from 'vitest';
import { GameMap, LAYOUTS, MAP_H, MAP_W, TERRAIN_BLOCK_HALF, TERRAIN_PROPS, pushOutOfTerrain } from '../src/sim/map';
import { findPath, hasLineOfSight } from '../src/sim/path';
import { Sim } from '../src/sim/sim';
import { DEFAULT_LOADOUT, AI_LOADOUTS, CARDS, flipSide, baseId } from '../src/sim/cards';
import { DAMAGE_MATRIX, CARD_TTL, DRAW_INTERVAL_MAX, HAND_SIZE, INITIAL_HAND, NUKE, NUKE_REDEAL, NUKE_UNLOCK_T, TIER_UNLOCK_DEAL } from '../src/sim/stats';
import { runHeadlessMatch, AI_PROFILES } from '../src/sim/ai';
import { isValidPlacement } from '../src/sim/placement';

const L: [string[], string[]] = [DEFAULT_LOADOUT, DEFAULT_LOADOUT];
/** mechanism unit tests predating the tech tree opt out of tiers + electricity */
const NOTECH = { rules: { tech: false } };

function stepFor(sim: Sim, seconds: number) {
  const ticks = Math.round(seconds / 0.05);
  for (let i = 0; i < ticks; i++) sim.step();
}

describe('maps', () => {
  for (const [name, layout] of Object.entries(LAYOUTS)) {
    const map = new GameMap(layout);
    it(`${name} is 180-degree rotationally symmetric`, () => {
      for (let r = 0; r < MAP_H; r++) {
        for (let c = 0; c < MAP_W; c++) {
          expect(map.terrainAt(c, r), `${name} (${c},${r})`).toBe(map.terrainAt(MAP_W - 1 - c, MAP_H - 1 - r));
        }
      }
    });
    it(`${name} HQs are connected and the economy exists`, () => {
      const blocked = new Uint8Array(MAP_W * MAP_H);
      expect(findPath(map, blocked, map.hq[0], map.hq[1])).not.toBeNull();
      expect(map.goldMines.length).toBeGreaterThanOrEqual(4);
      expect(map.oilFields.length).toBeGreaterThanOrEqual(2);
      expect(map.bridges.length).toBeGreaterThanOrEqual(2);
    });
  }

  it('riverDelta has the expected objectives', () => {
    const map = new GameMap();
    expect(map.bridges.length).toBe(2);
    expect(map.goldMines.length).toBe(4);
    expect(map.oilFields.length).toBe(2);
    expect(map.hq[0]).toEqual({ c: 2, r: 10 });
    expect(map.hq[1]).toEqual({ c: 10, r: 2 });
  });

  it('paths between HQs cross the river only on bridges', () => {
    const map = new GameMap();
    const blocked = new Uint8Array(MAP_W * MAP_H);
    const path = findPath(map, blocked, map.hq[0], map.hq[1]);
    expect(path).not.toBeNull();
    for (const t of path!) {
      if (t.r === 6) expect(map.terrainAt(t.c, t.r)).toBe('bridge');
    }
  });

  it('mountains block line of sight', () => {
    const map = new GameMap();
    expect(hasLineOfSight(map, { c: 5, r: 5 }, { c: 7, r: 5 })).toBe(false); // ridge at (6,5)
    expect(hasLineOfSight(map, { c: 0, r: 8 }, { c: 2, r: 8 })).toBe(true);
  });
});

describe('pathfinding', () => {
  /** open 13x13 test map (HQs in opposite corners), mutated per case */
  function gridMap(mut: (g: string[][]) => void = () => {}): GameMap {
    const g = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill('.') as string[]);
    g[0][0] = '1';
    g[12][12] = '2';
    mut(g);
    return new GameMap(g.map((row) => row.join('')));
  }
  const open = new Uint8Array(MAP_W * MAP_H);

  it('moves diagonally — no dog-leg zig-zags on open ground', () => {
    const path = findPath(gridMap(), open, { c: 0, r: 0 }, { c: 5, r: 5 })!;
    expect(path.length).toBe(5); // 4-connected would need 10 steps
  });

  it('forest is plain passage', () => {
    expect(TERRAIN_PROPS.forest.walkable).toBe(true);
    expect(TERRAIN_PROPS.forest.moveCost).toBe(1);
    const map = gridMap((g) => {
      for (let r = 0; r < MAP_H; r++) g[r][6] = 'F'; // tree belt
    });
    const path = findPath(map, open, { c: 4, r: 6 }, { c: 8, r: 6 })!;
    expect(path.length).toBe(4); // straight through the trees
  });

  it('never slips between corner-touching blockers', () => {
    const map = gridMap((g) => {
      g[6][6] = '~'; // water touching only at a corner —
      g[5][7] = '~'; // an unsealed elbow must not be a passage
    });
    const path = findPath(map, open, { c: 6, r: 5 }, { c: 7, r: 6 })!;
    expect(path.length).toBeGreaterThan(1); // detours around the pinch
  });

  it('diagonal passage is open when one corner side is clear', () => {
    const map = gridMap((g) => {
      g[6][6] = '~'; // single blocker beside the diagonal
    });
    const path = findPath(map, open, { c: 6, r: 5 }, { c: 7, r: 6 })!;
    expect(path.length).toBe(1);
  });

  it('a unit with no route to its goal wanders instead of freezing', () => {
    const g = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill('.') as string[]);
    // mountain ring seals the south-west pocket that holds HQ A
    for (let c = 0; c <= 4; c++) g[4][c] = 'M';
    for (let r = 0; r <= 4; r++) g[r][4] = 'M';
    g[2][2] = '1';
    g[10][10] = '2';
    const sim = new Sim(5, L, { mapLayout: g.map((row) => row.join('')), rules: { tech: false } });
    sim.spawnUnit(0, 'rifle', { x: 1, y: 1 }); // aggressive: pushes for the unreachable enemy HQ
    const u = sim.units[0];
    const start = { x: u.pos.x, y: u.pos.y };
    let maxMoved = 0;
    for (let i = 0; i < 10 / 0.05; i++) {
      sim.step();
      maxMoved = Math.max(maxMoved, Math.hypot(u.pos.x - start.x, u.pos.y - start.y));
    }
    expect(maxMoved).toBeGreaterThan(0.8);
  });
});

describe('terrain collision', () => {
  /** open layout with two side-by-side water tiles at (5,6)+(6,6), enemy HQ due south */
  function seamLayout(): string[] {
    const g = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill('.') as string[]);
    g[6][5] = '~';
    g[6][6] = '~';
    g[0][0] = '1';
    g[12][6] = '2';
    return g.map((row) => row.join(''));
  }

  it('unwalkable tiles block only their inset core — the seam between two waters is an open lane', () => {
    const map = new GameMap(seamLayout());
    expect(TERRAIN_BLOCK_HALF).toBeLessThan(0.5);

    const inLane = { x: 5.5, y: 6.0 }; // dead center of the seam between the two waters
    pushOutOfTerrain(map, inLane);
    expect(inLane).toEqual({ x: 5.5, y: 6.0 });

    const inCore = { x: 5.2, y: 6.0 }; // inside (5,6)'s core, nearest face is the seam side
    pushOutOfTerrain(map, inCore);
    expect(inCore.x).toBeCloseTo(5 + TERRAIN_BLOCK_HALF, 5);
    expect(inCore.y).toBeCloseTo(6.0, 5);

    const nearSouthFace = { x: 6.1, y: 6.3 }; // shallow on y: ejects south, not sideways
    pushOutOfTerrain(map, nearSouthFace);
    expect(nearSouthFace.x).toBeCloseTo(6.1, 5);
    expect(nearSouthFace.y).toBeCloseTo(6 + TERRAIN_BLOCK_HALF, 5);
  });

  it('a unit skimming a river tile keeps moving instead of freezing at the corner', () => {
    const sim = new Sim(5, L, { mapLayout: seamLayout(), rules: { tech: false, hqGun: false } });
    const u = sim.spawnUnit(0, 'rifle', { x: 6, y: 5 });
    // outer band of the water tile: rounds onto (6,6) but sits outside its core —
    // the old rounded-tile Infinity moveCost pinned this unit here forever
    u.pos = { x: 6, y: 5.6 };
    u.prevPos = { ...u.pos };
    stepFor(sim, 3);
    expect(Math.hypot(u.pos.x - 6, u.pos.y - 5.6)).toBeGreaterThan(1);
  });

  it('a troop passes vertically through the seam between two side-by-side water tiles', () => {
    const sim = new Sim(5, L, { mapLayout: seamLayout(), rules: { tech: false, hqGun: false } });
    // mid-seam: rounded tile IS a water tile, position sits in the open lane
    // between the two blocking cores — exactly the land/water·water/land case
    const u = sim.spawnUnit(0, 'rifle', { x: 5.5, y: 6.1 });
    u.pos = { x: 5.5, y: 6.1 };
    u.prevPos = { ...u.pos };
    let maxDrift = 0;
    for (let i = 0; i < 3 / 0.05; i++) {
      sim.step();
      maxDrift = Math.max(maxDrift, Math.abs(u.pos.x - 5.5));
    }
    expect(u.pos.y).toBeGreaterThan(7.5); // came out the south side
    expect(maxDrift).toBeLessThan(1.2); // through the seam, not a detour around the water
  });
});

describe('card variants & upgrades', () => {
  it('every B side links back to its A side', () => {
    for (const id of Object.keys(CARDS)) {
      const def = CARDS[id];
      if (def.side === 'B') {
        const a = flipSide(id);
        expect(a).not.toBeNull();
        expect(CARDS[a!].side).toBe('A');
        expect(flipSide(a!)).toBe(id);
        expect(baseId(id)).toBe(a);
      }
    }
  });

  it('garrison squad (rifle B) deploys in defensive stance', () => {
    const sim = new Sim(1, L, NOTECH);
    sim.players[0].hand[0] = { uid: 1, card: { id: 'rifle_b', up: false }, ttl: 50 };
    sim.players[0].gold = 200;
    expect(sim.playCard(0, 0, { c: 4, r: 9 }).ok).toBe(true);
    const u = sim.units[0];
    expect(u.stance).toBe('defensive');
    expect(u.anchor).not.toBeNull();
  });

  it('forged cards spawn stronger units', () => {
    const sim = new Sim(1, L, NOTECH);
    sim.players[0].hand[0] = { uid: 1, card: { id: 'tank', up: true }, ttl: 50 };
    sim.players[0].gold = 500;
    sim.players[0].oil = 200;
    expect(sim.playCard(0, 0, { c: 4, r: 9 }).ok).toBe(true);
    const u = sim.units[0];
    expect(u.maxHp).toBeGreaterThan(380 * 1.2);
    expect(u.dmg).toBeGreaterThan(50 * 1.1);
  });

  it('forward post projects extended territory', () => {
    const sim = new Sim(1, L);
    sim.placeBuilding(0, 'bunker', { c: 4, r: 8 }, CARDS.bunker_b.buildingMods);
    expect(isValidPlacement(sim, 0, CARDS.rifle, 8, 8)).toBe(true); // 4 tiles away, radius 5
  });
});

describe('manual collection', () => {
  it('each extractor pools its own output; collection comes in 10-packages', () => {
    const sim = new Sim(11, L, { rules: { manualCollect: true, tech: false } });
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    const enemyMine = sim.placeBuilding(1, 'extractor', { c: 11, r: 1 });
    const gold0 = sim.players[0].gold;
    const enemyGold0 = sim.players[1].gold;

    // below 10 stored: nothing collectable yet
    stepFor(sim, 2); // ~6 gold stored
    expect(sim.collectBuilding(0, mine.id)).toBeNull();

    stepFor(sim, 8); // ~30 stored total
    // team 0: only HQ trickle banked; the mine holds its production
    expect(sim.players[0].gold - gold0).toBeLessThan(12);
    expect(mine.stored).toBeGreaterThan(28);
    // AI auto-banks, stores nothing
    expect(enemyMine.stored).toBe(0);
    expect(sim.players[1].gold - enemyGold0).toBeGreaterThan(28);

    const claim = sim.collectBuilding(0, mine.id);
    expect(claim).not.toBeNull();
    expect(claim!.kind).toBe('gold');
    expect(claim!.amount % 10).toBe(0); // quantized: 10, 20, 30...
    expect(claim!.amount).toBeGreaterThanOrEqual(20);
    // the sub-10 remainder keeps accruing; nothing more to collect right now
    expect(mine.stored).toBeLessThan(10);
    expect(sim.collectBuilding(0, mine.id)).toBeNull();
  });

  it('a full silo stops producing until collected', () => {
    const sim = new Sim(12, L, { rules: { manualCollect: true, tech: false } });
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    stepFor(sim, 60); // way past the 90-gold cap at 3/s
    expect(mine.stored).toBeLessThanOrEqual(90);
    expect(mine.stored).toBeGreaterThan(89);
  });
});

describe('harvester convoy', () => {
  it('shuttles between mine dock and HQ dock while serving it', () => {
    const sim = new Sim(13, L);
    sim.placeBuilding(0, 'extractor', { c: 1, r: 11 }); // home mine, adjacent to HQ
    sim.spawnUnit(0, 'harvester', { x: 4, y: 10 });
    const seen = new Set<string>();
    let trips = 0;
    let prev = '';
    for (let i = 0; i < 20 * 50; i++) {
      sim.step();
      const h = sim.units.find((u) => u.kind === 'harvester')!;
      seen.add(h.harvestState);
      if (prev === 'unloading' && h.harvestState !== 'unloading') trips++; // round trip done
      prev = h.harvestState;
    }
    // full state cycle observed, multiple round trips completed
    for (const st of ['toNode', 'loading', 'toHq', 'unloading']) {
      expect(seen.has(st), st).toBe(true);
    }
    expect(trips).toBeGreaterThanOrEqual(2);
  });
});

describe('scripted waves', () => {
  it('spawns scripted attackers at their time', () => {
    const sim = new Sim(2, L, {
      waves: [
        { t: 1, team: 1, unit: 'rifle', tile: { c: 6, r: 8 } },
        { t: 3, team: 1, unit: 'tank', tile: { c: 6, r: 8 }, hp: 100 }
      ]
    });
    stepFor(sim, 0.5);
    expect(sim.units.length).toBe(0);
    stepFor(sim, 1);
    expect(sim.units.filter((u) => u.kind === 'rifle').length).toBe(1);
    stepFor(sim, 2);
    const tank = sim.units.find((u) => u.kind === 'tank');
    expect(tank).toBeDefined();
    expect(tank!.maxHp).toBe(100);
  });
});

describe('fluid hand', () => {
  it('opens with the initial deal and keeps dealing on the global timer', () => {
    const sim = new Sim(42, L, NOTECH);
    const hand = () => sim.players[0].hand.filter((s) => s !== null).length;
    expect(hand()).toBe(INITIAL_HAND);
    stepFor(sim, DRAW_INTERVAL_MAX + 0.1);
    expect(hand()).toBeGreaterThanOrEqual(INITIAL_HAND + 1);
  });

  it('an idle hand fills all slots before cards start expiring', () => {
    const sim = new Sim(7, L, NOTECH);
    const hand = () => sim.players[0].hand.filter((s) => s !== null).length;
    stepFor(sim, (HAND_SIZE - INITIAL_HAND) * DRAW_INTERVAL_MAX + 1);
    expect(hand()).toBe(HAND_SIZE);
  });

  it('expires cards after their TTL', () => {
    const sim = new Sim(42, L, NOTECH);
    const firstUid = sim.players[0].hand[0]!.uid;
    stepFor(sim, CARD_TTL + 0.1);
    const uids = sim.players[0].hand.filter((s) => s !== null).map((s) => s!.uid);
    expect(uids).not.toContain(firstUid);
  });
});

describe('tier-gated dealing', () => {
  const handIds = (sim: Sim) =>
    sim.players[0].hand.filter((s) => s !== null).map((s) => s!.card.id);
  const clearHand = (sim: Sim) => {
    for (let i = 0; i < sim.players[0].hand.length; i++) sim.players[0].hand[i] = null;
  };

  it('deals only base-tier cards until a power plant is up', () => {
    const sim = new Sim(42, L);
    const opening = handIds(sim);
    expect(opening.length).toBeGreaterThan(0);
    for (const id of opening) expect(id).toBe('powerplant');
    // the deal timer keeps firing, but locked cards stay in the queue
    stepFor(sim, DRAW_INTERVAL_MAX * 3 + 0.1);
    for (const id of handIds(sim)) expect(id).toBe('powerplant');
  });

  it('a live plant opens tier-0 deals but nothing deeper', () => {
    const sim = new Sim(42, L);
    clearHand(sim); // the held plants vacate the building desk
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    stepFor(sim, DRAW_INTERVAL_MAX * 4 + 0.1);
    const ids = handIds(sim);
    expect(ids).toContain('extractor');
    for (const id of ids) expect(['powerplant', 'extractor']).toContain(id);
  });

  it('tier-2 cards stay out of the deal until a derrick is live', () => {
    const sim = new Sim(9, L);
    clearHand(sim);
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    stepFor(sim, DRAW_INTERVAL_MAX * 6 + 0.1);
    const ids = handIds(sim);
    expect(ids.some((id) => CARDS[id].tier === 1)).toBe(true);
    expect(ids.filter((id) => CARDS[id].tier === 2)).toEqual([]);
  });

  it('unlocking a tier deals its cards on the spot, as many as the desks fit', () => {
    const sim = new Sim(42, L);
    clearHand(sim); // both building slots open
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    // no time passes — the bonus deal is immediate (tier 0 = the 2 extractors)
    expect(handIds(sim).filter((id) => id === 'extractor').length).toBe(TIER_UNLOCK_DEAL);
  });

  it('a full desk absorbs the unlock bonus without overflowing', () => {
    const sim = new Sim(42, L);
    // the opening hand still holds both plants — the building desk is full,
    // and tier 0 has only building cards, so nothing can land
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    expect(handIds(sim).filter((id) => id === 'extractor').length).toBe(0);
    expect(sim.players[0].queue.some((c) => c.id === 'extractor')).toBe(true);
  });

  it('a second gate of the same kind deals no bonus', () => {
    const sim = new Sim(42, L);
    clearHand(sim);
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    const before = handIds(sim).length;
    expect(before).toBeGreaterThan(0); // the first unlock dealt
    sim.placeBuilding(0, 'powerplant', { c: 2, r: 8 });
    expect(handIds(sim).length).toBe(before);
  });

  it('each rung up deals from the newly opened tier', () => {
    const sim = new Sim(9, L);
    clearHand(sim);
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    clearHand(sim);
    sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    clearHand(sim);
    sim.placeBuilding(0, 'derrick', { c: 4, r: 10 });
    const ids = handIds(sim);
    expect(ids.length).toBe(TIER_UNLOCK_DEAL);
    for (const id of ids) expect(CARDS[id].tier).toBe(2);
  });

  it('recycles spent copies when the queue stalls all-locked', () => {
    // both plants were dealt, played, and lost; only a locked card remains queued
    const sim = new Sim(3, L);
    const p = sim.players[0];
    for (let i = 0; i < p.hand.length; i++) p.hand[i] = null;
    p.queue = [{ id: 'tank', up: false }];
    stepFor(sim, DRAW_INTERVAL_MAX + 0.1);
    const ids = handIds(sim);
    expect(ids).toContain('powerplant');
    for (const id of ids) expect(id).toBe('powerplant');
    expect(p.queue.some((c) => c.id === 'tank')).toBe(true);
  });
});

describe('staff desks (partitioned hand)', () => {
  it('every dealt card sits on its own desk: buildings 0-1, units 2-3, actions 4-5', () => {
    const sim = new Sim(8, L, NOTECH);
    stepFor(sim, 60); // plenty of deals, some expiries, redeals
    for (const p of sim.players) {
      p.hand.forEach((s, i) => {
        if (!s) return;
        const kind = CARDS[s.card.id].kind;
        const cat = kind === 'building' ? 'building' : kind === 'unit' ? 'unit' : 'action';
        const want = i < 2 ? 'building' : i < 4 ? 'unit' : 'action';
        expect(cat, `slot ${i} holds ${s.card.id}`).toBe(want);
      });
    }
  });

  it('paid refresh discards the desk and deals two fresh cards of that category', () => {
    const sim = new Sim(8, L, NOTECH);
    const p = sim.players[0];
    stepFor(sim, 40); // let the desks fill
    const unitDesk = () => [p.hand[2], p.hand[3]];
    const beforeUids = unitDesk().filter(Boolean).map((s) => s!.uid);
    expect(beforeUids.length).toBeGreaterThan(0);
    const gold = p.gold;
    const res = sim.refreshRegion(0, 'unit');
    expect(res.ok).toBe(true);
    expect(p.gold).toBeCloseTo(gold - 10, 5);
    const after = unitDesk();
    expect(after.filter(Boolean).length).toBe(2); // two fresh deals
    for (const s of after) {
      expect(beforeUids).not.toContain(s!.uid); // all-new instances
      expect(CARDS[s!.card.id].kind).toBe('unit');
    }
  });

  it('refresh refuses without the gold', () => {
    const sim = new Sim(8, L, NOTECH);
    sim.players[0].gold = 4;
    const res = sim.refreshRegion(0, 'building');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('resources');
    expect(sim.players[0].gold).toBe(4);
  });

  it('each reissue click adds +10 to the price, cooling 1 gold/s on its own clock', () => {
    const sim = new Sim(8, L, NOTECH);
    const p = sim.players[0];
    p.gold = 500;
    expect(sim.refreshCost(0, 'unit')).toBe(10);
    expect(sim.refreshRegion(0, 'unit').ok).toBe(true); // pay base 10
    expect(p.gold).toBeCloseTo(490, 5);
    expect(sim.refreshCost(0, 'unit')).toBe(20); // +10 surcharge
    expect(sim.refreshCost(0, 'building')).toBe(10); // other desks unaffected
    stepFor(sim, 4); // first click's tab cools to 6
    expect(sim.refreshCost(0, 'unit')).toBe(16);
    expect(sim.refreshRegion(0, 'unit').ok).toBe(true); // pay 16, open a second tab
    expect(sim.refreshCost(0, 'unit')).toBe(26); // 10 + 6 + 10
    stepFor(sim, 6); // first tab expires (10s old), second cools to 4
    expect(sim.refreshCost(0, 'unit')).toBe(14);
    stepFor(sim, 4); // second tab expires too
    expect(sim.refreshCost(0, 'unit')).toBe(10);
    expect(p.refreshSurge.unit.length).toBe(0);
  });

  it('a surged price gates the purchase, not just the base cost', () => {
    const sim = new Sim(8, L, NOTECH);
    const p = sim.players[0];
    p.gold = 25;
    expect(sim.refreshRegion(0, 'unit').ok).toBe(true); // pay 10, 15 left, price now 20
    const res = sim.refreshRegion(0, 'unit');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('resources');
  });
});

describe('standing orders', () => {
  function give(sim: Sim, id: string): void {
    sim.players[0].hand[4] = { uid: 9100, card: { id, up: false }, ttl: 50 };
    sim.players[0].gold = 500;
  }

  it('an order card sets the team order and it lapses after its duration', () => {
    const sim = new Sim(4, L, NOTECH);
    give(sim, 'attackorder');
    expect(sim.playCard(0, 4).ok).toBe(true);
    expect(sim.players[0].order?.kind).toBe('attack');
    sim.players[0].order!.until = sim.time + 0.5;
    stepFor(sim, 1);
    expect(sim.players[0].order).toBeNull();
  });

  it('general offensive sends even base guards up the map', () => {
    const sim = new Sim(4, L, { rules: { tech: false, hqGun: false } });
    const guard = sim.spawnUnit(0, 'rocket', { x: 3, y: 10 }); // defensive stance
    give(sim, 'attackorder');
    expect(sim.playCard(0, 4).ok).toBe(true);
    const start = { ...guard.pos };
    stepFor(sim, 20);
    const advanced = Math.hypot(guard.pos.x - start.x, guard.pos.y - start.y);
    expect(advanced).toBeGreaterThan(3); // far beyond the defensive leash
  });

  it('defensive posture pulls attackers back to the HQ perimeter', () => {
    const sim = new Sim(4, L, { rules: { tech: false, hqGun: false } });
    const rifle = sim.spawnUnit(0, 'rifle', { x: 6, y: 6 }); // aggressive, mid-map
    give(sim, 'defendorder');
    expect(sim.playCard(0, 4).ok).toBe(true);
    stepFor(sim, 25);
    const hq = sim.map.hq[0];
    expect(Math.hypot(rifle.pos.x - hq.c, rifle.pos.y - hq.r)).toBeLessThan(5);
  });

  it('target-economy marches the army at enemy mines', () => {
    const sim = new Sim(4, L, { rules: { tech: false, hqGun: false } });
    const mine = sim.placeBuilding(1, 'extractor', { c: 8, r: 7 }); // contested mine, enemy-owned
    const rifle = sim.spawnUnit(0, 'rifle', { x: 4, y: 9 });
    give(sim, 'hiteconomy');
    expect(sim.playCard(0, 4).ok).toBe(true);
    let closest = Infinity;
    for (let i = 0; i < 30 / 0.05; i++) {
      sim.step();
      closest = Math.min(closest, Math.hypot(rifle.pos.x - 8, rifle.pos.y - 7));
    }
    // without the order an aggressive rifle marches on the HQ lane instead;
    // under it the mine is the destination — and it comes under fire
    expect(closest).toBeLessThan(2.6);
    expect(mine.hp).toBeLessThan(mine.maxHp);
  });

  it('dispersal order holds wide spacing between own combat units', () => {
    const sim = new Sim(4, L, { rules: { tech: false, hqGun: false } });
    const a = sim.spawnUnit(0, 'rocket', { x: 4, y: 9 }); // defensive: they sit
    const b = sim.spawnUnit(0, 'rocket', { x: 4.2, y: 9.1 });
    give(sim, 'spreadorder');
    expect(sim.playCard(0, 4).ok).toBe(true);
    stepFor(sim, 6);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(0.9);
  });
});

describe('cards & placement', () => {
  function simWithCard(cardId: string, up = false): { sim: Sim; slot: number } {
    const sim = new Sim(1, L, NOTECH);
    sim.players[0].hand[0] = { uid: 9999, card: { id: cardId, up }, ttl: 50 };
    sim.players[0].gold = 500;
    sim.players[0].oil = 200;
    return { sim, slot: 0 };
  }

  it('one click auto-builds the extractor on the nearest free gold mine', () => {
    const { sim, slot } = simWithCard('extractor');
    const res = sim.playCard(0, slot); // no target: the sim picks the site
    expect(res.ok).toBe(true);
    expect(sim.players[0].gold).toBe(500 - CARDS.extractor.gold);
    const mine = sim.buildings.find((b) => b.kind === 'extractor' && b.team === 0)!;
    expect(mine.tile).toEqual({ c: 1, r: 11 }); // the safe gold next to HQ A
  });

  it('auto cards ignore a provided target and still pick the nearest site', () => {
    const { sim, slot } = simWithCard('extractor');
    const res = sim.playCard(0, slot, { c: 4, r: 10 }); // plain land click
    expect(res.ok).toBe(true);
    const mine = sim.buildings.find((b) => b.kind === 'extractor' && b.team === 0)!;
    expect(mine.tile).toEqual({ c: 1, r: 11 });
  });

  it('refuses the play when no free site is in territory', () => {
    const { sim, slot } = simWithCard('extractor');
    sim.placeBuilding(0, 'extractor', { c: 1, r: 11 }); // take the only home mine
    const res = sim.playCard(0, slot);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no site');
  });

  it('every building pushes territory forward', () => {
    const { sim } = simWithCard('bunker');
    expect(isValidPlacement(sim, 0, CARDS.bunker, 4, 9)).toBe(true); // inside the HQ home zone (radius 4)
    expect(isValidPlacement(sim, 0, CARDS.bunker, 8, 4)).toBe(false); // across the river
    expect(isValidPlacement(sim, 0, CARDS.bunker, 7, 8)).toBe(false); // beyond the home zone
    sim.placeBuilding(0, 'bunker', { c: 4, r: 8 });
    expect(isValidPlacement(sim, 0, CARDS.bunker, 7, 8)).toBe(true); // bunker projects 3 further

    // economy creeps too now: an extractor on the contested mine extends the zone
    sim.placeBuilding(0, 'extractor', { c: 8, r: 7 });
    expect(isValidPlacement(sim, 0, CARDS.bunker, 10, 8)).toBe(true);
  });

  it('unit cards muster at the HQ without a target', () => {
    const { sim, slot } = simWithCard('rifle');
    const res = sim.playCard(0, slot); // no target at all
    expect(res.ok).toBe(true);
    const u = sim.units[0];
    const hq = sim.map.hq[0];
    expect(Math.max(Math.abs(u.pos.x - hq.c), Math.abs(u.pos.y - hq.r))).toBeLessThanOrEqual(1.6);
  });
});

describe('counters', () => {
  it('damage matrix encodes rock-paper-scissors', () => {
    expect(DAMAGE_MATRIX.at.armor).toBeGreaterThan(DAMAGE_MATRIX.at.infantry);
    expect(DAMAGE_MATRIX.smallarms.infantry).toBeGreaterThan(DAMAGE_MATRIX.smallarms.armor);
    expect(DAMAGE_MATRIX.mg.infantry).toBeGreaterThan(DAMAGE_MATRIX.mg.armor);
    expect(DAMAGE_MATRIX.artillery.building).toBeGreaterThan(1);
  });

  it('two rocket teams (cost-matched) beat one tank in the open', () => {
    const sim = new Sim(7, L);
    sim.spawnUnit(0, 'rocket', { x: 5, y: 9 });
    sim.spawnUnit(0, 'rocket', { x: 6, y: 9 });
    sim.spawnUnit(1, 'tank', { x: 8, y: 8 });
    stepFor(sim, 30);
    expect(sim.units.some((u) => u.kind === 'tank')).toBe(false);
    expect(sim.units.some((u) => u.kind === 'rocket')).toBe(true);
  });

  it('a lone tank crushes a lone rifle squad', () => {
    // hqGun off: this is a pure unit matchup — the victorious tank would
    // otherwise push on and die to HQ A's command gun, which is its own test
    const sim = new Sim(7, L, { rules: { hqGun: false } });
    sim.spawnUnit(0, 'rifle', { x: 5, y: 9 });
    sim.spawnUnit(1, 'tank', { x: 7, y: 9 });
    stepFor(sim, 25);
    expect(sim.units.some((u) => u.kind === 'rifle')).toBe(false);
    expect(sim.units.some((u) => u.kind === 'tank')).toBe(true);
  });

  it('an MG bunker shreds infantry', () => {
    const sim = new Sim(7, L, NOTECH);
    sim.placeBuilding(1, 'bunker', { c: 6, r: 9 });
    sim.spawnUnit(0, 'rifle', { x: 4, y: 9 });
    stepFor(sim, 20);
    expect(sim.units.length).toBe(0);
    const bunker = sim.buildings.find((b) => b.kind === 'bunker')!;
    expect(bunker.hp).toBeGreaterThan(bunker.maxHp * 0.8);
  });
});

describe('economy — the supply truck', () => {
  it('truck tucks in tight against the mine when docking', () => {
    const sim = new Sim(11, L, NOTECH);
    sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    sim.spawnUnit(0, 'harvester', { x: 3, y: 11 });
    const u = sim.units[0];
    let minD = Infinity;
    for (let i = 0; i < 8 / 0.05; i++) {
      sim.step();
      minD = Math.min(minD, Math.hypot(u.pos.x - 1, u.pos.y - 11));
    }
    expect(minD).toBeLessThanOrEqual(0.95); // docks at the structure, not a tile out
  });

  it('a service call starts a timed boost that lapses on its own', () => {
    const sim = new Sim(11, L, NOTECH);
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    sim.spawnUnit(0, 'harvester', { x: 3, y: 11 });
    stepFor(sim, 8); // drive + dock + service
    expect(mine.boostTimer).toBeGreaterThan(0);
    mine.boostTimer = 0.1; // let it lapse without another visit
    for (const u of sim.units) u.hp = 0; // remove the truck
    stepFor(sim, 1);
    expect(mine.boostTimer).toBe(0);
  });

  it('trucks serve oil derricks too', () => {
    const sim = new Sim(11, L, NOTECH);
    const derrick = sim.placeBuilding(0, 'derrick', { c: 5, r: 8 }); // the oil field
    sim.spawnUnit(0, 'harvester', { x: 3, y: 10 });
    stepFor(sim, 20);
    expect(derrick.boostTimer).toBeGreaterThan(0);
  });

  it('docking banks the whole silo, like the player clicking collect', () => {
    const sim = new Sim(11, L, { rules: { manualCollect: true, tech: false } });
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    stepFor(sim, 12); // ~36 gold pooled at the mine
    expect(mine.stored).toBeGreaterThan(30);
    const before = sim.players[0].gold;
    sim.spawnUnit(0, 'harvester', { x: 3, y: 11 });
    stepFor(sim, 8); // drive + dock: the truck banks it (the silo refills after)
    const claim = sim.events.find((e) => e.t === 'truckCollect');
    expect(claim?.t).toBe('truckCollect');
    expect(claim && claim.t === 'truckCollect' ? claim.amount : 0).toBeGreaterThanOrEqual(30);
    expect(sim.players[0].gold - before).toBeGreaterThan(28);
  });

  it('a serviced extractor produces double while the boost runs', () => {
    const sim = new Sim(11, L, NOTECH);
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 });
    const before = sim.players[0].gold;
    stepFor(sim, 10);
    const plain = sim.players[0].gold - before; // ~ (1 hq + 3 extractor) * 10
    expect(plain).toBeGreaterThan(38);
    expect(plain).toBeLessThan(42);

    mine.boostTimer = 10; // exactly the measurement window
    mine.boostMult = 2;
    const mid = sim.players[0].gold;
    stepFor(sim, 10);
    const boosted = sim.players[0].gold - mid; // ~ (1 + 6) * 10
    expect(boosted).toBeGreaterThan(68);
    expect(boosted).toBeLessThan(72);
  });
});

describe('tech tree & electricity', () => {
  function give(sim: Sim, id: string): void {
    sim.players[0].hand[0] = { uid: 9000 + Math.floor(sim.time * 20), card: { id, up: false }, ttl: 50 };
    sim.players[0].gold = 999;
    sim.players[0].oil = 999;
  }

  it('cards unlock down the ladder: plant → extractor → tier 1 → derrick → tier 2', () => {
    const sim = new Sim(5, L);
    give(sim, 'extractor');
    expect(sim.playCard(0, 0, { c: 1, r: 11 }).reason).toBe('requires powerplant');
    give(sim, 'rifle');
    expect(sim.playCard(0, 0).reason).toBe('requires extractor');
    give(sim, 'powerplant');
    expect(sim.playCard(0, 0, { c: 3, r: 10 }).ok).toBe(true);
    give(sim, 'extractor');
    expect(sim.playCard(0, 0, { c: 1, r: 11 }).ok).toBe(true);
    give(sim, 'rifle');
    expect(sim.playCard(0, 0).ok).toBe(true);
    give(sim, 'tank');
    expect(sim.playCard(0, 0).reason).toBe('requires derrick');
    // losing the extractor re-locks tier 1
    for (const b of sim.buildings) if (b.kind === 'extractor') b.hp = 0;
    sim.step();
    give(sim, 'rifle');
    expect(sim.playCard(0, 0).reason).toBe('requires extractor');
  });

  it('every opening hand contains a power plant when the loadout has one', () => {
    for (const seed of [1, 2, 3, 9, 77]) {
      const sim = new Sim(seed, L);
      for (const p of sim.players) {
        expect(p.hand.some((s) => s && s.card.id === 'powerplant')).toBe(true);
      }
    }
  });

  it('newest buildings brown out first; a second plant restores them', () => {
    const sim = new Sim(5, L);
    const plant1 = sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 }); // +8
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 }); // -2
    const b1 = sim.placeBuilding(0, 'barracks', { c: 3, r: 9 }); // -3 (5/8)
    const b2 = sim.placeBuilding(0, 'barracks', { c: 4, r: 10 }); // -3 (8/8)
    const bunker = sim.placeBuilding(0, 'bunker', { c: 4, r: 9 }); // -2 → over capacity
    sim.step();
    expect(mine.powered).toBe(true);
    expect(b1.powered).toBe(true);
    expect(b2.powered).toBe(true);
    expect(bunker.powered).toBe(false);

    const plant2 = sim.placeBuilding(0, 'powerplant', { c: 2, r: 8 });
    sim.step();
    expect(bunker.powered).toBe(true);

    // grid collapse: both plants die, every consumer goes dark
    plant1.hp = 0;
    plant2.hp = 0;
    sim.step();
    expect(mine.powered).toBe(false);
    expect(bunker.powered).toBe(false);
  });

  it('an unpowered extractor produces nothing; a powered one pays out', () => {
    const sim = new Sim(6, L);
    const mine = sim.placeBuilding(0, 'extractor', { c: 1, r: 11 }); // no plant yet
    sim.step();
    expect(mine.powered).toBe(false);
    const g0 = sim.players[0].gold;
    stepFor(sim, 10);
    expect(sim.players[0].gold - g0).toBeLessThan(11); // HQ trickle only

    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 });
    sim.step();
    expect(mine.powered).toBe(true);
    const g1 = sim.players[0].gold;
    stepFor(sim, 10);
    expect(sim.players[0].gold - g1).toBeGreaterThan(38); // trickle + 3/s mine
  });

  it('prebuilt and wave structures are grandfathered: no plant required', () => {
    const sim = new Sim(8, L, {
      start: { prebuilt: [{ t: 0, team: 1, building: 'bunker', tile: { c: 6, r: 9 } }] },
      waves: [{ t: 1, team: 1, building: 'extractor', tile: { c: 11, r: 1 } }]
    });
    stepFor(sim, 2);
    for (const b of sim.buildings.filter((x) => x.team === 1 && x.kind !== 'hq')) {
      expect(b.powered, b.kind).toBe(true);
    }
  });
});

describe('match resolution', () => {
  it('destroying the HQ ends the match', () => {
    const sim = new Sim(3, L);
    sim.hqOf(1)!.hp = 0;
    sim.step();
    expect(sim.result?.winner).toBe(0);
  });

  it('no time-limit damage: HQs stand untouched however long the war drags', () => {
    const sim = new Sim(3, L);
    sim.time = 400;
    stepFor(sim, 5);
    expect(sim.hqOf(0)!.hp).toBe(sim.hqOf(0)!.maxHp);
  });
});

describe('the nuclear option', () => {
  it('deals a free nuke to both players once unlocked, never before', () => {
    const sim = new Sim(3, L);
    stepFor(sim, 2);
    const hasNuke = (team: 0 | 1) => sim.players[team].hand.some((s) => s && s.card.id === 'nuke');
    expect(hasNuke(0)).toBe(false);
    expect(hasNuke(1)).toBe(false);
    sim.time = NUKE_UNLOCK_T;
    sim.step();
    expect(hasNuke(0)).toBe(true);
    expect(hasNuke(1)).toBe(true);
  });

  it('one nuke on the enemy HQ ends the war', () => {
    const sim = new Sim(3, L);
    sim.time = NUKE_UNLOCK_T;
    sim.step();
    const slot = sim.players[0].hand.findIndex((s) => s && s.card.id === 'nuke');
    const res = sim.playCard(0, slot, sim.map.hq[1]);
    expect(res.ok).toBe(true);
    stepFor(sim, NUKE.delay + 0.1);
    expect(sim.result?.winner).toBe(0);
  });

  it('an expired or spent nuke is re-dealt after the cooldown', () => {
    const sim = new Sim(3, L);
    sim.time = NUKE_UNLOCK_T;
    sim.step();
    const p = sim.players[0];
    const slot = p.hand.findIndex((s) => s && s.card.id === 'nuke');
    p.hand[slot] = null; // discard it
    stepFor(sim, NUKE_REDEAL + 0.2);
    expect(p.hand.some((s) => s && s.card.id === 'nuke')).toBe(true);
  });

  it('scripted scenarios (escalation off) never go nuclear', () => {
    const sim = new Sim(3, L, { rules: { escalation: false } });
    sim.time = NUKE_UNLOCK_T + 60;
    stepFor(sim, 2);
    for (const p of sim.players) {
      expect(p.hand.some((s) => s && s.card.id === 'nuke')).toBe(false);
    }
  });
});

describe('HQ gun', () => {
  it('the HQ shoots down a lone attacker before it matters', () => {
    const sim = new Sim(7, L, NOTECH);
    sim.spawnUnit(1, 'rifle', { x: 3, y: 10 }); // right at HQ A's doorstep
    stepFor(sim, 15);
    expect(sim.units.length).toBe(0);
    const hq = sim.hqOf(0)!;
    expect(hq.hp).toBeGreaterThan(hq.maxHp * 0.95);
  });

  it('hits every troop type for the same flat multiplier', () => {
    expect(DAMAGE_MATRIX.hqgun.infantry).toBe(1.0);
    expect(DAMAGE_MATRIX.hqgun.armor).toBe(1.0);
    expect(DAMAGE_MATRIX.hqgun.light).toBe(1.0);
  });

  it('stays silent when the rule is off (scripted tutorials)', () => {
    const sim = new Sim(7, L, { rules: { tech: false, hqGun: false } });
    sim.spawnUnit(1, 'rifle', { x: 3, y: 10 });
    stepFor(sim, 10);
    expect(sim.units.length).toBe(1);
  });
});

describe('base-defense alarm', () => {
  it('defensive units leave their post to relieve an attacked building', () => {
    const sim = new Sim(9, L, NOTECH);
    sim.placeBuilding(0, 'extractor', { c: 6, r: 9 }); // forward mine, outside guard leash
    const guard = sim.spawnUnit(0, 'rocket', { x: 2, y: 9 }); // defensive, anchored home
    sim.spawnUnit(1, 'rifle', { x: 7, y: 9 }); // raider opens fire on the mine
    let maxFromHome = 0;
    for (let i = 0; i < 30 / 0.05 && sim.units.some((u) => u.team === 1); i++) {
      sim.step();
      maxFromHome = Math.max(maxFromHome, Math.hypot(guard.pos.x - 2, guard.pos.y - 9));
    }
    // without the alarm the rocket never sees the raider (it sits beyond
    // sight range of the home post) and the loop runs its full 30s
    expect(sim.units.some((u) => u.team === 1)).toBe(false); // raider dealt with
    expect(maxFromHome).toBeGreaterThan(1.5); // the guard marched toward the mine
    expect(sim.buildings.some((b) => b.kind === 'extractor' && b.hp > 0)).toBe(true);
  });
});

describe('site-gated dealing', () => {
  it('never deals an extractor card while no free mine is in territory', () => {
    const sim = new Sim(5, L);
    sim.placeBuilding(0, 'extractor', { c: 1, r: 11 }); // occupy the only home mine
    sim.placeBuilding(0, 'powerplant', { c: 3, r: 10 }); // tier-0 unlock fires now
    const p = sim.players[0];
    const extractorInHand = () => p.hand.some((s) => s && s.card.id === 'extractor');
    expect(extractorInHand()).toBe(false); // the unlock bonus skipped the siteless card
    stepFor(sim, 30);
    expect(extractorInHand()).toBe(false);
    // the copies wait in the queue for territory to reach a mine
    expect(p.queue.some((c) => c.id === 'extractor')).toBe(true);
  });
});

describe('AI vs AI full matches', () => {
  const matchups: Array<[string, string[], string[]]> = [
    ['balanced vs balanced', AI_LOADOUTS.balanced, AI_LOADOUTS.balanced],
    ['rush vs armor', AI_LOADOUTS.rush, AI_LOADOUTS.armor],
    ['armor vs balanced', AI_LOADOUTS.armor, AI_LOADOUTS.balanced]
  ];

  for (const [name, a, b] of matchups) {
    it(`${name} finishes with a winner and sane state`, () => {
      const { sim, winner, time } = runHeadlessMatch({ seed: 5, loadouts: [a, b] });
      expect(winner).not.toBeNull();
      expect(time).toBeLessThan(700);
      for (const u of sim.units) {
        expect(Number.isFinite(u.pos.x)).toBe(true);
        expect(Number.isFinite(u.pos.y)).toBe(true);
        expect(u.pos.x).toBeGreaterThanOrEqual(-1);
        expect(u.pos.x).toBeLessThanOrEqual(13);
      }
      for (const p of sim.players) {
        expect(p.gold).toBeGreaterThanOrEqual(-1e-6);
        expect(p.oil).toBeGreaterThanOrEqual(-1e-6);
      }
    }, 30000);
  }

  it('is deterministic: same seed, same outcome', () => {
    const a = runHeadlessMatch({ seed: 21, loadouts: [AI_LOADOUTS.balanced, AI_LOADOUTS.rush] });
    const b = runHeadlessMatch({ seed: 21, loadouts: [AI_LOADOUTS.balanced, AI_LOADOUTS.rush] });
    expect(a.winner).toBe(b.winner);
    expect(a.time).toBeCloseTo(b.time, 10);
    expect(a.sim.players[0].damageDealt).toBeCloseTo(b.sim.players[0].damageDealt, 6);
  }, 60000);
});
