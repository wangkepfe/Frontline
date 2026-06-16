// ════════════════════════════════════════════════════════════════════════
// SKIRMISH — the quick-battle meta layer: a persistent service record, the
// composable match modifiers, the difficulty handicap, and the post-battle
// performance grade. All of this lives OUTSIDE the deterministic sim: every
// knob here is expressed through SimOptions (start resources, HQ HP, income
// multipliers) so the simulation, multiplayer and campaign stay byte-stable.
// ════════════════════════════════════════════════════════════════════════

import { BUILDING_STATS } from './sim/stats';
import { GameMap } from './sim/map';
import type { SimStart } from './sim/types';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ── service record ──────────────────────────────────────────────────────────

export interface SkirmishRecord {
  matches: number;
  wins: number;
  losses: number;
  streak: number; // current consecutive wins (resets to 0 on a loss)
  bestStreak: number;
  fastestWin: number; // seconds; 0 = no win yet
  mostDamage: number; // most damage dealt in a single match
}

const REC_KEY = 'frontline.skirmish.record.v1';

function emptyRecord(): SkirmishRecord {
  return { matches: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, fastestWin: 0, mostDamage: 0 };
}

export function loadRecord(): SkirmishRecord {
  try {
    const raw = localStorage.getItem(REC_KEY);
    if (!raw) return emptyRecord();
    const r = JSON.parse(raw) as Partial<SkirmishRecord>;
    return { ...emptyRecord(), ...r };
  } catch {
    return emptyRecord();
  }
}

