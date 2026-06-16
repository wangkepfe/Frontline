import { Rng } from '../sim/rng';
import { CARDS, flipSide, baseId, DEFAULT_LOADOUT } from '../sim/cards';
import { GameMap, chebyshev } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { AI_PROFILES, AiProfile, AiPlaystyle } from '../sim/ai';
import type { GameOptions } from '../game';
import type { CardRef, Wave } from '../sim/types';
import type { BiomeId } from '../render/art/biomes';
import { TUNING, depthTier, MAX_DEPTH } from './tuning';

/**
 * Campaign run state — a Slay-the-Spire-style operation of THREE acts, each set
 * in a different biome (temperate delta → desert badlands → frozen capital).
 * Each act is its own branching node map carrying a growing deck; A/B sides
 * flip only between fights; forge/shops/events/loot scatter the route; an act
 * boss caps each act. Beating the first two bosses advances the biome; the
 * third boss ends the run.
 *
 * Difficulty scales on GLOBAL depth (act*colsPerAct + col) so the final act is
 * always hardest, with no cliff at an act seam. All knobs live in tuning.ts;
 * biome is a render-only field on the emitted GameOptions and never reaches the
 * deterministic sim.
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
  act: number; // 0..TUNING.actCount-1
  nodes: MapNode[]; // CURRENT act's graph (regenerated each act)
  at: number; // current node id, -1 = before the first column
  deck: DeckCard[];
  req: number; // requisition (campaign currency)
  reserves: number; // campaign "lives" — losses you can absorb before the run ends
  nextUid: number;
  nextNodeId: number; // globally-unique node ids across acts (seed/variety integrity)
  removesUsed: number;
  usedEvents: number[];
  battlesWon: number;
  /** bumped on every lost battle so a RETRY deals a fresh (still fair) card
   *  order instead of replaying the identical sequence — folded into the battle
   *  seed. Single-player only; campaign battles are never networked. */
  attempt: number;
  over: boolean;
  victory: boolean;
}

/** per-act columns; the last column is the act boss. (kept named COLS so the
 *  existing campaign.test boss.col === COLS-1 invariant holds per act) */
export const COLS = TUNING.colsPerAct;
const ROWS = TUNING.rows;

// the campaign opens on the standard loadout — every tech tier represented — so
// the first battle plays like a full skirmish rather than a stripped militia
// deck; the run grows from there (rewards, shops, forge) as normal.
export const STARTER_DECK: string[] = [...DEFAULT_LOADOUT];

export const NODE_ICONS: Record<NodeType, string> = {
  battle: '⚔', elite: '☠', shop: '⛁', forge: '🔧', loot: '📦', event: '❓', boss: '🏴'
};

export const NODE_LABELS: Record<NodeType, string> = {
  battle: 'Battle', elite: 'Elite Battle', shop: 'Supply Depot', forge: 'Field Workshop',
  loot: 'Cache', event: 'Encounter', boss: 'Enemy Stronghold'
};

// ── act helpers ────────────────────────────────────────────────────────────

export function actConfig(run: RunState) {
  return TUNING.acts[Math.min(run.act, TUNING.acts.length - 1)];
}

export function actBiome(run: RunState): BiomeId {
  return actConfig(run).biome;
}

/** is this the final act's boss (run-ending) vs a biome-advancing mid-boss? */
export function isFinalBoss(run: RunState, node: MapNode): boolean {
  return node.type === 'boss' && run.act >= TUNING.actCount - 1;
}

// ── generation ───────────────────────────────────────────────────────────────

