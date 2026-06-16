import { describe, expect, it } from 'vitest';
import {
  COLS, newRun, selectableNodes, nodeById, addCard, removeCard, flipCard, upgradeCard,
  deckAsLoadout, battleOptions, battleIntel, battleRewards, shopStock, pickEvent, STARTER_DECK
} from '../src/campaign/run';
import { CARDS } from '../src/sim/cards';
import { GameMap } from '../src/sim/map';
import { Sim } from '../src/sim/sim';
import { AiController } from '../src/sim/ai';
import { MISSIONS } from '../src/tutorial';

describe('campaign map generation', () => {
  for (const seed of [1, 42, 777]) {
    it(`seed ${seed}: every node reaches the boss and types are placed`, () => {
      const run = newRun(seed);
      const boss = run.nodes.find((n) => n.type === 'boss')!;
      expect(boss.col).toBe(COLS - 1);

      // forward reachability from every column-0 node to the boss
      const reachable = new Set<number>();
      const stack = run.nodes.filter((n) => n.col === 0).map((n) => n.id);
      while (stack.length) {
        const id = stack.pop()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        stack.push(...nodeById(run, id).next);
      }
      expect(reachable.has(boss.id)).toBe(true);
      // every non-boss node has at least one outgoing edge
      for (const n of run.nodes) {
        if (n.type !== 'boss') expect(n.next.length, `node ${n.id}`).toBeGreaterThan(0);
      }
      // service variety exists
      const types = new Set(run.nodes.map((n) => n.type));
      for (const t of ['battle', 'elite', 'shop', 'forge', 'loot', 'event', 'boss']) {
        expect(types.has(t as never), t).toBe(true);
      }
    });
  }

  it('starts with only column 0 selectable', () => {
    const run = newRun(5);
    const sel = selectableNodes(run);
    expect(sel.length).toBe(3);
    for (const id of sel) expect(nodeById(run, id).col).toBe(0);
  });
});

describe('campaign deck ops', () => {
  it('adds, removes, flips, and upgrades cards', () => {
    const run = newRun(9);
    const size = run.deck.length;
    expect(size).toBe(STARTER_DECK.length);

    addCard(run, 'tank');
    expect(run.deck.length).toBe(size + 1);
    const tank = run.deck[run.deck.length - 1];

    expect(flipCard(run, tank.uid)).toBe(true);
    expect(run.deck.find((c) => c.uid === tank.uid)!.id).toBe('tank_b');
    expect(flipCard(run, tank.uid)).toBe(true);
    expect(run.deck.find((c) => c.uid === tank.uid)!.id).toBe('tank');

    expect(upgradeCard(run, tank.uid)).toBe(true);
    expect(upgradeCard(run, tank.uid)).toBe(false); // already upgraded

    removeCard(run, tank.uid);
    expect(run.deck.length).toBe(size);

    const loadout = deckAsLoadout(run);
    expect(loadout.length).toBe(size);
    expect(loadout.every((c) => CARDS[c.id])).toBe(true);
  });
});

