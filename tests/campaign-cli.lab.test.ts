import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { CARDS, flipSide } from '../src/sim/cards';
import {
  RunState, newRun, selectableNodes, nodeById, advanceAct, isFinalBoss,
  addCard, removeCard, upgradeCard, flipCard, deckAsLoadout, battleRewards, battleIntel,
  shopStock, lootRoll, pickEvent, ShopStock, CampaignEvent
} from '../src/campaign/run';
import { resolveBattle, AI_PROFILES } from './campaignLab';

/**
 * Campaign PLAY CLI — an LLM (or a human) drives one campaign run, one decision
 * per invocation, while each battle auto-resolves with the deterministic
 * AiController (the "player's hands"). This is the intelligent-meta playtest:
 * smart node routing, deck building, shop/forge/event choices and A/B flips.
 *
 *   CLI=1 CLI_STATE=.lab/cli/p1.json CLI_CMD='init 4242' npx vitest run tests/campaign-cli.lab.test.ts
 *   ... then CLI_CMD='goto 2', 'take tank', 'shop buy 1', 'flip 14', 'event a', etc.
 *
 * After every command the compact decision view is written to <state>.view.json
 * (and echoed between <<<VIEW>>> markers). Read the view, decide, run again.
 */

interface Pending {
  rewardCards?: string[];
  shop?: ShopStock;
  shopBought?: number[];
  loot?: { req: number; card: string };
  event?: CampaignEvent;
  forgeOffered?: boolean;
}
interface CliState {
  seed: number;
  phase: 'map' | 'reward' | 'shop' | 'forge' | 'loot' | 'event' | 'over';
  run: RunState;
  pending: Pending;
  history: string[];
  result?: 'victory' | 'defeat';
}

const STATE = process.env.CLI_STATE ?? '.lab/cli/run.json';
const VIEW = STATE.replace(/\.json$/, '') + '.view.json';
const CMD = (process.env.CLI_CMD ?? 'state').trim();

function cardBrief(id: string, up = false) {
  const d = CARDS[id];
  return { id, name: d.name + (up ? ' ★' : '') + (d.side === 'B' ? ' (B)' : ''), kind: d.kind, tier: d.tier, gold: d.gold, oil: d.oil, desc: d.desc };
}
function deckSummary(run: RunState) {
  const counts: Record<string, { n: number; up: number }> = {};
  for (const c of run.deck) {
    const e = (counts[c.id] ??= { n: 0, up: 0 });
    e.n++; if (c.up) e.up++;
  }
  return Object.entries(counts).map(([id, e]) => `${e.n}x ${CARDS[id].name}${e.up ? ` (${e.up}★)` : ''}${CARDS[id].side === 'B' ? ' [B]' : ''}`).sort();
}
function deckUids(run: RunState) {
  return run.deck.map((c) => ({ uid: c.uid, id: c.id, name: CARDS[c.id].name, up: c.up, flipTo: flipSide(c.id) ? CARDS[flipSide(c.id)!].name : null }));
}

function buildView(st: CliState) {
  const run = st.run;
  const depth = run.at >= 0 ? run.act * 6 + (nodeById(run, run.at)?.col ?? 0) : run.act * 6;
  const base: any = {
    phase: st.phase, act: run.act + 1, battlesWon: run.battlesWon, req: run.req,
    deckSize: run.deck.length, deck: deckSummary(run), history: st.history.slice(-8)
  };
  if (st.phase === 'over') { base.result = st.result; return base; }
  if (st.phase === 'map') {
    const ids = selectableNodes(run);
    base.options = ids.map((id) => {
      const n = nodeById(run, id);
      const o: any = { goto: id, type: n.type, col: n.col, depth: run.act * 6 + n.col };
      if (n.type === 'battle' || n.type === 'elite' || n.type === 'boss') {
        const intel = battleIntel(run, id);
        o.enemy = intel.enemyName; o.enemyIncome = +intel.incomeMult.toFixed(2); o.enemyDeckSize = intel.enemyDeck.length;
      }
      return o;
    });
    base.flippable = deckUids(run).filter((c) => c.flipTo);
    base.hint = 'goto <id> to move. flip <uid> to swap a card A<->B before fighting.';
  } else if (st.phase === 'reward') {
    base.rewardCards = (st.pending.rewardCards ?? []).map((id) => cardBrief(id));
    base.hint = 'take <cardId> or skip';
  } else if (st.phase === 'shop') {
    const stock = st.pending.shop!;
    base.offers = stock.offers.map((o, i) => ({ buy: i, ...cardBrief(o.id), price: o.price, sold: (st.pending.shopBought ?? []).includes(i) }));
    base.removePrice = stock.removePrice;
    base.deckUids = deckUids(run);
    base.hint = 'shop buy <i> | shop remove <uid> | shop done';
  } else if (st.phase === 'forge') {
    base.forgeCandidates = run.deck.filter((c) => !c.up).map((c) => ({ uid: c.uid, name: CARDS[c.id].name }));
    base.hint = 'forge <uid> (refit one card, permanent) or skip';
  } else if (st.phase === 'loot') {
    base.loot = { reqGained: st.pending.loot!.req, card: cardBrief(st.pending.loot!.card) };
    base.hint = 'loot take | loot skip';
  } else if (st.phase === 'event') {
    const ev = st.pending.event!;
    base.event = { title: ev.title, desc: ev.desc, a: ev.a.label, b: ev.b.label };
    base.deckUids = deckUids(run);
    base.hint = 'event a | event b   (for "remove a card" pick: event a <uid>)';
  }
  return base;
}