/** (re)build run.nodes for the given act; ids stay globally unique */
function generateAct(run: RunState, act: number): void {
  const rng = new Rng((run.seed ^ 0x9e3779b9) + act * 0x01000193);
  const nodes: MapNode[] = [];
  let id = run.nextNodeId;
  for (let col = 0; col < COLS - 1; col++) {
    for (let row = 0; row < ROWS; row++) {
      nodes.push({ id: id++, col, row, type: 'battle', next: [] });
    }
  }
  const boss: MapNode = { id: id++, col: COLS - 1, row: Math.floor(ROWS / 2), type: 'boss', next: [] };
  nodes.push(boss);
  run.nextNodeId = id;

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

  // node types: one elite pinned mid-act, services scattered, rest battles
  const slots = nodes.filter((n) => n.col >= 1 && n.col <= COLS - 2);
  const eliteCol = Math.min(TUNING.eliteCol, COLS - 2);
  const eliteCands = slots.filter((n) => n.col === eliteCol && n.type === 'battle');
  if (eliteCands.length) eliteCands[rng.int(eliteCands.length)].type = 'elite';

  // service bag: guarantee one of each kind (so the act always has variety),
  // then fill the rest by weight, scaled to the act's content size
  const open = rng.shuffle(slots.filter((n) => n.type === 'battle'));
  const want = Math.min(open.length, Math.max(4, Math.round(open.length * TUNING.serviceFraction)));
  const bag: NodeType[] = ['shop', 'forge', 'loot', 'event'];
  const weighted: NodeType[] = [];
  for (const [k, w] of Object.entries(TUNING.serviceWeights)) for (let i = 0; i < w; i++) weighted.push(k as NodeType);
  while (bag.length < want) bag.push(weighted[rng.int(weighted.length)]);
  const placed = rng.shuffle(bag);
  for (let i = 0; i < placed.length && i < open.length; i++) open[i].type = placed[i];

  run.nodes = nodes;
  run.at = -1;
}

export function newRun(seed: number): RunState {
  const rng2 = new Rng(seed ^ 0x51ab3f);
  const run: RunState = {
    seed,
    act: 0,
    nodes: [],
    at: -1,
    deck: STARTER_DECK.map((cid, i) => ({ uid: i + 1, id: cid, up: false })),
    req: 80 + rng2.int(20),
    reserves: TUNING.reserves.start,
    nextUid: STARTER_DECK.length + 1,
    nextNodeId: 0,
    removesUsed: 0,
    usedEvents: [],
    battlesWon: 0,
    attempt: 0,
    over: false,
    victory: false
  };
  generateAct(run, 0);
  return run;
}

