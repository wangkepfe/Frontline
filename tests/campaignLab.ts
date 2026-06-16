/**
 * Campaign balance lab — a HEADLESS player.
 *
 * Plays whole campaign runs with no UI: it walks the node map, fights every
 * battle as a fair AI-vs-AI match using the deck grown so far, and applies the
 * exact same reward / shop / forge / loot / event mutations the real campaign UI
 * does (mirrored from src/ui/campaignUi.ts). The point is DATA: per-depth win
 * rates, where runs die, battle lengths and HQ margins, deck/economy curves —
 * the numbers we tune `src/campaign/tuning.ts` against.
 *
 * Tactical play inside a battle is the deterministic AiController (the "player's
 * hands"); the META decisions (which node, which reward, shop/forge/event) are
 * the policy below — the "player's brain". The LLM playtest CLI drives those same
 * meta decisions intelligently for a small qualitative batch.
 *
 * NOTE: each battle runs both sides on auto-bank (humanTeams:[false,false]) so
 * the AI player isn't starved by the manual-collect rule it can't click. A real
 * human collects imperfectly, so this slightly over-credits the player economy —
 * a known, constant bias that doesn't distort the SHAPE of the difficulty curve.
 */
import { Sim } from '../src/sim/sim';
import { TUNING } from '../src/campaign/tuning';
import { AiController, AI_PROFILES, AiProfile } from '../src/sim/ai';
import { CARDS, baseId, flipSide } from '../src/sim/cards';
import { Rng } from '../src/sim/rng';
import {
  RunState, COLS, newRun, selectableNodes, nodeById, advanceAct, isFinalBoss,
  addCard, removeCard, upgradeCard, battleOptions, battleIntel, battleRewards, shopStock,
  lootRoll, pickEvent, CampaignEvent
} from '../src/campaign/run';

// event card pool — mirror of campaignUi.REWARDABLE
const REWARDABLE = ['rifle', 'rocket', 'tank', 'buggy', 'bunker', 'atturret', 'extractor', 'barracks', 'howitzer', 'airstrike', 'harvester', 'powerplant'];

// parameter-sweep hook: CAMPAIGN_TUNE='{"warChest":{"midBossGold":150}}' deep-merges
// into the live TUNING object before any run (run.ts reads TUNING at call time).
function deepMerge(target: any, src: any): void {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && typeof target[k] === 'object') deepMerge(target[k], src[k]);
    else target[k] = src[k];
  }
}
export function applyTuneOverrides(): void {
  if (!process.env.CAMPAIGN_TUNE) return;
  try {
    const ov = JSON.parse(process.env.CAMPAIGN_TUNE);
    deepMerge(TUNING as any, ov);
    console.log('CAMPAIGN_TUNE overrides:', JSON.stringify(ov));
  } catch (e) {
    console.log('bad CAMPAIGN_TUNE:', String(e));
  }
}
applyTuneOverrides();

export interface BattleResult {
  depth: number; // global depth (act*COLS + col)
  act: number;
  col: number;
  type: string; // battle | elite | boss
  enemyName: string;
  incomeMult: number;
  win: boolean;
  timedOut: boolean;
  time: number; // sim seconds
  playerHqFrac: number; // player HQ hp fraction at end (1 = untouched)
  enemyHqFrac: number;
  deckSize: number;
  upgraded: number; // forged cards in deck
}

export interface RunResult {
  seed: number;
  policy: string;
  victory: boolean;
  deathDepth: number | null; // global depth of the lost fight, null if survived
  reachedAct: number; // highest act entered (0..2)
  bossesBeaten: number;
  battles: BattleResult[];
  deckSizeEnd: number;
  reqEnd: number;
}