export function saveRecord(r: SkirmishRecord): void {
  try {
    localStorage.setItem(REC_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable — records just don't persist */
  }
}

export interface MatchOutcome {
  won: boolean;
  time: number; // seconds
  damage: number; // damage the player dealt
}

/** Personal-best flags raised by the match just recorded — drives "NEW BEST" UI. */
export interface RecordDeltas {
  newFastestWin: boolean;
  newBestStreak: boolean;
  newMostDamage: boolean;
  streakMilestone: boolean; // a win that extended a streak of 3+
}

/** Fold a finished match into the record (mutates + persists) and report bests. */
export function recordMatch(rec: SkirmishRecord, o: MatchOutcome): RecordDeltas {
  const d: RecordDeltas = {
    newFastestWin: false, newBestStreak: false, newMostDamage: false, streakMilestone: false
  };
  rec.matches++;
  if (o.damage > rec.mostDamage) {
    rec.mostDamage = Math.round(o.damage);
    if (rec.matches > 1 || o.damage > 0) d.newMostDamage = rec.matches > 1;
  }
  if (o.won) {
    rec.wins++;
    rec.streak++;
    if (rec.streak > rec.bestStreak) {
      rec.bestStreak = rec.streak;
      d.newBestStreak = rec.streak >= 2;
    }
    if (rec.fastestWin === 0 || o.time < rec.fastestWin) {
      d.newFastestWin = rec.fastestWin !== 0;
      rec.fastestWin = o.time;
    }
    d.streakMilestone = rec.streak >= 3;
  } else {
    rec.losses++;
    rec.streak = 0;
  }
  saveRecord(rec);
  return d;
}

// ── match modifiers ──────────────────────────────────────────────────────────

export interface Mutator {
  id: string;
  name: string;
  blurb: string;
  icon: string; // icons.ts glyph name
}

/** The three modifiers compose without contradiction: one tunes the economy,
 *  one the HQ durability, one the opening oil — so any combination is coherent. */
export const MUTATORS: Mutator[] = [
  { id: 'blitz', name: 'BLITZ', blurb: 'Rich, fast economy — bigger armies, sooner', icon: 'gold' },
  { id: 'suddenDeath', name: 'SUDDEN DEATH', blurb: 'Fragile HQs — one committed push ends it', icon: 'alert' },
  { id: 'heavyMetal', name: 'HEAVY METAL', blurb: 'Both sides open with an oil stockpile — armor early', icon: 'tank' }
];

export interface SkirmishConfig {
  difficulty: number; // 0 (Recruit) .. 1 (Legendary)
  mutators: Set<string>;
}

export interface SkirmishTuning {
  start: SimStart;
  incomeMult: [number, number]; // [player, ai]
}

/**
 * Turn a config into the SimOptions tuning. The difficulty slider now does more
 * than set the AI's reflexes (ai.ts): it also handicaps the AI's SUPPLY RATE,
 * so Recruit feels genuinely forgiving and Legendary genuinely starves you of
 * tempo. Modifiers stack symmetrically on top, so the match stays fair.
 */
export function buildTuning(cfg: SkirmishConfig): SkirmishTuning {
  let pGold = 150, aGold = 150, pOil = 0, aOil = 0; // 150 = sim default starting gold
  let hqMult = 1, pInc = 1, aInc = 1;

  // AI supply handicap: 0.8× at Recruit → 1.3× at Legendary
  aInc *= lerp(0.8, 1.3, clamp01(cfg.difficulty));

  if (cfg.mutators.has('blitz')) {
    pGold += 120; aGold += 120;
    pInc *= 1.4; aInc *= 1.4;
  }
  if (cfg.mutators.has('heavyMetal')) {
    pOil += 90; aOil += 90;
  }
  if (cfg.mutators.has('suddenDeath')) {
    hqMult *= 0.5;
  }

  const hq = Math.round(BUILDING_STATS.hq.hp * hqMult);
  return {
    start: { gold: [pGold, aGold], oil: [pOil, aOil], hqHp: [hq, hq] },
    incomeMult: [pInc, aInc]
  };
}

// ── difficulty labelling ─────────────────────────────────────────────────────

export function diffLabel(d: number): string {
  return d < 0.22 ? 'Recruit' : d < 0.45 ? 'Trained' : d < 0.72 ? 'Veteran' : d < 0.9 ? 'Elite' : 'Legendary';
}

// ── performance grade ────────────────────────────────────────────────────────

export interface Grade {
  letter: string; // S, A, B, C, D, F
  cls: string; // css class: 's' | 'a' | 'b' | 'c' | 'd' | 'f'
  blurb: string; // a short field-report verdict
}

const GRADE_BLURB: Record<string, string> = {
  S: 'Flawless command. The enemy never had a front.',
  A: 'A decisive, well-run operation.',
  B: 'Objective taken. Some hard fighting.',
  C: 'A costly win — the line nearly broke.',
  D: 'Repelled, but you bloodied them badly.',
  F: 'The HQ fell before you found your footing.'
};

/**
 * Letter grade from the final board state. A win is graded on how intact your
 * HQ was and how fast you closed it (and harder difficulties forgive more); a
 * loss is graded on how close you came — chipping the enemy HQ earns a D, a
 * one-sided collapse earns an F. `ownHqFrac`/`enemyHqFrac` are 0..1 of max HP.
 */
export function gradeMatch(opts: {
  won: boolean;
  ownHqFrac: number;
  enemyHqFrac: number;
  time: number;
  difficulty: number;
}): Grade {
  const diffBonus = opts.difficulty * 14; // up to +14 points at Legendary
  let score: number;
  if (opts.won) {
    // 55 base + up to 30 for an intact HQ + up to 15 for a fast finish
    const speed = clamp01(1 - (opts.time - 90) / 360); // full marks ≤90s, none ≥450s
    score = 55 + clamp01(opts.ownHqFrac) * 30 + speed * 15 + diffBonus;
  } else {
    // a loss tops out at a D: graded purely on how much enemy HQ you razed
    score = (1 - clamp01(opts.enemyHqFrac)) * 34 + diffBonus * 0.4;
  }
  const letter =
    !opts.won
      ? (score >= 22 ? 'D' : 'F')
      : score >= 96 ? 'S' : score >= 84 ? 'A' : score >= 68 ? 'B' : 'C';
  return { letter, cls: letter.toLowerCase(), blurb: GRADE_BLURB[letter] };
}

// ── minimap preview ──────────────────────────────────────────────────────────

const TERRAIN_COLORS: Record<string, string> = {
  land: '#3b3a2c',
  forest: '#2f3b25',
  mountain: '#4a463c',
  water: '#23364a',
  bridge: '#5a4a30',
  gold: '#6e5a23',
  oil: '#2d4a5e'
};

/** Paint a generated battlefield into a square canvas, oriented like the battle
 *  camera (player HQ at the bottom of the diamond, enemy at the top). */
export function paintMinimap(canvas: HTMLCanvasElement, layout: string[]): void {
  const map = new GameMap(layout);
  const n = map.w;
  const s = canvas.width / n;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.save();
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate(-Math.PI / 4);
  g.scale(0.68, 0.68);
  g.translate(-canvas.width / 2, -canvas.height / 2);
  for (let r = 0; r < map.h; r++) {
    for (let c = 0; c < map.w; c++) {
      g.fillStyle = TERRAIN_COLORS[map.terrainAt(c, r)] ?? '#888';
      g.fillRect(c * s + 0.5, r * s + 0.5, s - 1, s - 1);
    }
  }
  for (const [team, color] of [[0, '#4585e8'], [1, '#e85d30']] as const) {
    const hq = map.hq[team];
    g.fillStyle = color;
    g.fillRect(hq.c * s - 2, hq.r * s - 2, s + 4, s + 4);
  }
  g.restore();
}