/** advance to the next act/biome after a mid-boss falls */
export function advanceAct(run: RunState): void {
  run.act = Math.min(run.act + 1, TUNING.actCount - 1);
  run.usedEvents = []; // events refresh each act
  run.reserves = TUNING.reserves.max; // a fresh act fully restores the reserve pool
  generateAct(run, run.act);
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
 * Enemy force ladder indexed by GLOBAL depth (act*colsPerAct + col). Rebuilt as a
 * SMOOTH escalation: campaign playtests (tests/campaignLab.ts + the LLM playtest)
 * showed the old ladder had doctrine CLIFFS at the act seams — d4 jumped straight
 * to a full balanced army, d6 to a full armor doctrine with PRE-BAKED Sabot, d12
 * stacked TWO army-wide upgrades in one rung — each a ~0%-winnable wall one node
 * after a soft boss. Now each rung folds in roughly ONE more threat than the last,
 * armor arrives gradually through act 2, and the permanent army-wide upgrades
 * (sabot → reactive → apammo) are introduced ONE at a time and spaced out, so the
 * seam from a boss to the next act's column 0 is a gentle re-entry, not a cliff.
 */
const EB = ['powerplant', 'powerplant', 'extractor', 'extractor', 'barracks', 'harvester']; // economy backbone shared by every rung
const ENEMY_LADDER: Array<{ name: string; deck: string[] }> = [
  // ── act 1 (d0–d5): infantry → light combined arms, NO army-wide upgrades ──
  { name: 'Militia Patrol', deck: [...EB, 'rifle', 'rifle', 'rifle', 'bunker'] },
  { name: 'Militia Detachment', deck: [...EB, 'derrick', 'rifle', 'rifle', 'rifle', 'rocket', 'bunker'] },
  { name: 'Militia Column', deck: [...EB, 'derrick', 'rifle', 'rifle', 'rifle', 'rocket', 'tank', 'bunker'] },
  { name: 'Regular Company', deck: [...EB, 'derrick', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'bunker', 'atturret'] },
  { name: 'Regular Battalion', deck: [...EB, 'derrick', 'factory', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'tank', 'bunker', 'atturret'] },
  { name: 'Combined Arms', deck: [...EB, 'derrick', 'factory', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'tank', 'howitzer', 'bunker', 'atturret', 'attackorder'] },
  // ── act 2 (d6–d11): armor doctrine builds up; Sabot is the ONE upgrade, late ──
  { name: 'Armored Vanguard', deck: [...EB, 'derrick', 'factory', 'rifle', 'rocket', 'rocket', 'tank', 'tank', 'atturret', 'attackorder'] },
  { name: 'Armored Battlegroup', deck: [...EB, 'derrick', 'derrick', 'factory', 'rifle', 'rocket', 'tank', 'tank', 'atturret', 'attackorder'] },
  { name: 'Armored Division', deck: [...EB, 'derrick', 'derrick', 'factory', 'rocket', 'rocket', 'tank', 'tank', 'howitzer', 'atturret', 'attackorder'] },
  { name: 'Mechanized Brigade', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'rocket', 'tank', 'tank', 'tank', 'howitzer', 'atturret', 'sabot', 'attackorder'] },
  { name: 'Guards Armored', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'rocket', 'rocket', 'tank', 'tank', 'tank', 'howitzer', 'atturret', 'sabot', 'attackorder'] },
  { name: 'Shock Division', deck: [...EB, 'derrick', 'derrick', 'factory', 'rocket', 'tank', 'tank', 'tank', 'howitzer', 'airstrike', 'atturret', 'sabot', 'attackorder'] },
  // ── act 3 (d12–d17): heavies + a SECOND then THIRD upgrade, still one per rung ──
  { name: 'Heavy Armor Group', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'rocket', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'airstrike', 'atturret', 'sabot', 'attackorder'] },
  { name: 'Iron Vanguard', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'rocket', 'rocket', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'airstrike', 'atturret', 'sabot', 'reactive', 'attackorder'] },
  { name: 'Praetorian Armor', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'rocket', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'howitzer', 'airstrike', 'atturret', 'sabot', 'reactive', 'attackorder'] },
  { name: 'Capital Garrison', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'barracks', 'rocket', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'howitzer', 'airstrike', 'atturret', 'sabot', 'reactive', 'apammo', 'attackorder'] },
  { name: 'Crown Guard', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'barracks', 'rocket', 'rocket', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'howitzer', 'airstrike', 'airstrike', 'atturret', 'sabot', 'reactive', 'apammo', 'attackorder'] },
  { name: 'Iron Legion', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'barracks', 'rocket', 'rocket', 'tank', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'howitzer', 'airstrike', 'airstrike', 'atturret', 'atturret', 'sabot', 'reactive', 'apammo', 'attackorder'] }
];

/** one boss deck per act — a real climax (a notch above that act's last rung), but
 *  fought at CAPPED aggression (see battleIntel) so it presses without rush-blowout */
const BOSS_DECKS: Array<{ name: string; deck: string[] }> = [
  // act 1 climax — combined arms with 2 tanks + howitzer; 2 derricks so the oil-hungry
  // factory + tanks actually deploy (a lone derrick left the boss under-armoring itself)
  { name: 'Forward Command', deck: [...EB, 'derrick', 'derrick', 'factory', 'rifle', 'rifle', 'rocket', 'rocket', 'tank', 'tank', 'howitzer', 'bunker', 'atturret', 'attackorder'] },
  // act 2 climax — armor doctrine with Sabot + airstrike
  { name: 'Army Group HQ', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'rocket', 'rocket', 'tank', 'tank', 'tank', 'howitzer', 'airstrike', 'atturret', 'sabot', 'attackorder'] },
  // act 3 final — the heaviest force, sabot + reactive
  { name: 'Stronghold Command', deck: [...EB, 'derrick', 'derrick', 'factory', 'factory', 'barracks', 'rocket', 'rocket', 'tank', 'tank', 'tank', 'tank', 'howitzer', 'howitzer', 'airstrike', 'atturret', 'atturret', 'sabot', 'reactive', 'attackorder'] }
];

export interface BattleIntel {
  layoutName: string;
  layout: string[];
  enemyName: string;
  enemyDeck: string[];
  incomeMult: number;
  profile: AiProfile;
  biome: BiomeId;
}