// ── battle resolution: fair AI-vs-AI with the campaign's own options ─────────
export function resolveBattle(run: RunState, nodeId: number, playerProfile: AiProfile, maxTime = 600):
  { win: boolean; timedOut: boolean; time: number; pHqFrac: number; eHqFrac: number; enemyName: string; incomeMult: number } {
  const opts = battleOptions(run, nodeId);
  const enemyName = battleIntel(run, nodeId).enemyName;
  // both sides auto-bank: the AI player can't click manual-collect silos
  const simOpts = {
    ...opts.simOptions,
    rules: { ...(opts.simOptions?.rules ?? {}), humanTeams: [false, false] as [boolean, boolean] }
  };
  const sim = new Sim(opts.seed, [opts.playerLoadout, opts.aiLoadout!], simOpts);
  const aiP = new AiController(0, opts.seed * 7 + 1, playerProfile);
  const aiE = new AiController(1, opts.seed * 13 + 2, opts.aiProfile!);
  const dt = 0.05;
  while (!sim.result && sim.time < maxTime) {
    aiP.update(sim, dt);
    aiE.update(sim, dt);
    sim.step();
    sim.events.length = 0;
  }
  const pHq = sim.hqOf(0);
  const eHq = sim.hqOf(1);
  const pFrac = pHq ? pHq.hp / pHq.maxHp : 0;
  const eFrac = eHq ? eHq.hp / eHq.maxHp : 0;
  const timedOut = !sim.result;
  // resolved → real winner; timeout → whoever's HQ is healthier (a stand-in,
  // rare since nukes unlock at 8:00 and force an end well before maxTime)
  const win = sim.result ? sim.result.winner === 0 : pFrac >= eFrac;
  return { win, timedOut, time: sim.time, pHqFrac: pFrac, eHqFrac: eFrac, enemyName, incomeMult: simOpts.rules.incomeMult?.[1] ?? 1 };
}

// ── meta policy: the "player brain" the scripted lab uses ─────────────────────
export interface MetaPolicy {
  name: string;
  /** which selectable node to move to */
  pickNode: (run: RunState, ids: number[]) => number;
  /** which reward card to add (null = skip) */
  pickReward: (run: RunState, cards: string[]) => string | null;
  /** mutate the run at a shop (buy / discharge) */
  shop: (run: RunState, stock: ReturnType<typeof shopStock>) => void;
  /** which deck card uid to forge (null = none) */
  forge: (run: RunState) => void;
  /** take the loot card? (req is auto-banked already) */
  takeLoot: (run: RunState, card: string) => boolean;
  /** pick event side 'a' or 'b' and, for removeChoice, which uid to drop */
  event: (run: RunState, ev: CampaignEvent) => 'a' | 'b';
  /** before a battle, optionally flip A/B sides (mutates deck) */
  prepare?: (run: RunState) => void;
}

// ── a reasonable default "competent player" deck-value heuristic ──────────────
/** how badly the deck wants another copy of base card `id` right now */
export function deckDesire(run: RunState, id: string): number {
  const b = baseId(id);
  const count = (k: string) => run.deck.filter((c) => baseId(c.id) === k).length;
  const has = (k: string) => count(k) > 0;
  const def = CARDS[id];
  if (!def) return 0;
  switch (b) {
    case 'powerplant': return count('powerplant') < 2 ? 3 : 0.2;
    case 'extractor': return count('extractor') < 3 ? 4.5 - count('extractor') : 0.3;
    case 'derrick': return count('derrick') < 2 ? 4 : 0.4;
    case 'barracks': return count('barracks') < 2 ? 3.4 : 0.6;
    case 'factory': return count('factory') < 2 ? 4.2 : 0.8;
    case 'bunker': return count('bunker') < 2 ? 2.2 : 0.5;
    case 'atturret': return count('atturret') < 2 ? 2.6 : 0.6;
    case 'tank': return 4.0 - Math.max(0, count('tank') - 2) * 0.6;
    case 'rocket': return 2.8 - Math.max(0, count('rocket') - 2) * 0.5;
    case 'rifle': return 2.2 - Math.max(0, count('rifle') - 3) * 0.4;
    case 'howitzer': return has('derrick') ? 3.0 : 1.2;
    case 'harvester': return count('harvester') < 1 ? 2.4 : 0.6;
    case 'buggy': return 1.4;
    case 'airstrike': return 2.6;
    case 'attackorder': return count('attackorder') < 1 ? 2.0 : 0.4;
    case 'defendorder': case 'spreadorder': case 'hitpower': case 'hiteconomy': return 0.8;
    case 'sabot': return count('tank') + count('factory') >= 2 ? 3.0 : 0.6;
    case 'apammo': return count('rifle') >= 3 ? 2.4 : 0.5;
    case 'reactive': return count('tank') >= 2 ? 2.2 : 0.4;
    case 'smoke': return count('rifle') >= 4 ? 1.8 : 0.3;
    case 'barrels': return has('howitzer') ? 2.0 : 0.2;
    default: return 1.0;
  }
}