function save(st: CliState) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(st));
  const view = buildView(st);
  writeFileSync(VIEW, JSON.stringify(view, null, 1));
  console.log('<<<VIEW>>>' + JSON.stringify(view) + '<<<END>>>');
}

function resolveServiceEntry(st: CliState, nodeId: number) {
  const run = st.run;
  const node = nodeById(run, nodeId);
  run.at = nodeId;
  switch (node.type) {
    case 'shop': st.phase = 'shop'; st.pending = { shop: shopStock(run, nodeId), shopBought: [] }; break;
    case 'forge': st.phase = 'forge'; st.pending = { forgeOffered: true }; break;
    case 'loot': { const l = lootRoll(run, nodeId); run.req += l.req; st.phase = 'loot'; st.pending = { loot: l }; break; }
    case 'event': st.phase = 'event'; st.pending = { event: pickEvent(run, nodeId) }; break;
  }
}

function fightAndAdvance(st: CliState, nodeId: number) {
  const run = st.run;
  const node = nodeById(run, nodeId);
  run.at = nodeId;
  const depth = run.act * 6 + node.col;
  const intel = battleIntel(run, nodeId);
  const r = resolveBattle(run, nodeId, AI_PROFILES.standard);
  const tag = `${node.type}@d${depth} vs ${intel.enemyName}`;
  if (!r.win) {
    st.history.push(`LOSS ${tag} — your HQ fell at ${r.time.toFixed(0)}s (enemy HQ ${(r.eHqFrac * 100).toFixed(0)}%)`);
    st.phase = 'over'; st.result = 'defeat'; run.over = true; return;
  }
  st.history.push(`WIN  ${tag} — ${r.time.toFixed(0)}s, your HQ ${(r.pHqFrac * 100).toFixed(0)}% left`);
  run.battlesWon++;
  if (node.type === 'boss') {
    if (isFinalBoss(run, node)) { st.phase = 'over'; st.result = 'victory'; run.victory = true; return; }
    advanceAct(run); st.phase = 'map'; st.pending = {};
    st.history.push(`--- ADVANCED TO ACT ${run.act + 1} ---`);
    return;
  }
  const { cards, req } = battleRewards(run, nodeId);
  run.req += req;
  st.phase = 'reward'; st.pending = { rewardCards: cards };
}