describe('campaign battles', () => {
  it('difficulty scales with column', () => {
    const run = newRun(3);
    const early = battleIntel(run, run.nodes.find((n) => n.col === 0)!.id);
    const boss = battleIntel(run, run.nodes.find((n) => n.type === 'boss')!.id);
    expect(boss.incomeMult).toBeGreaterThan(early.incomeMult);
    expect(boss.profile.thinkMin).toBeLessThan(1);
  });

  it('enemy supply never beats the player: parity is the ceiling', () => {
    for (const seed of [1, 3, 7, 11, 42]) {
      const run = newRun(seed);
      for (const n of run.nodes) {
        const intel = battleIntel(run, n.id);
        expect(intel.incomeMult, `seed ${seed} node ${n.id} (${n.type})`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a campaign battle actually runs headless with the deck loadout', () => {
    const run = newRun(7);
    const nodeId = selectableNodes(run)[0];
    const opts = battleOptions(run, nodeId);
    const sim = new Sim(opts.seed, [opts.playerLoadout, opts.aiLoadout!], opts.simOptions);
    const ai = new AiController(1, 99, opts.aiProfile!);
    for (let i = 0; i < 20 * 60 && !sim.result; i++) {
      ai.update(sim, 0.05);
      sim.step();
      sim.events.length = 0;
    }
    // a minute in: the enemy AI should have an economy and the sim should be sane
    expect(sim.buildings.filter((b) => b.team === 1).length).toBeGreaterThan(1);
    for (const u of sim.units) {
      expect(Number.isFinite(u.pos.x)).toBe(true);
    }
  });

  it('elite & boss sectors are unbalanced (defender fortress) yet still runnable', () => {
    const run = newRun(7);
    const elite = run.nodes.find((n) => n.type === 'elite')!;
    const boss = run.nodes.find((n) => n.type === 'boss')!;
    for (const node of [elite, boss]) {
      const opts = battleOptions(run, node.id);
      const map = new GameMap(opts.simOptions!.mapLayout!);
      // the enemy (team 1) defends a fortified, asymmetric sector
      let asymmetric = false;
      for (let r = 0; r < map.h && !asymmetric; r++)
        for (let c = 0; c < map.w; c++)
          if (map.terrainAt(c, r) !== map.terrainAt(map.w - 1 - c, map.h - 1 - r)) { asymmetric = true; break; }
      expect(asymmetric, `${node.type} map asymmetric`).toBe(true);
      expect(map.goldMines.length, `${node.type} extra economy`).toBeGreaterThan(6);

      // and the defender AI can still stand up an economy behind the bastion
      const sim = new Sim(opts.seed, [opts.playerLoadout, opts.aiLoadout!], opts.simOptions);
      const ai = new AiController(1, 99, opts.aiProfile!);
      for (let i = 0; i < 20 * 60 && !sim.result; i++) {
        ai.update(sim, 0.05);
        sim.step();
        sim.events.length = 0;
      }
      expect(sim.buildings.filter((b) => b.team === 1).length, `${node.type} defender built`).toBeGreaterThan(1);
      for (const u of sim.units) expect(Number.isFinite(u.pos.x)).toBe(true);
    }
  });

  it('rewards offer 3 distinct cards; shop prices scale', () => {
    const run = newRun(11);
    const nodeId = selectableNodes(run)[0];
    const { cards } = battleRewards(run, nodeId);
    expect(new Set(cards).size).toBe(3);
    const shopNode = run.nodes.find((n) => n.type === 'shop')!;
    const stock = shopStock(run, shopNode.id);
    expect(stock.offers.length).toBe(5);
    for (const o of stock.offers) expect(o.price).toBeGreaterThan(0);
    const ev = pickEvent(run, run.nodes.find((n) => n.type === 'event')!.id);
    expect(ev.title.length).toBeGreaterThan(0);
  });
});

describe('tutorial missions', () => {
  it('every mission config produces a runnable sim', () => {
    for (const m of MISSIONS) {
      const opts = m.build(123);
      const sim = new Sim(123, [opts.playerLoadout, opts.aiLoadout ?? []], opts.simOptions);
      for (let i = 0; i < 20 * 30; i++) sim.step(); // 30s headless, no crash
      expect(sim.hqOf(0)).not.toBeNull();
      expect(sim.hqOf(1)).not.toBeNull();
      for (const hint of opts.hints ?? []) {
        expect(hint.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('mission 1 waves arrive and fight', () => {
    const m = MISSIONS[0];
    const opts = m.build(55);
    const sim = new Sim(55, [opts.playerLoadout, []], opts.simOptions);
    for (let i = 0; i < 20 * 5; i++) sim.step();
    expect(sim.units.filter((u) => u.team === 1).length).toBeGreaterThanOrEqual(2);
    // mission 1's enemy HQ is deliberately low so a few rifle squads end it fast
    expect(sim.hqOf(1)!.maxHp).toBe(120);
  });
});