/** node-type preference: a single dial in [0,1], higher = greedier for fights/cards */
function nodeScore(type: string, greed: number): number {
  switch (type) {
    case 'elite': return 0.4 + greed * 3.4; // cautious avoids (hard), aggressive seeks (best loot)
    case 'battle': return 1.5 + greed * 1.0;
    case 'shop': return 2.0 - greed * 0.7;
    case 'forge': return 2.1 - greed * 0.6;
    case 'loot': return 1.7 - greed * 0.4;
    case 'event': return 1.4 - greed * 0.3;
    case 'boss': return 5; // forced anyway
    default: return 1;
  }
}

export function makePolicy(name: string, greed: number): MetaPolicy {
  const removableWeak = (run: RunState): number | null => {
    // drop the lowest-desire surplus card (keep >=6, never drop the last plant/extractor)
    if (run.deck.length <= 6) return null;
    let worst: { uid: number; v: number } | null = null;
    for (const c of run.deck) {
      const cnt = run.deck.filter((d) => baseId(d.id) === baseId(c.id)).length;
      // value of keeping this copy: lower if we have many; protect singletons of econ
      const protect = (baseId(c.id) === 'powerplant' || baseId(c.id) === 'extractor') && cnt <= 1;
      if (protect) continue;
      const v = deckDesire(run, c.id) - (c.up ? 2 : 0); // never toss a forged card lightly
      if (!worst || v < worst.v) worst = { uid: c.uid, v };
    }
    return worst && worst.v < 1.2 ? worst.uid : null;
  };

  return {
    name,
    pickNode: (run, ids) => {
      let best = ids[0];
      let bestS = -Infinity;
      for (const id of ids) {
        const s = nodeScore(nodeById(run, id).type, greed) + (run.seed % 7 === id % 7 ? 0.01 : 0);
        if (s > bestS) { bestS = s; best = id; }
      }
      return best;
    },
    pickReward: (run, cards) => {
      let best: string | null = null;
      let bestV = 0.8; // skip threshold — don't bloat the deck with junk
      for (const id of cards) {
        const v = deckDesire(run, id);
        if (v > bestV) { bestV = v; best = id; }
      }
      return best;
    },
    shop: (run, stock) => {
      // buy the best-value affordable offers; then discharge a weak card if rich
      const offers = stock.offers.map((o, i) => ({ ...o, i, v: deckDesire(run, o.id) }))
        .sort((a, b) => b.v - a.v);
      for (const o of offers) {
        if (run.req >= o.price && o.v >= 2.4) { run.req -= o.price; addCard(run, o.id); }
      }
      if (run.req >= stock.removePrice + 30) {
        const uid = removableWeak(run);
        if (uid != null) { run.req -= stock.removePrice; run.removesUsed++; removeCard(run, uid); }
      }
    },
    forge: (run) => {
      const cands = run.deck.filter((c) => !c.up);
      if (!cands.length) return;
      // forge the highest-impact unforged card
      let best = cands[0];
      let bestV = -Infinity;
      for (const c of cands) {
        const v = deckDesire(run, c.id) + (CARDS[c.id].kind === 'building' ? 0.5 : 0);
        if (v > bestV) { bestV = v; best = c; }
      }
      upgradeCard(run, best.uid);
    },
    takeLoot: (run, card) => deckDesire(run, card) >= 1.0 || run.deck.length < 14,
    event: (run, ev) => {
      // prefer the option that grows/strengthens the deck unless the deck is already big
      const aKind = ev.a.kind;
      const deckBig = run.deck.length >= 18;
      if (aKind === 'removeChoice') return deckBig ? 'a' : 'b'; // trim only a bloated deck
      if (aKind === 'upgradeChoice') return run.req >= 90 ? 'a' : 'b';
      if (aKind === 'req') return 'a'; // free req
      return deckBig ? 'b' : 'a'; // cards/upgrades unless overflowing
    }
  };
}

// ── apply meta sites (mirror of campaignUi) ──────────────────────────────────
function applyRewards(run: RunState, nodeId: number, policy: MetaPolicy): void {
  const { cards, req } = battleRewards(run, nodeId);
  run.req += req;
  const pick = policy.pickReward(run, cards);
  if (pick) addCard(run, pick);
}

