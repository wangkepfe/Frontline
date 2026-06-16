import type { BiomeId } from '../render/art/biomes';

/**
 * Campaign tuning — the ONE place playtesters touch to retune difficulty,
 * length, economy and pacing. Nothing here imports the sim; these are pure
 * knobs read by run.ts. Difficulty keys off GLOBAL depth across all three acts
 * (depth = act*colsPerAct + col), so Act III is always the hardest and the
 * curve has no cliff at an act boundary.
 *
 * Design guardrails (do not silently break):
 *  - enemy supply (incomeMult) is capped at PARITY (1.0). An enemy that
 *    out-earns the player compounds into an unwinnable wall (see run.ts /
 *    campaign.test.ts). Late pressure comes from decks + AI sharpness + war
 *    chests, never from raw income.
 *  - one elite + one boss per act; the first two bosses are mid-bosses that
 *    advance the biome, the last is the final boss.
 */

export interface ActConfig {
  biome: BiomeId;
  /** short operation codename shown on the act-transition splash */
  name: string;
  /** one-line flavor under the act title */
  brief: string;
}

export const TUNING = {
  // ── structure ──────────────────────────────────────────────────────────────
  actCount: 3,
  /** columns per act: 0..colsPerAct-2 are content, the last column is the boss */
  colsPerAct: 6,
  rows: 3,
  /** the elite is pinned to this column each act (mid-act spike) */
  eliteCol: 3,
  /** fraction of a column's content slots turned into service sites */
  serviceFraction: 0.5,
  /** relative weights for filling service slots (one of each is always seeded) */
  serviceWeights: { shop: 2, forge: 2, loot: 3, event: 3 } as Record<string, number>,

  // ── per-act theme (biome + flavor) ──────────────────────────────────────────
  acts: [
    { biome: 'temperate', name: 'OPERATION SPEARPOINT', brief: 'Break the line in the river delta and push inland.' },
    { biome: 'desert', name: 'OPERATION DUST REACH', brief: 'Cross the badlands. Take the supply roads and the mesas.' },
    { biome: 'winter', name: 'OPERATION IRON CROWN', brief: 'The frozen capital. End it at the enemy stronghold.' }
  ] as ActConfig[],

  // Run resilience (RESERVES = campaign "lives"). Battles are leader-takes-all —
  // a single unlucky 0-damage blowout shouldn't end a 12-fight run. A reserve pool
  // absorbs losses: a defeat with reserves left spends one and lets you regroup
  // (re-flip your deck, re-pilot the fight, or reroute) instead of ending the run;
  // out of reserves, the next loss is final. The pool is FIXED + small (you regain
  // one per act cleared), so it's a resilience buffer, not a free-retry exploit.
  reserves: {
    start: 2, // losses you can absorb before the run is on its last legs
    onActCleared: 1, // reserves regained when you beat an act boss
    max: 3
  },

  // Combat resilience. Playtests found campaign fights are LEADER-TAKES-ALL: the
  // opening army clash snowballs uncontested, the loser deals ~0 damage, and every
  // loss reads as 'brutal-unfair'. A bigger HQ buffer (both sides) buys the trailing
  // side time to stabilize and counter with its ongoing production, so fights end on
  // a MARGIN (deck quality as a gradient) instead of a 100%/0% coin-flip. Campaign
  // only — the tutorial/skirmish keep the stock 1000 HQ.
  combat: {
    hqHp: 1200 // mild buffer: lets a HUMAN survive an early setback and react (deploy a
    // defensive line, counter) — the comeback room the leader-takes-all model otherwise denies
  },

  // ── difficulty (all key off global tier ∈ [0,1]) ───────────────────────────
  income: {
    base: 0.86, // enemy supply at depth 0 (86% of player) — early fights chip the player, no free wins
    slope: 0.06, // VERY gentle climb; with binary combat the player must reliably win regulars, so deep
    // enemies stay well below parity income and the difficulty rides decks (elites/bosses), not a money wall
    eliteBonus: 0.0, // elite signature is its tougher DECK (next rung) + defense, NOT also stacked income
    jitter: 0.03,
    ceiling: 1.0, // PARITY — never exceed
    midBossMult: 0.92, // bosses are a near-parity climax (their edge is deck + defense, not a gold flood)
    finalBossMult: 0.96
  },
  ai: {
    thinkBase: 1.12, // think-time multiplier at depth 0 (sloppier)
    thinkSlope: 0.2, // sharpens gently with depth — don't compound a heavier deck + income + reflexes all at once
    aggrSlope: 0.1, // gentle aggression climb with depth
    // base aggression for elites/bosses. Playtests showed the old ~0.90 aggressive
    // rush blew the player out before their economy came online; 0.6 makes spikes
    // PRESS the advantage with their stronger deck instead of all-in on turn 1.
    spikeAggr: 0.6,
    // human operation delay (s) between deciding a play and "clicking" it: long &
    // sloppy in early acts, shrinking to a small floor late so even the toughest
    // enemy still feels human, never robotic-instant
    delayMinBase: 0.8, delayMinFloor: 0.25, delayMinSlope: 0.5,
    delayMaxBase: 1.5, delayMaxFloor: 0.5, delayMaxSlope: 0.9
  },
  warChest: {
    startGold: 150, // both sides' opening gold on a normal battle
    eliteBase: 125, // elites open BELOW the player's chest — their edge is the tougher deck, not gold
    eliteDepth: 30, // + round(eliteDepth * tier)
    midBossGold: 120, // a measured boss opening that can't snowball the clash uncontested (verified: lifts boss reach)
    finalBossGold: 150
  },
  // what an elite/boss stronghold comes pre-built with. The enemy's prebuilt
  // extractor used to be a TEMPO lead (a running mine from t=0) that snowballed
  // the fight straight into the boss's tank/factory deck advantage — measured to
  // make the act bosses ~0% winnable. Removing just the eco head start (keeping
  // the defensive turret/bunker) turns the boss into a fair race to out-economy a
  // fortified strongpoint. (playerEco mirror tested worse — it accelerated the
  // game into the boss's armor spike. See tests/campaignLab.ts.)
  prebuilt: {
    enemyEco: false, // no eco head start — the boss builds its mine in-fight like the player
    playerEco: false,
    defense: true // elite/boss still open with a bunker (elite) / AT turret (boss)
  },

  // Unbalanced sectors. A normal battle is fought on a fair, 180°-symmetric map.
  // Elite/boss strongholds are generated with a DEFENDER BIAS instead: the enemy
  // HQ is walled by a mountain bastion (a single chokepoint to assault) and given
  // extra rear economy, scaling with the value (0 = symmetric, 1 = full citadel).
  // The map stays connected and every objective reachable by the attacker (mapgen
  // validates this). This is the TERRAIN half of an epic fight — the enemy's
  // deck + war chest are the other half. Set any to 0 to fight that tier on a
  // fair map. The final boss switches from the old curated symmetric bastion to a
  // procedurally fortified citadel at finalBossBias.
  map: {
    eliteBias: 0.5, // a fortified strongpoint
    midBossBias: 0.85, // a serious stronghold
    finalBossBias: 1.0 // the Iron Citadel
  },

  // ── rewards / economy ───────────────────────────────────────────────────────
  rewards: {
    battleReqBase: 50,
    battleReqJitter: 20,
    battleReqDepth: 14, // + round(battleReqDepth * tier) — trimmed: req was oversupplied with no sink
    eliteReqBase: 95,
    eliteReqJitter: 25,
    cardPicks: 3,
    tierBoost: 1.2, // upgrades/tactics weighted up with depth
    // Victory window: a CHOICE of one reward — requisition (money), recruit a
    // card (pick 1 of N), or a Veteran promotion. Generosity climbs by battle
    // tier: a normal win < an elite win < a boss win.
    victory: {
      money: { battle: 55, elite: 110, boss: 180 } as Record<string, number>,
      moneyJitter: 20,
      moneyDepth: 30, // + round(moneyDepth * tier)
      cardPicks: { battle: 3, elite: 3, boss: 4 } as Record<string, number>,
      // extra weight pushed toward upgrades/tactics (the scarce, high-impact cards)
      cardTierBoost: { battle: 0, elite: 1.0, boss: 2.2 } as Record<string, number>
    }
  },
  shop: {
    priceBase: 45,
    priceGold: 0.45,
    priceOil: 0.6,
    priceDepth: 22,
    removeBase: 65,
    removeStep: 20
  }
};

/** total content depth used to normalize difficulty into tier ∈ [0,1] */
export const MAX_DEPTH = TUNING.actCount * TUNING.colsPerAct - 1;

/** global progress 0..1 for an (act, col) */
export function depthTier(act: number, col: number): number {
  return (act * TUNING.colsPerAct + col) / MAX_DEPTH;
}
