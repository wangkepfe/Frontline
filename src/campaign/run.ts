import { Rng } from '../sim/rng';
import { CARDS, flipSide, AI_LOADOUTS } from '../sim/cards';
import { GameMap, LAYOUTS, chebyshev } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { AI_PROFILES, AiProfile } from '../sim/ai';
import type { GameOptions } from '../game';
import type { CardRef, Wave } from '../sim/types';

/**
 * Campaign run state — a Slay-the-Spire-style act: branching node map,
 * a growing deck you carry whole into every battle, A/B sides flippable
 * only between fights, forge upgrades, shops, events, and a boss.
 */

export type NodeType = 'battle' | 'elite' | 'shop' | 'forge' | 'loot' | 'event' | 'boss';

export interface MapNode {
  id: number;
  col: number;
  row: number;
  type: NodeType;
  next: number[];
}

export interface DeckCard {
  uid: number;
  id: string; // current side's card id
  up: boolean;
}

export interface RunState {
  seed: number;
  nodes: MapNode[];
  at: number; // current node id, -1 = before the first column
  deck: DeckCard[];
  req: number; // requisition (campaign currency)
  nextUid: number;
  removesUsed: number;
  usedEvents: number[];
  battlesWon: number;
  over: boolean;
  victory: boolean;
}

export const COLS = 9; // 0..7 regular, 8 = boss
const ROWS = 3;

export const STARTER_DECK: string[] = [
  'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks',
  'rifle', 'rifle', 'rifle', 'rocket', 'rocket', 'bunker', 'harvester', 'attackorder'
];

export const NODE_ICONS: Record<NodeType, string> = {
  battle: '⚔', elite: '☠', shop: '⛁', forge: '🔧', loot: '📦', event: '❓', boss: '🏴'
};

export const NODE_LABELS: Record<NodeType, string> = {
  battle: 'Battle', elite: 'Elite Battle', shop: 'Supply Depot', forge: 'Field Workshop',
  loot: 'Cache', event: 'Encounter', boss: 'Enemy Stronghold'
};

// ── generation ───────────────────────────────────────────────────────────────

export function newRun(seed: number): RunState {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const nodes: MapNode[] = [];
  let id = 0;
  for (let col = 0; col < COLS - 1; col++) {
    for (let row = 0; row < ROWS; row++) {
      nodes.push({ id: id++, col, row, type: 'battle', next: [] });
    }
  }
  const boss: MapNode = { id: id++, col: COLS - 1, row: 1, type: 'boss', next: [] };
  nodes.push(boss);

  // edges: connect each node to 1-2 adjacent-row nodes in the next column
  for (let col = 0; col < COLS - 2; col++) {
    const here = nodes.filter((n) => n.col === col);
    const there = nodes.filter((n) => n.col === col + 1);
    for (const n of here) {
      const options = there.filter((m) => Math.abs(m.row - n.row) <= 1);
      const picks = rng.shuffle([...options]).slice(0, 1 + (rng.next() < 0.45 ? 1 : 0));
      n.next = picks.map((m) => m.id).sort((a, b) => a - b);
    }
    // every next-column node must be reachable
    for (const m of there) {
      if (!here.some((n) => n.next.includes(m.id))) {
        const candidates = here.filter((n) => Math.abs(m.row - n.row) <= 1);
        const n = candidates[rng.int(candidates.length)] ?? here[0];
        n.next.push(m.id);
        n.next.sort((a, b) => a - b);
      }
    }
  }
  for (const n of nodes.filter((n) => n.col === COLS - 2)) n.next = [boss.id];

  // node types: elites pinned mid-act, services scattered, rest battles
  const slots = nodes.filter((n) => n.col >= 1 && n.col <= COLS - 2);
  const eliteCols = [3, 6];
  for (const col of eliteCols) {
    const colNodes = slots.filter((n) => n.col === col && n.type === 'battle');
    colNodes[rng.int(colNodes.length)].type = 'elite';
  }
  const bag: NodeType[] = ['shop', 'shop', 'forge', 'forge', 'loot', 'loot', 'loot', 'event', 'event', 'event'];
  const open = rng.shuffle(slots.filter((n) => n.type === 'battle'));
  for (let i = 0; i < bag.length && i < open.length; i++) {
    open[i].type = bag[i];
  }

  const rng2 = new Rng(seed ^ 0x51ab3f);
  return {
    seed,
    nodes,
    at: -1,
    deck: STARTER_DECK.map((cid, i) => ({ uid: i + 1, id: cid, up: false })),
    req: 80 + rng2.int(20),
    nextUid: STARTER_DECK.length + 1,
    removesUsed: 0,
    usedEvents: [],
    battlesWon: 0,
    over: false,
    victory: false
  };
}