function applyLoot(run: RunState, nodeId: number, policy: MetaPolicy): void {
  const loot = lootRoll(run, nodeId);
  run.req += loot.req;
  if (policy.takeLoot(run, loot.card)) addCard(run, loot.card);
}

function applyEvent(run: RunState, nodeId: number, policy: MetaPolicy): void {
  const ev = pickEvent(run, nodeId);
  run.usedEvents.push(ev.id);
  const rng = new Rng(run.seed * 13 + nodeId * 3);
  const side = policy.event(run, ev);
  const choice = side === 'a' ? ev.a : ev.b;
  switch (choice.kind) {
    case 'req': run.req += choice.amount ?? 0; break;
    case 'card': addCard(run, REWARDABLE[rng.int(REWARDABLE.length)]); break;
    case 'twoCards':
      addCard(run, REWARDABLE[rng.int(REWARDABLE.length)]);
      addCard(run, REWARDABLE[rng.int(REWARDABLE.length)]);
      break;
    case 'upgradeRandom': {
      const cands = run.deck.filter((c) => !c.up);
      if (cands.length) upgradeCard(run, cands[rng.int(cands.length)].uid);
      break;
    }
    case 'upgradeChoice':
      if (run.req >= 60) { run.req -= 60; policy.forge(run); }
      break;
    case 'removeChoice': {
      // mirror showRemovePicker via the policy's weakest-card sense
      if (run.deck.length > 6) {
        let worst = run.deck[0];
        let wv = Infinity;
        for (const c of run.deck) { const v = deckDesire(run, c.id) - (c.up ? 3 : 0); if (v < wv) { wv = v; worst = c; } }
        removeCard(run, worst.uid);
      }
      break;
    }
    case 'skip': break;
  }
}

// ── the run loop ─────────────────────────────────────────────────────────────
export function playRun(seed: number, policy: MetaPolicy, playerProfile: AiProfile = AI_PROFILES.standard): RunResult {
  const run = newRun(seed);
  const battles: BattleResult[] = [];
  let bossesBeaten = 0;
  let guard = 0;
  const fought = new Map<number, boolean>(); // nodeId -> won; resolveBattle is deterministic, so a reserve retry reuses it
  while (!run.over && !run.victory && guard++ < 80) {
    const sel = selectableNodes(run);
    if (sel.length === 0) break;
    const nodeId = policy.pickNode(run, sel);
    const node = nodeById(run, nodeId);
    const prevAt = run.at;
    run.at = nodeId;
    if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') {
      let won = fought.get(nodeId);
      if (won === undefined) {
        // FIRST attempt at this node — record it ONCE. A reserve retry re-fights the SAME
        // node with the SAME deck, so resolveBattle returns the identical result; recounting
        // it would pollute the per-depth win rate, so we cache and reuse it.
        policy.prepare?.(run);
        const upgraded = run.deck.filter((c) => c.up).length;
        const r = resolveBattle(run, nodeId, playerProfile);
        won = r.win;
        fought.set(nodeId, won);
        battles.push({
          depth: run.act * COLS + node.col, act: run.act, col: node.col, type: node.type,
          enemyName: r.enemyName, incomeMult: r.incomeMult, win: r.win, timedOut: r.timedOut,
          time: r.time, playerHqFrac: r.pHqFrac, enemyHqFrac: r.eHqFrac, deckSize: run.deck.length, upgraded
        });
      }
      if (!won) {
        // RESERVES = campaign "lives", mirroring main.ts: a loss with reserves left spends one
        // and the run regroups at the SAME column — run.at is RESTORED so the lost node (and
        // the boss it gates) stays selectable. The deterministic probe re-fights and bleeds
        // its reserves to a death at THIS depth — never skipping a wall, keeping reach honest.
        if (run.reserves > 0) { run.reserves--; run.at = prevAt; continue; }
        run.over = true;
        break;
      }
      run.battlesWon++;
      if (node.type === 'boss') {
        bossesBeaten++;
        if (isFinalBoss(run, node)) { run.victory = true; break; }
        advanceAct(run);
      } else {
        applyRewards(run, nodeId, policy);
      }
    } else {
      switch (node.type) {
        case 'shop': policy.shop(run, shopStock(run, nodeId)); break;
        case 'forge': policy.forge(run); break;
        case 'loot': applyLoot(run, nodeId, policy); break;
        case 'event': applyEvent(run, nodeId, policy); break;
      }
    }
  }
  const lastLost = battles.length && !battles[battles.length - 1].win ? battles[battles.length - 1] : null;
  return {
    seed, policy: policy.name, victory: run.victory,
    deathDepth: lastLost ? lastLost.depth : null,
    reachedAct: run.act, bossesBeaten, battles,
    deckSizeEnd: run.deck.length, reqEnd: run.req
  };
}