/** global depth 0..MAX_DEPTH for a node in the current act */
function globalDepth(run: RunState, node: MapNode): number {
  return run.act * COLS + node.col;
}

/** infer an AI playstyle from the composition of an enemy deck, so the opponent
 *  plays its army the way its cards intend (armor decks turtle into heavies;
 *  infantry/raid decks rush) */
function deckPlaystyle(deck: string[]): AiPlaystyle {
  let armor = 0, rushy = 0, barracks = 0, factory = 0;
  for (const id of deck) {
    const b = baseId(id);
    if (b === 'factory') factory++;
    if (b === 'tank') armor++;
    if (id === 'sabot' || id === 'reactive') armor++;
    if (b === 'barracks') barracks++;
    if (b === 'rifle' || b === 'buggy' || id === 'hiteconomy') rushy++;
  }
  if (factory >= 2 || armor >= 3) return 'armor';
  if (barracks >= 2 || rushy >= 4) return 'rush';
  return 'balanced';
}

export function battleIntel(run: RunState, nodeId: number): BattleIntel {
  const node = nodeById(run, nodeId);
  const rng = new Rng(run.seed * 31 + nodeId * 7 + 13);
  const tier = depthTier(run.act, node.col);
  const final = isFinalBoss(run, node);

  // every battle gets its own generated sector. Normal battles are fair and
  // symmetric; elite/boss sectors are generated with a DEFENDER BIAS (mapgen
  // walls the enemy HQ with a bastion + extra rear economy — an epic fortress to
  // assault). The map stays connected with every objective reachable (validated).
  const mapSeed = (run.seed * 1009 + nodeId * 131 + 7) >>> 0;
  const mapBias =
    node.type === 'boss' ? (final ? TUNING.map.finalBossBias : TUNING.map.midBossBias) :
    node.type === 'elite' ? TUNING.map.eliteBias : 0;
  const layout = generateMap(mapSeed, mapBias > 0 ? { bias: mapBias } : {});
  const layoutName =
    node.type === 'boss' ? (final ? 'The Iron Citadel' : 'Forward Stronghold') :
    `Sector ${String.fromCharCode(65 + (nodeId % 26))}-${((run.seed + nodeId * 13) % 90) + 10}`;

  let enemyDeck: string[];
  let enemyName: string;
  if (node.type === 'boss') {
    const b = BOSS_DECKS[Math.min(run.act, BOSS_DECKS.length - 1)];
    enemyDeck = [...b.deck];
    enemyName = b.name;
  } else {
    // elites field the NEXT rung's deck — a genuine, telegraphed mid-act spike
    // (the old elites used the SAME rung, so they were a no-op). The FIRST elite
    // (act 1, depth 3) keeps its own rung so the deadliest early bucket isn't a
    // wall one node after trivial openers; act-2+ elites get the tougher deck.
    const gd = globalDepth(run, node);
    const rungIdx = Math.min(gd + (node.type === 'elite' && gd >= 6 ? 1 : 0), ENEMY_LADDER.length - 1);
    const rung = ENEMY_LADDER[rungIdx];
    enemyDeck = [...rung.deck];
    enemyName = rung.name;
  }
  if (node.type === 'elite') enemyName = `Elite ${enemyName}`;

  const isSpike = node.type === 'elite' || node.type === 'boss';
  const base = isSpike ? AI_PROFILES.aggressive : AI_PROFILES.standard; // spikes react a touch faster
  const think = TUNING.ai.thinkBase - TUNING.ai.thinkSlope * tier; // sloppier early, sharp late
  // elites/bosses PRESS at a moderate, capped aggression — playtests showed the old
  // ~0.90 aggressive rush + prebuilt defense blew the player out before their economy
  // came online (a 0-damage loss). The spike's edge is now its DECK, not a turn-1 rush.
  const aggrBase = isSpike ? TUNING.ai.spikeAggr : AI_PROFILES.standard.aggression;
  const ai = TUNING.ai;
  const profile: AiProfile = {
    name: `${base.name}-d${globalDepth(run, node)}`,
    thinkMin: base.thinkMin * think,
    thinkMax: base.thinkMax * think,
    // operation delay shrinks with depth (sharper enemies) but never to zero
    delayMin: Math.max(ai.delayMinFloor, ai.delayMinBase - ai.delayMinSlope * tier),
    delayMax: Math.max(ai.delayMaxFloor, ai.delayMaxBase - ai.delayMaxSlope * tier),
    aggression: Math.min(1, aggrBase + tier * TUNING.ai.aggrSlope),
    playstyle: deckPlaystyle(enemyDeck)
  };

  // enemy supply, capped at PARITY (1.0): an income edge compounds into an
  // unwinnable wall, so late pressure rides decks/AI/war-chests, not income
  const inc = TUNING.income;
  const incomeMult =
    node.type === 'boss' ? (final ? inc.finalBossMult : inc.midBossMult) :
    Math.min(inc.ceiling, inc.base + tier * inc.slope + (node.type === 'elite' ? inc.eliteBonus : 0) + rng.next() * inc.jitter);

  return { layoutName, layout, enemyName, enemyDeck, incomeMult, profile, biome: actBiome(run) };
}