/** nodes the player may move to right now */
export function selectableNodes(run: RunState): number[] {
  if (run.over) return [];
  if (run.at === -1) return run.nodes.filter((n) => n.col === 0).map((n) => n.id);
  return run.nodes.find((n) => n.id === run.at)?.next ?? [];
}

export function nodeById(run: RunState, id: number): MapNode {
  return run.nodes.find((n) => n.id === id)!;
}

// ── deck ops ─────────────────────────────────────────────────────────────────

export function addCard(run: RunState, baseCardId: string): void {
  run.deck.push({ uid: run.nextUid++, id: baseCardId, up: false });
}

export function removeCard(run: RunState, uid: number): void {
  run.deck = run.deck.filter((c) => c.uid !== uid);
}

export function flipCard(run: RunState, uid: number): boolean {
  const card = run.deck.find((c) => c.uid === uid);
  if (!card) return false;
  const other = flipSide(card.id);
  if (!other) return false;
  card.id = other;
  return true;
}

export function upgradeCard(run: RunState, uid: number): boolean {
  const card = run.deck.find((c) => c.uid === uid);
  if (!card || card.up) return false;
  card.up = true;
  return true;
}

export function deckAsLoadout(run: RunState): CardRef[] {
  return run.deck.map((c) => ({ id: c.id, up: c.up }));
}

// ── battles ──────────────────────────────────────────────────────────────────

/**
 * Enemy force ladder, one rung per map column. Each rung folds in ONE new
 * threat (first tank → factory → AT net → air/artillery → upgrades) instead of
 * jumping militia → combined-arms in a single node; the names telegraph it.
 */