// ── aggregation / reporting ──────────────────────────────────────────────────
export interface DepthStat { depth: number; n: number; wins: number; winRate: number; avgTime: number; avgWinMargin: number; avgLossMargin: number; types: Record<string, number>; }

export function summarize(results: RunResult[]) {
  const byDepth = new Map<number, BattleResult[]>();
  for (const r of results) for (const b of r.battles) {
    if (!byDepth.has(b.depth)) byDepth.set(b.depth, []);
    byDepth.get(b.depth)!.push(b);
  }
  const depthStats: DepthStat[] = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, bs]) => {
    const wins = bs.filter((b) => b.win);
    const losses = bs.filter((b) => !b.win);
    const types: Record<string, number> = {};
    for (const b of bs) types[b.type] = (types[b.type] ?? 0) + 1;
    return {
      depth, n: bs.length, wins: wins.length, winRate: wins.length / bs.length,
      avgTime: bs.reduce((s, b) => s + b.time, 0) / bs.length,
      avgWinMargin: wins.length ? wins.reduce((s, b) => s + b.playerHqFrac, 0) / wins.length : NaN,
      avgLossMargin: losses.length ? losses.reduce((s, b) => s + b.enemyHqFrac, 0) / losses.length : NaN,
      types
    };
  });
  const n = results.length;
  const victories = results.filter((r) => r.victory).length;
  const reach = (a: number) => results.filter((r) => r.reachedAct >= a || r.victory).length;
  const beatBosses = (k: number) => results.filter((r) => r.bossesBeaten >= k).length;
  const deathDepths = results.filter((r) => r.deathDepth != null).map((r) => r.deathDepth!);
  const deathHist: Record<number, number> = {};
  for (const d of deathDepths) deathHist[d] = (deathHist[d] ?? 0) + 1;
  const avgBattlesPerRun = results.reduce((s, r) => s + r.battles.length, 0) / n;
  const avgDeckEnd = results.reduce((s, r) => s + r.deckSizeEnd, 0) / n;
  return {
    runs: n, victories, victoryRate: victories / n,
    reachedAct2: beatBosses(1) / n, reachedAct3: beatBosses(2) / n,
    avgBattlesPerRun, avgDeckEnd, depthStats, deathHist
  };
}

export function formatReport(label: string, results: RunResult[]): string {
  const s = summarize(results);
  const lines: string[] = [];
  lines.push(`\n══════ ${label}  (${s.runs} runs) ══════`);
  lines.push(`full-run victory: ${(s.victoryRate * 100).toFixed(1)}%   beat act1 boss: ${(s.reachedAct2 * 100).toFixed(1)}%   beat act2 boss: ${(s.reachedAct3 * 100).toFixed(1)}%`);
  lines.push(`avg fights/run: ${s.avgBattlesPerRun.toFixed(1)}   avg deck end: ${s.avgDeckEnd.toFixed(1)}`);
  lines.push(`depth | n  | win% | type mix              | avgT | winMrg | lossMrg`);
  for (const d of s.depthStats) {
    const tmix = Object.entries(d.types).map(([k, v]) => `${k[0]}${v}`).join(' ');
    lines.push(
      `${String(d.depth).padStart(5)} | ${String(d.n).padStart(2)} | ${(d.winRate * 100).toFixed(0).padStart(3)}% | ${tmix.padEnd(20)} | ${d.avgTime.toFixed(0).padStart(4)} | ${(d.avgWinMargin * 100).toFixed(0).padStart(5)}% | ${(isNaN(d.avgLossMargin) ? '  -' : (d.avgLossMargin * 100).toFixed(0)).padStart(6)}%`
    );
  }
  const deaths = Object.entries(s.deathHist).sort((a, b) => +a[0] - +b[0]).map(([d, c]) => `d${d}:${c}`).join('  ');
  lines.push(`deaths by depth: ${deaths || 'none'}`);
  return lines.join('\n');
}

export { AI_PROFILES };