function apply(st: CliState, cmd: string): string | null {
  const [verb, ...rest] = cmd.split(/\s+/);
  const run = st.run;
  if (st.phase === 'over') return 'run is over — start a new one with init';
  if (verb === 'state') return null;
  if (verb === 'flip' && st.phase === 'map') {
    const uid = parseInt(rest[0], 10);
    return flipCard(run, uid) ? null : 'cannot flip that uid';
  }
  switch (st.phase) {
    case 'map': {
      if (verb !== 'goto') return 'expected: goto <id>  (or flip <uid>)';
      const id = parseInt(rest[0], 10);
      if (!selectableNodes(run).includes(id)) return `node ${id} not selectable`;
      const t = nodeById(run, id).type;
      if (t === 'battle' || t === 'elite' || t === 'boss') fightAndAdvance(st, id);
      else resolveServiceEntry(st, id);
      return null;
    }
    case 'reward': {
      if (verb === 'skip') { st.phase = 'map'; st.pending = {}; return null; }
      if (verb === 'take') {
        const id = rest[0];
        if (!(st.pending.rewardCards ?? []).includes(id)) return `not an offered card: ${id}`;
        addCard(run, id); st.phase = 'map'; st.pending = {}; return null;
      }
      return 'expected: take <cardId> | skip';
    }
    case 'shop': {
      if (verb !== 'shop') return 'expected: shop buy <i> | shop remove <uid> | shop done';
      const sub = rest[0];
      if (sub === 'done') { st.phase = 'map'; st.pending = {}; return null; }
      if (sub === 'buy') {
        const i = parseInt(rest[1], 10);
        const o = st.pending.shop!.offers[i];
        if (!o) return 'bad offer index';
        if ((st.pending.shopBought ?? []).includes(i)) return 'already sold';
        if (run.req < o.price) return 'not enough ⛁';
        run.req -= o.price; addCard(run, o.id); (st.pending.shopBought ??= []).push(i); return null;
      }
      if (sub === 'remove') {
        const uid = parseInt(rest[1], 10);
        if (run.deck.length <= 6) return 'deck at minimum size';
        if (run.req < st.pending.shop!.removePrice) return 'not enough ⛁ to discharge';
        if (!run.deck.some((c) => c.uid === uid)) return 'no such card uid';
        run.req -= st.pending.shop!.removePrice; run.removesUsed++; removeCard(run, uid); return null;
      }
      return 'expected: shop buy <i> | shop remove <uid> | shop done';
    }
    case 'forge': {
      if (verb === 'skip') { st.phase = 'map'; st.pending = {}; return null; }
      if (verb === 'forge') {
        const uid = parseInt(rest[0], 10);
        if (!upgradeCard(run, uid)) return 'cannot forge that uid';
        st.phase = 'map'; st.pending = {}; return null;
      }
      return 'expected: forge <uid> | skip';
    }
    case 'loot': {
      if (verb !== 'loot') return 'expected: loot take | loot skip';
      if (rest[0] === 'take') addCard(run, st.pending.loot!.card);
      st.phase = 'map'; st.pending = {}; return null;
    }
    case 'event': {
      if (verb !== 'event') return 'expected: event a | event b';
      const ev = st.pending.event!;
      run.usedEvents.push(ev.id);
      const side = rest[0] === 'b' ? 'b' : 'a';
      const choice = side === 'a' ? ev.a : ev.b;
      const rng = (n: number) => Math.abs((run.seed * 13 + ev.id * 3) % n); // deterministic-ish picks
      const pool = ['rifle', 'rocket', 'tank', 'buggy', 'bunker', 'atturret', 'extractor', 'barracks', 'howitzer', 'airstrike', 'harvester', 'powerplant'];
      switch (choice.kind) {
        case 'req': run.req += choice.amount ?? 0; break;
        case 'card': addCard(run, pool[rng(pool.length)]); break;
        case 'twoCards': addCard(run, pool[rng(pool.length)]); addCard(run, pool[rng(pool.length) === rng(pool.length) ? (rng(pool.length) + 1) % pool.length : rng(pool.length)]); break;
        case 'upgradeRandom': { const c = run.deck.filter((x) => !x.up); if (c.length) upgradeCard(run, c[rng(c.length)].uid); break; }
        case 'upgradeChoice': if (run.req >= 60) { run.req -= 60; const c = run.deck.filter((x) => !x.up); if (c.length) upgradeCard(run, c[0].uid); } break;
        case 'removeChoice': { const uid = parseInt(rest[1], 10); if (run.deck.length > 6 && run.deck.some((c) => c.uid === uid)) removeCard(run, uid); break; }
        case 'skip': break;
      }
      st.phase = 'map'; st.pending = {}; return null;
    }
  }
  return 'unhandled';
}

describe.runIf(!!process.env.CLI)('campaign play CLI', () => {
  it('applies one command and writes the next decision view', () => {
    let st: CliState;
    if (CMD.startsWith('init')) {
      const seed = parseInt(CMD.split(/\s+/)[1] ?? '1', 10);
      const run = newRun(seed);
      st = { seed, phase: 'map', run, pending: {}, history: [`new run, seed ${seed}, starting deck ${run.deck.length} cards`] };
    } else {
      if (!existsSync(STATE)) throw new Error(`no state at ${STATE} — run init first`);
      st = JSON.parse(readFileSync(STATE, 'utf8'));
      const err = apply(st, CMD);
      if (err) st.history.push(`! ${CMD}: ${err}`);
    }
    save(st);
  });
});

describe('campaign cli placeholder', () => {
  it('is gated behind CLI=1', () => {});
});