const ENEMY_LADDER: Array<{ name: string; deck: string[] }> = [
  { name: 'Militia Detachment', deck: ['powerplant', 'powerplant', 'extractor', 'extractor', 'barracks', 'barracks', 'rifle', 'rifle', 'rifle', 'rifle', 'rocket', 'bunker', 'harvester'] },
  { name: 'Militia Column', deck: ['powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'barracks', 'rifle', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'bunker', 'harvester'] },
  { name: 'Regular Army Company', deck: ['powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'factory', 'rifle', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'bunker', 'atturret', 'harvester'] },
  { name: 'Regular Army Battalion', deck: ['powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'factory', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'tank', 'bunker', 'atturret', 'buggy', 'harvester'] },
  { name: 'Regular Army Battalion', deck: [...AI_LOADOUTS.balanced] },
  { name: 'Veteran Battalion', deck: [...AI_LOADOUTS.balanced, 'sabot'] },
  { name: 'Armored Battlegroup', deck: [...AI_LOADOUTS.armor] },
  { name: 'Armored Division', deck: [...AI_LOADOUTS.armor, 'airstrike', 'howitzer'] }
];
const ENEMY_BOSS = ['powerplant', 'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'derrick', 'factory', 'factory', 'barracks', 'tank', 'tank', 'rocket', 'rocket', 'atturret', 'sabot', 'reactive', 'harvester', 'airstrike', 'attackorder'];

export interface BattleIntel {
  layoutName: string;
  layout: string[];
  enemyName: string;
  enemyDeck: string[];
  incomeMult: number;
  profile: AiProfile;
}

export function battleIntel(run: RunState, nodeId: number): BattleIntel {
  const node = nodeById(run, nodeId);
  const rng = new Rng(run.seed * 31 + nodeId * 7 + 13);
  const tier = node.col / (COLS - 1);
  // every battle gets its own generated sector; the boss defends a fixed bastion
  const generated = node.type !== 'boss';
  const layoutName = generated
    ? `Sector ${String.fromCharCode(65 + (nodeId % 26))}-${((run.seed + nodeId * 13) % 90) + 10}`
    : 'The Bastion';
  const layout = generated ? generateMap((run.seed * 1009 + nodeId * 131 + 7) >>> 0) : LAYOUTS.bastion;

  let enemyDeck: string[];
  let enemyName: string;
  if (node.type === 'boss') {
    enemyDeck = [...ENEMY_BOSS];
    enemyName = 'Stronghold Command';
  } else {
    const rung = ENEMY_LADDER[Math.min(node.col, ENEMY_LADDER.length - 1)];
    enemyDeck = [...rung.deck];
    enemyName = rung.name;
  }
  if (node.type === 'elite') enemyName = `Elite ${enemyName}`;

  const base = node.type === 'elite' || node.type === 'boss' ? AI_PROFILES.aggressive : AI_PROFILES.standard;
  const think = 1.1 - 0.35 * tier; // early commanders are a touch sloppy, late ones sharp
  const profile: AiProfile = {
    name: `${base.name}-t${node.col}`,
    thinkMin: base.thinkMin * think,
    thinkMax: base.thinkMax * think,
    aggression: Math.min(1, base.aggression + tier * 0.3)
  };

  // one continuous supply curve with parity as the hard ceiling: an enemy that
  // out-earns the player compounds into an unwinnable stat wall, so the ramp
  // climbs from 75% toward 100% and stops there — late-act pressure comes from
  // deck quality, AI sharpness, and war chests instead of raw income
  const incomeMult =
    node.type === 'boss' ? 1.0 :
    Math.min(1.0, 0.75 + tier * 0.22 + (node.type === 'elite' ? 0.05 : 0) + rng.next() * 0.03);

  return { layoutName, layout, enemyName, enemyDeck, incomeMult, profile };
}

export function battleOptions(run: RunState, nodeId: number): Omit<GameOptions, 'onEnd'> {
  const node = nodeById(run, nodeId);
  const intel = battleIntel(run, nodeId);
  const elite = node.type === 'elite' || node.type === 'boss';
  const tier = node.col / (COLS - 1);
  // elite/boss camps come prebuilt — tiles located on the actual generated map
  const prebuilt: Wave[] = [];
  if (elite) {
    const gm = new GameMap(intel.layout);
    const eHq = gm.hq[1];
    const mine = [...gm.goldMines].sort((a, b) => chebyshev(a, eHq) - chebyshev(b, eHq))[0];
    if (mine) prebuilt.push({ t: 0, team: 1, building: 'extractor', tile: mine });
    let defense: { c: number; r: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r < gm.h; r++) {
      for (let c = 0; c < gm.w; c++) {
        const d = chebyshev({ c, r }, eHq);
        if (d >= 1 && d <= 2 && gm.terrainAt(c, r) === 'land' && d < bestD) {
          bestD = d;
          defense = { c, r };
        }
      }
    }
    if (defense) prebuilt.push({ t: 0, team: 1, building: node.type === 'boss' ? 'atturret' : 'bunker', tile: defense });
  }
  return {
    seed: run.seed * 977 + nodeId * 131 + 5,
    playerLoadout: deckAsLoadout(run),
    aiLoadout: intel.enemyDeck,
    aiProfile: intel.profile,
    simOptions: {
      mapLayout: intel.layout,
      rules: { manualCollect: true, escalation: true, incomeMult: [1, intel.incomeMult] },
      start: {
        // elite war chests grow with depth instead of one flat mid-act spike
        gold: [150, node.type === 'boss' ? 260 : elite ? 180 + Math.round(tier * 60) : 150],
        prebuilt
      }
    }
  };
}

// ── rewards / shop / loot / events ──────────────────────────────────────────

const REWARD_POOL: Array<{ id: string; w: number }> = [
  { id: 'rifle', w: 3 }, { id: 'rocket', w: 3 }, { id: 'tank', w: 2.2 }, { id: 'howitzer', w: 1.8 },
  { id: 'buggy', w: 2 }, { id: 'harvester', w: 1.6 }, { id: 'extractor', w: 2 }, { id: 'derrick', w: 1.6 },
  { id: 'barracks', w: 2 }, { id: 'factory', w: 1.6 }, { id: 'bunker', w: 2 }, { id: 'atturret', w: 2 },
  { id: 'powerplant', w: 1.6 },
  { id: 'airstrike', w: 1.4 }, { id: 'sabot', w: 0.9 }, { id: 'apammo', w: 0.9 }, { id: 'reactive', w: 0.9 },
  { id: 'smoke', w: 0.9 }, { id: 'barrels', w: 0.9 },
  { id: 'attackorder', w: 1.1 }, { id: 'defendorder', w: 1.1 }, { id: 'spreadorder', w: 0.9 },
  { id: 'hitpower', w: 0.9 }, { id: 'hiteconomy', w: 0.9 }
];

function weightedPicks(rng: Rng, n: number, tierBoost = 0): string[] {
  const out: string[] = [];
  const pool = REWARD_POOL.map((e) => ({
    ...e,
    w: CARDS[e.id].kind === 'upgrade' || CARDS[e.id].kind === 'tactic' ? e.w + tierBoost : e.w
  }));
  while (out.length < n) {
    const total = pool.reduce((s, e) => (out.includes(e.id) ? s : s + e.w), 0);
    let roll = rng.next() * total;
    for (const e of pool) {
      if (out.includes(e.id)) continue;
      roll -= e.w;
      if (roll <= 0) {
        out.push(e.id);
        break;
      }
    }
  }
  return out;
}

export function battleRewards(run: RunState, nodeId: number): { cards: string[]; req: number } {
  const node = nodeById(run, nodeId);
  const rng = new Rng(run.seed * 53 + nodeId * 17 + 3);
  const tier = node.col / (COLS - 1);
  const cards = weightedPicks(rng, 3, tier * 1.2);
  const req =
    node.type === 'elite' ? 115 + rng.int(25) :
    node.type === 'boss' ? 0 :
    65 + rng.int(20) + Math.round(tier * 20);
  return { cards, req };
}

export interface ShopStock {
  offers: Array<{ id: string; price: number }>;
  removePrice: number;
}

export function shopStock(run: RunState, nodeId: number): ShopStock {
  const rng = new Rng(run.seed * 71 + nodeId * 29 + 9);
  const node = nodeById(run, nodeId);
  const tier = node.col / (COLS - 1);
  const ids = weightedPicks(rng, 5, tier);
  const offers = ids.map((id) => {
    const def = CARDS[id];
    const price = Math.round((45 + def.gold * 0.45 + def.oil * 0.6 + tier * 18) / 5) * 5;
    return { id, price };
  });
  return { offers, removePrice: 65 + run.removesUsed * 20 };
}

export function lootRoll(run: RunState, nodeId: number): { req: number; card: string } {
  const rng = new Rng(run.seed * 41 + nodeId * 23 + 1);
  return { req: 60 + rng.int(45), card: weightedPicks(rng, 1)[0] };
}

export interface CampaignEvent {
  id: number;
  title: string;
  desc: string;
  a: { label: string; kind: 'req' | 'card' | 'upgradeRandom' | 'removeChoice' | 'upgradeChoice' | 'twoCards'; amount?: number };
  b: { label: string; kind: 'req' | 'card' | 'skip'; amount?: number };
}

export const EVENTS: CampaignEvent[] = [
  { id: 1, title: 'Abandoned Depot', desc: 'A looted supply depot — but the back room is intact.', a: { label: 'Strip it for parts (+90 ⛁)', kind: 'req', amount: 90 }, b: { label: 'Salvage the hardware (random card)', kind: 'card' } },
  { id: 2, title: 'Field Promotion', desc: 'A veteran crew distinguishes itself in maneuvers.', a: { label: 'Commission them (upgrade a random card)', kind: 'upgradeRandom' }, b: { label: 'A bonus instead (+50 ⛁)', kind: 'req', amount: 50 } },
  { id: 3, title: 'Deserters', desc: 'Some of your force wants out. Better now than mid-battle.', a: { label: 'Let them go (remove a card)', kind: 'removeChoice' }, b: { label: 'Pay them to stay (+30 ⛁)', kind: 'req', amount: 30 } },
  { id: 4, title: 'Veteran Instructor', desc: 'A retired gunnery sergeant offers training — for a price.', a: { label: 'Pay 60 ⛁ (upgrade a card of your choice)', kind: 'upgradeChoice', amount: -60 }, b: { label: 'Decline', kind: 'skip' } },
  { id: 5, title: 'Supply Drop', desc: 'A misdropped allied pallet drifts into your sector.', a: { label: 'Claim the crates (2 random cards)', kind: 'twoCards' }, b: { label: 'Sell the manifest (+60 ⛁)', kind: 'req', amount: 60 } },
  { id: 6, title: 'Captured Cache', desc: 'Scouts report an unguarded enemy cache nearby.', a: { label: 'Raid it (+70 ⛁)', kind: 'req', amount: 70 }, b: { label: 'Requisition the gear (random card)', kind: 'card' } }
];

export function pickEvent(run: RunState, nodeId: number): CampaignEvent {
  const rng = new Rng(run.seed * 67 + nodeId * 19 + 7);
  const fresh = EVENTS.filter((e) => !run.usedEvents.includes(e.id));
  const pool = fresh.length > 0 ? fresh : EVENTS;
  return pool[rng.int(pool.length)];
}

// ── persistence ──────────────────────────────────────────────────────────────

const LS_RUN = 'frontline.campaign.v1';

export function saveRun(run: RunState): void {
  localStorage.setItem(LS_RUN, JSON.stringify(run));
}

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(LS_RUN);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunState;
    if (!Array.isArray(run.nodes) || !Array.isArray(run.deck)) return null;
    // migrate saves that predate card removals (retired B sides flip back to A)
    for (const c of run.deck) {
      if (!CARDS[c.id]) c.id = c.id.replace(/_b$/, '');
    }
    run.deck = run.deck.filter((c) => CARDS[c.id]);
    // saves from before the tech tree have no plants — without one the deck is dead
    if (!run.deck.some((c) => c.id === 'powerplant')) {
      run.deck.unshift(
        { uid: run.nextUid++, id: 'powerplant', up: false },
        { uid: run.nextUid++, id: 'powerplant', up: false }
      );
    }
    return run;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  localStorage.removeItem(LS_RUN);
}