export function battleOptions(run: RunState, nodeId: number): Omit<GameOptions, 'onEnd'> {
  const node = nodeById(run, nodeId);
  const intel = battleIntel(run, nodeId);
  const elite = node.type === 'elite' || node.type === 'boss';
  const final = isFinalBoss(run, node);
  const tier = depthTier(run.act, node.col);
  // elite/boss camps come prebuilt — tiles located on the actual generated map
  const prebuilt: Wave[] = [];
  if (elite) {
    const gm = new GameMap(intel.layout);
    const eHq = gm.hq[1];
    const pb = TUNING.prebuilt;
    const nearestMine = (hq: typeof eHq) => [...gm.goldMines].sort((a, b) => chebyshev(a, hq) - chebyshev(b, hq))[0];
    const enemyMine = nearestMine(eHq);
    if (pb.enemyEco && enemyMine) prebuilt.push({ t: 0, team: 1, building: 'extractor', tile: enemyMine });
    // mirror the eco head start for the attacker so the snowball is level
    if (pb.playerEco) {
      const pMine = nearestMine(gm.hq[0]);
      if (pMine && (!enemyMine || pMine.c !== enemyMine.c || pMine.r !== enemyMine.r)) {
        prebuilt.push({ t: 0, team: 0, building: 'extractor', tile: pMine });
      }
    }
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
    if (pb.defense && defense) prebuilt.push({ t: 0, team: 1, building: node.type === 'boss' ? 'atturret' : 'bunker', tile: defense });
  }
  const wc = TUNING.warChest;
  const enemyGold =
    node.type === 'boss' ? (final ? wc.finalBossGold : wc.midBossGold) :
    node.type === 'elite' ? wc.eliteBase + Math.round(wc.eliteDepth * tier) :
    wc.startGold;
  return {
    // attempt counter varies the deal/combat stream on a retry — same attempt
    // stays deterministic (fair within a single fight), the next attempt differs
    seed: run.seed * 977 + nodeId * 131 + 5 + (run.attempt ?? 0) * 7919,
    playerLoadout: deckAsLoadout(run),
    aiLoadout: intel.enemyDeck,
    aiProfile: intel.profile,
    biome: intel.biome,
    simOptions: {
      mapLayout: intel.layout,
      rules: { manualCollect: true, escalation: true, incomeMult: [1, intel.incomeMult] },
      start: { gold: [wc.startGold, enemyGold], hqHp: [TUNING.combat.hqHp, TUNING.combat.hqHp], prebuilt }
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

function weightedPicks(rng: Rng, n: number, tierBoost = 0, deck?: DeckCard[]): string[] {
  const owned = new Map<string, number>();
  if (deck) for (const c of deck) owned.set(baseId(c.id), (owned.get(baseId(c.id)) ?? 0) + 1);
  const out: string[] = [];
  const pool = REWARD_POOL.map((e) => {
    let w = CARDS[e.id].kind === 'upgrade' || CARDS[e.id].kind === 'tactic' ? e.w + tierBoost : e.w;
    // a card you already run is far less likely to be re-offered — playtesters were
    // spammed dupes they'd just skip; offers should tempt with cards you LACK
    const have = owned.get(baseId(e.id)) ?? 0;
    if (have > 0) w *= Math.max(0.12, 1 - have * 0.45);
    return { ...e, w };
  });
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
  const tier = depthTier(run.act, node.col);
  const rw = TUNING.rewards;
  const cards = weightedPicks(rng, rw.cardPicks, tier * rw.tierBoost, run.deck);
  const req =
    node.type === 'elite' ? rw.eliteReqBase + rng.int(rw.eliteReqJitter) :
    node.type === 'boss' ? 0 :
    rw.battleReqBase + rng.int(rw.battleReqJitter) + Math.round(tier * rw.battleReqDepth);
  return { cards, req };
}

export type RewardTier = 'battle' | 'elite' | 'boss';
export interface VictoryRewards {
  tier: RewardTier;
  money: number;
  cards: string[]; // recruit choices (pick one)
  /** boss wins let you CHOOSE which card to promote; lesser wins promote a random one */
  promoteChoice: boolean;
}

/**
 * The three choose-one spoils offered by the victory window. Generosity scales
 * with the battle tier (battle < elite < boss): more money, a wider/higher card
 * pool, and — for bosses — a promotion you get to aim.
 */
export function victoryRewards(run: RunState, nodeId: number): VictoryRewards {
  const node = nodeById(run, nodeId);
  const tier = depthTier(run.act, node.col);
  const v = TUNING.rewards.victory;
  const t: RewardTier = node.type === 'boss' ? 'boss' : node.type === 'elite' ? 'elite' : 'battle';
  // attempt folds in so a retried win doesn't always offer the identical spoils
  const rng = new Rng(run.seed * 53 + nodeId * 17 + 3 + (run.attempt ?? 0) * 101);
  const money = v.money[t] + rng.int(v.moneyJitter) + Math.round(tier * v.moneyDepth);
  const cards = weightedPicks(rng, v.cardPicks[t], tier * TUNING.rewards.tierBoost + v.cardTierBoost[t], run.deck);
  return { tier: t, money, cards, promoteChoice: t === 'boss' };
}

export interface ShopStock {
  offers: Array<{ id: string; price: number }>;
  removePrice: number;
}

export function shopStock(run: RunState, nodeId: number): ShopStock {
  const rng = new Rng(run.seed * 71 + nodeId * 29 + 9);
  const node = nodeById(run, nodeId);
  const tier = depthTier(run.act, node.col);
  const sh = TUNING.shop;
  const ids = weightedPicks(rng, 5, tier, run.deck);
  const offers = ids.map((id) => {
    const def = CARDS[id];
    const price = Math.round((sh.priceBase + def.gold * sh.priceGold + def.oil * sh.priceOil + tier * sh.priceDepth) / 5) * 5;
    return { id, price };
  });
  return { offers, removePrice: sh.removeBase + run.removesUsed * sh.removeStep };
}

export function lootRoll(run: RunState, nodeId: number): { req: number; card: string } {
  const rng = new Rng(run.seed * 41 + nodeId * 23 + 1);
  return { req: 45 + rng.int(35), card: weightedPicks(rng, 1, 0, run.deck)[0] };
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

// v2: 3-act runs (act + nextNodeId fields). v1 single-act saves are abandoned
// (a run is short — a clean reset beats migrating into the new generation logic).
const LS_RUN = 'frontline.campaign.v2';

export function saveRun(run: RunState): void {
  localStorage.setItem(LS_RUN, JSON.stringify(run));
}

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(LS_RUN);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunState;
    if (!Array.isArray(run.nodes) || !Array.isArray(run.deck) || typeof run.act !== 'number') return null;
    if (typeof run.nextNodeId !== 'number') run.nextNodeId = Math.max(0, ...run.nodes.map((n) => n.id)) + 1;
    if (typeof run.reserves !== 'number') run.reserves = TUNING.reserves.start;
    if (typeof run.attempt !== 'number') run.attempt = 0;
    // migrate saves that predate card removals (retired B sides flip back to A)
    for (const c of run.deck) {
      if (!CARDS[c.id]) c.id = c.id.replace(/_b$/, '');
    }
    run.deck = run.deck.filter((c) => CARDS[c.id]);
    // a deck without a power plant predates the tech tree — without one it's dead
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

export { MAX_DEPTH };
