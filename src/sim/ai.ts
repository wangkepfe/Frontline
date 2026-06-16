import { Sim } from './sim';
import { TeamId, Unit, UnitKind } from './types';
import { TilePos, chebyshev } from './map';
import { Rng } from './rng';
import { CARDS, CardDef, baseId, tierRequirement } from './cards';
import { BUILDING_STATS, UNIT_STATS } from './stats';
import { clearestValidTile, nearestValidTile, validPlacementTiles } from './placement';

/**
 * The AI opponent plays the exact same game: it sees its hand, scores each card
 * against the board state, picks a placement, and calls sim.playCard.
 */

/** how the AI weights its hand — a strategic personality, not just a tempo */
export type AiPlaystyle = 'balanced' | 'armor' | 'rush';

export interface AiProfile {
  name: string;
  thinkMin: number; // seconds between hand re-evaluations (polling cadence)
  thinkMax: number;
  /** human-like operation delay: after DECIDING a play, the AI waits this long
   *  before it actually "clicks" — randomized, and floored above zero even at
   *  the highest difficulty so the opponent never reacts with robotic instancy */
  delayMin: number;
  delayMax: number;
  aggression: number; // 0..1, weights offensive plays
  playstyle: AiPlaystyle;
}

export const AI_PROFILES: Record<string, AiProfile> = {
  standard: { name: 'standard', thinkMin: 0.3, thinkMax: 0.6, delayMin: 0.45, delayMax: 1.1, aggression: 0.5, playstyle: 'balanced' },
  turtle: { name: 'turtle', thinkMin: 0.35, thinkMax: 0.7, delayMin: 0.55, delayMax: 1.3, aggression: 0.25, playstyle: 'armor' },
  aggressive: { name: 'aggressive', thinkMin: 0.25, thinkMax: 0.5, delayMin: 0.35, delayMax: 0.85, aggression: 0.85, playstyle: 'rush' }
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Build an AI profile from a single DIFFICULTY scalar (0 = Recruit, 1 = Elite)
 * plus a playstyle. One knob drives the whole feel: a low setting thinks slowly,
 * reacts with a long human delay and plays cautiously; a high setting is snappy
 * and aggressive — but the reaction delay only shrinks to a floor, never zero.
 */
export function profileFromDifficulty(difficulty: number, playstyle: AiPlaystyle = 'balanced'): AiProfile {
  const d = Math.max(0, Math.min(1, difficulty));
  const aggrCurve =
    playstyle === 'rush' ? lerp(0.55, 0.95, d) :
    playstyle === 'armor' ? lerp(0.3, 0.78, d) :
    lerp(0.35, 0.85, d);
  return {
    name: `${playstyle}-d${Math.round(d * 100)}`,
    thinkMin: lerp(0.7, 0.25, d),
    thinkMax: lerp(1.3, 0.5, d),
    delayMin: lerp(0.9, 0.28, d), // floored above 0 even at d=1 — never instant
    delayMax: lerp(2.0, 0.6, d),
    aggression: aggrCurve,
    playstyle
  };
}

const THREAT_VALUE: Record<UnitKind, number> = {
  rifle: 1, rocket: 1.2, tank: 3, howitzer: 2.5, harvester: 0.2, buggy: 1
};

interface Context {
  myHq: TilePos;
  enemyHq: TilePos;
  threats: Unit[];
  threatTotal: number;
  armorThreat: number;
  infThreat: number;
  threatCentroid: TilePos | null;
  myExtractors: number;
  myDerricks: number;
  myBarracks: number;
  myFactories: number;
  myTanks: number;
  myRifles: number;
  myHowitzers: number;
  myArmy: number; // combat units on the field
  myTrucks: number;
  myEco: number; // serviceable mines + derricks
  enemyHarvesters: number;
  enemyEco: number;
  enemyPlants: number;
  enemyArmor: number;
  enemyArtillery: number;
  attackBridge: TilePos;
  goldRate: number;
  oilRate: number;
  myPlants: number;
  powerLeft: number; // grid headroom (capacity minus live draw)
  ecoRaid: number; // enemy combat strength sitting on my eco/power buildings
  raidSpot: TilePos | null; // where that raid is — the spot to defend
}

interface PendingPlay { slot: number; target: TilePos | null; uid: number }

export class AiController {
  private nextThink: number;
  /** seconds left on the human-like reaction delay before `pending` executes */
  private nextPlay = 0;
  /** a play the AI has DECIDED on but is still "reaching for" (delay) */
  private pending: PendingPlay | null = null;
  private rng: Rng;

  constructor(
    public team: TeamId,
    seed: number,
    public profile: AiProfile = AI_PROFILES.standard
  ) {
    this.rng = new Rng(seed);
    this.nextThink = 1.0 + this.rng.next();
  }

  update(sim: Sim, dt: number): void {
    if (sim.result) return;
    // a decision is in flight: the AI has chosen, now it "reacts and clicks"
    // after a randomized human delay — never instantly, even at max difficulty
    if (this.pending) {
      this.nextPlay -= dt;
      if (this.nextPlay > 0) return;
      const act = this.pending;
      this.pending = null;
      this.nextThink = this.rng.range(this.profile.thinkMin, this.profile.thinkMax);
      // the board moved during the delay — only fire if the same proposal is
      // still in that slot and still legal
      const slot = sim.players[this.team].hand[act.slot];
      if (slot && slot.uid === act.uid && sim.canPlay(this.team, act.slot, act.target ?? undefined).ok) {
        sim.playCard(this.team, act.slot, act.target ?? undefined);
      }
      return;
    }
    this.nextThink -= dt;
    if (this.nextThink > 0) return;
    this.nextThink = this.rng.range(this.profile.thinkMin, this.profile.thinkMax);
    const choice = this.think(sim);
    if (choice) {
      this.pending = choice;
      this.nextPlay = this.rng.range(this.profile.delayMin, this.profile.delayMax);
    }
  }

  /**
   * Playstyle + A/B-side weighting laid ON TOP of the base card score, so the
   * personality bends the build order (and actually USES B sides) without
   * forking the 30-case scorer. Only ever ADDS to a card the base scorer already
   * wants (score > 0), so it bends priorities rather than inventing plays.
   */
  private styleBonus(card: CardDef, ctx: Context): number {
    const ps = this.profile.playstyle;
    const base = baseId(card.id);
    let b = 0;
    if (ps === 'armor') {
      if (base === 'factory') b += 1.2;
      if (base === 'tank') b += 1.0;
      if (base === 'extractor' || base === 'derrick') b += 0.8; // risky fast economy to fund armor
      if (base === 'sabot' || base === 'reactive') b += 0.8;
      if (base === 'atturret') b += 0.4;
      if (base === 'rifle') b -= 0.5;
    } else if (ps === 'rush') {
      if (base === 'barracks') b += 1.2;
      if (base === 'rifle' || base === 'rocket') b += 0.8;
      if (base === 'buggy') b += 0.7 + (ctx.enemyEco > 0 ? 0.6 : 0);
      if (base === 'attackorder') b += 1.0;
      if (base === 'hiteconomy') b += 0.8;
      if (base === 'factory') b -= 0.6;
    }
    // B-side awareness: reward the alternate side when its niche fits the board
    if (card.side === 'B') {
      if (card.id === 'tank_b' && ctx.enemyEco + ctx.enemyPlants >= 1) b += 0.7; // siege gun vs structures
      else if (card.id === 'factory_b' && ctx.enemyHarvesters + ctx.enemyEco > 0) b += 0.5; // buggies raid
      else if (card.id === 'barracks_b' && ctx.enemyArmor >= 1) b += 0.6; // rockets answer armor
      else if (card.id === 'buggy_b') b += 0.3;
      else if (card.id === 'rocket_b' && ctx.armorThreat > 0) b += 0.4;
      else if (card.id === 'airstrike_b') b += 0.2;
    }
    return b;
  }

  private buildContext(sim: Sim): Context {
    const me = this.team;
    const enemy = (1 - me) as TeamId;
    const myHq = sim.map.hq[me];
    const enemyHq = sim.map.hq[enemy];

    const threats: Unit[] = [];
    for (const u of sim.units) {
      if (u.team !== enemy || u.hp <= 0) continue;
      const nearHq = Math.hypot(u.pos.x - myHq.c, u.pos.y - myHq.r) < 6.5;
      let nearBuilding = false;
      if (!nearHq) {
        for (const b of sim.buildings) {
          if (b.team !== me) continue;
          if (Math.hypot(u.pos.x - b.tile.c, u.pos.y - b.tile.r) < 4) {
            nearBuilding = true;
            break;
          }
        }
      }
      if (nearHq || nearBuilding) threats.push(u);
    }
    let threatTotal = 0, armorThreat = 0, infThreat = 0;
    let cx = 0, cy = 0;
    for (const t of threats) {
      const v = THREAT_VALUE[t.kind];
      threatTotal += v;
      if (UNIT_STATS[t.kind].armor === 'armor') armorThreat += v;
      else infThreat += v;
      cx += t.pos.x;
      cy += t.pos.y;
    }
    const threatCentroid = threats.length > 0
      ? { c: Math.round(cx / threats.length), r: Math.round(cy / threats.length) }
      : null;

    let myExtractors = 0, myDerricks = 0, myBarracks = 0, myFactories = 0, enemyEco = 0, enemyPlants = 0;
    let myPlants = 0, powerLeft = 0;
    for (const b of sim.buildings) {
      if (b.team === me) {
        if (b.kind === 'extractor') myExtractors++;
        if (b.kind === 'derrick') myDerricks++;
        if (b.kind === 'barracks') myBarracks++;
        if (b.kind === 'factory') myFactories++;
        if (b.kind === 'powerplant') myPlants++;
        const pw = BUILDING_STATS[b.kind].power;
        if (pw > 0) powerLeft += pw;
        else if (!b.freePower) powerLeft += pw; // draws subtract
      } else {
        if (b.kind === 'extractor' || b.kind === 'derrick') enemyEco++;
        if (b.kind === 'powerplant') enemyPlants++;
      }
    }
    const myEco = myExtractors + myDerricks;
    let myTanks = 0, myRifles = 0, myHowitzers = 0, myArmy = 0, myTrucks = 0;
    let enemyHarvesters = 0, enemyArmor = 0, enemyArtillery = 0;
    for (const u of sim.units) {
      if (u.team === me) {
        if (u.kind === 'tank') myTanks++;
        if (u.kind === 'rifle') myRifles++;
        if (u.kind === 'howitzer') myHowitzers++;
        if (u.kind === 'harvester') myTrucks++;
        else myArmy++;
      } else {
        if (u.kind === 'harvester') enemyHarvesters++;
        if (u.kind === 'howitzer') enemyArtillery++;
        if (UNIT_STATS[u.kind].armor === 'armor') enemyArmor++;
      }
    }

    // attack the bridge with less enemy defense around it
    let attackBridge = sim.map.bridges[0] ?? enemyHq;
    let bestDef = Infinity;
    for (const br of sim.map.bridges) {
      let def = 0;
      for (const b of sim.buildings) {
        if (b.team !== me && (b.kind === 'bunker' || b.kind === 'atturret') && chebyshev(b.tile, br) <= 3) def += 2;
      }
      for (const u of sim.units) {
        if (u.team !== me && u.hp > 0 && Math.hypot(u.pos.x - br.c, u.pos.y - br.r) < 3) def += THREAT_VALUE[u.kind];
      }
      def += this.rng.next() * 0.5; // slight unpredictability in lane choice
      if (def < bestDef) {
        bestDef = def;
        attackBridge = br;
      }
    }

    let goldRate = 1, oilRate = 0;
    for (const b of sim.buildings) {
      if (b.team !== me) continue;
      const boost = b.boostTimer > 0 ? 2 : 1;
      if (b.kind === 'extractor') goldRate += 3 * boost;
      if (b.kind === 'derrick') oilRate += 2 * boost;
    }

    // raid alarm: enemy combat units sitting on my economy/power (the rush
    // exploit). The AI must answer this fast — it's how a player snipes a plant
    // and strands the base. Sum their threat, track where they are.
    let ecoRaid = 0, raidCx = 0, raidCy = 0, raidN = 0;
    for (const u of sim.units) {
      if (u.team === enemy && u.hp > 0 && UNIT_STATS[u.kind].weapon !== 'none') {
        for (const b of sim.buildings) {
          if (b.team !== me) continue;
          if (b.kind !== 'extractor' && b.kind !== 'derrick' && b.kind !== 'powerplant') continue;
          if (Math.hypot(u.pos.x - b.tile.c, u.pos.y - b.tile.r) < 4.5) {
            ecoRaid += THREAT_VALUE[u.kind];
            raidCx += u.pos.x; raidCy += u.pos.y; raidN++;
            break;
          }
        }
      }
    }
    const raidSpot = raidN > 0 ? { c: Math.round(raidCx / raidN), r: Math.round(raidCy / raidN) } : null;

    return {
      myHq, enemyHq, threats, threatTotal, armorThreat, infThreat, threatCentroid,
      myExtractors, myDerricks, myBarracks, myFactories, myTanks, myRifles, myHowitzers,
      myArmy, myTrucks, myEco, enemyHarvesters, enemyEco, enemyPlants, enemyArmor,
      enemyArtillery, attackBridge, goldRate, oilRate, myPlants, powerLeft, ecoRaid, raidSpot
    };
  }

  private scoreCard(sim: Sim, card: CardDef, ctx: Context): { score: number; target: TilePos | null } {
    const me = this.team;
    const agg = this.profile.aggression;

    const toward = (want: TilePos) => nearestValidTile(sim, me, card, want);
    // defend the raid if one is live, else the general threat, else home
    const defendSpot = () => toward(ctx.raidSpot ?? ctx.threatCentroid ?? ctx.myHq);
    const frontSpot = () => toward(ctx.attackBridge);

    // variants score like their base card (a Siege Tank is still a tank to the AI)
    switch (baseId(card.id)) {
      case 'powerplant': {
        // park plants in the open AND toward the rear — a forward plant is a
        // raider's favourite target (lose it and the whole grid goes dark)
        const t = clearestValidTile(sim, me, card, ctx.myHq, ctx.enemyHq);
        if (!t) return { score: 0, target: null };
        // build ONLY what the grid needs — never stockpile spare plants
        if (ctx.myPlants === 0) return { score: 6, target: t }; // nothing works without one
        if (ctx.powerLeft < 0) return { score: 5, target: t }; // brownout — fix it now
        if (ctx.powerLeft <= 2) return { score: 3.4, target: t }; // next building would go dark
        // a held building card the grid can't feed yet is the only other reason
        const blocked = sim.players[me].hand.some((s) => {
          if (!s) return false;
          const held = CARDS[s.card.id];
          return !!held?.building && -BUILDING_STATS[held.building].power > ctx.powerLeft;
        });
        if (blocked) return { score: 2.4, target: t };
        return { score: 0, target: t }; // headroom exists: a plant is waste
      }
      case 'extractor': {
        const t = toward(ctx.myHq);
        if (!t) return { score: 0, target: null };
        return { score: ctx.myExtractors === 0 ? 5 : 4 - ctx.myExtractors * 0.9, target: t };
      }
      case 'derrick': {
        const t = toward(ctx.myHq);
        if (!t) return { score: 0, target: null };
        return { score: ctx.myDerricks === 0 ? 3.9 : 1.8, target: t };
      }
      case 'barracks': {
        const t = frontSpot();
        if (!t) return { score: 0, target: null };
        const score = ctx.myBarracks === 0 ? 4.3 : sim.players[me].gold > 260 ? 2.0 : 0.8;
        return { score, target: t };
      }
      case 'factory': {
        const t = frontSpot();
        if (!t) return { score: 0, target: null };
        if (ctx.oilRate <= 0 && sim.players[me].oil < 80) return { score: 0.2, target: t };
        return { score: ctx.myFactories === 0 ? 3.7 : ctx.myFactories < 2 ? 2.2 : 0.5, target: t };
      }
      case 'bunker': {
        const t = defendSpot();
        if (!t) return { score: 0, target: null };
        return { score: 0.9 + ctx.infThreat * 0.55 + ctx.ecoRaid * 0.8 + (1 - agg) * 0.6, target: t };
      }
      case 'atturret': {
        const t = defendSpot();
        if (!t) return { score: 0, target: null };
        const enemyHasFactory = sim.buildings.some((b) => b.team !== me && b.kind === 'factory');
        return { score: 0.8 + ctx.armorThreat * 1.1 + ctx.ecoRaid * 0.6 + (enemyHasFactory ? 0.9 : 0) + (1 - agg) * 0.5, target: t };
      }
      // units muster at the HQ — no targets, score by context only
      case 'rifle': {
        if (ctx.threatTotal > 0.5 && ctx.infThreat >= ctx.armorThreat) {
          return { score: 1.7 + ctx.infThreat * 0.45, target: null };
        }
        return { score: 1.5 + agg * 0.8, target: null };
      }
      case 'rocket': {
        // rockets are also the base guard — surge them when raiders are inside the base
        if (ctx.armorThreat > 0) return { score: 2.0 + ctx.armorThreat * 1.2 + ctx.ecoRaid * 0.4, target: null };
        return { score: 0.9 + ctx.enemyArmor * 0.5 + ctx.ecoRaid * 0.7, target: null };
      }
      case 'tank':
        return { score: 2.3 + agg * 0.7 + (ctx.threatTotal > 2 ? 0.4 : 0), target: null };
      case 'howitzer': {
        let near = 0;
        for (const b of sim.buildings) {
          if (b.team !== me && chebyshev(b.tile, ctx.myHq) <= 9) near++;
        }
        return { score: 1.7 + Math.min(near, 3) * 0.45 + ctx.threatTotal * 0.2, target: null };
      }
      case 'harvester': {
        // one truck runs a couple of nodes; more eco supports a second truck
        if (ctx.myEco === 0) return { score: 0.2, target: null };
        if (ctx.myTrucks === 0) return { score: 3.1, target: null };
        return { score: ctx.myTrucks < Math.ceil(ctx.myEco / 3) ? 1.8 : 0.2, target: null };
      }
      case 'buggy':
        return { score: 1.0 + (ctx.enemyHarvesters > 0 ? 1.7 : 0) + (ctx.enemyEco > 0 ? 0.7 : 0) + ctx.ecoRaid * 0.5, target: null };
      case 'sabot':
        return { score: ctx.myTanks + ctx.myFactories >= 1 ? 2.6 : 0.2, target: null };
      case 'apammo':
        return { score: ctx.myRifles >= 3 || ctx.enemyArmor >= 2 ? 2.5 : 0.4, target: null };
      case 'reactive':
        return { score: ctx.myTanks >= 2 ? 2.4 : 0.3, target: null };
      case 'smoke':
        return { score: ctx.myRifles >= 4 ? 2.0 : 0.3, target: null };
      case 'barrels':
        return { score: ctx.myHowitzers >= 1 ? 2.3 : 0.2, target: null };
      case 'nuke':
        // free, unanswerable, instant win on the HQ — play it the moment it lands
        return { score: 50, target: ctx.enemyHq };
      // ── standing orders: issue one only when the moment matches it ──
      case 'attackorder':
        return { score: ctx.myArmy >= 5 ? 2.4 + agg * 1.2 + ctx.myArmy * 0.08 : 0, target: null };
      case 'defendorder':
        return { score: (ctx.threatTotal >= 3.5 || ctx.ecoRaid >= 2) && ctx.myArmy >= 2 ? 3.0 + Math.max(ctx.threatTotal, ctx.ecoRaid) * 0.2 : 0, target: null };
      case 'spreadorder':
        return { score: ctx.enemyArtillery > 0 && ctx.myArmy >= 4 ? 2.2 : 0, target: null };
      case 'hitpower':
        return { score: ctx.enemyPlants > 0 && ctx.myArmy >= 4 ? 2.1 + agg * 0.5 : 0, target: null };
      case 'hiteconomy':
        return { score: ctx.enemyEco >= 2 && ctx.myArmy >= 3 ? 2.0 + agg * 0.5 : 0, target: null };
      case 'airstrike': {
        // find the juiciest enemy cluster
        let best: TilePos | null = null;
        let bestVal = 0;
        for (const u of sim.units) {
          if (u.team === me || u.hp <= 0) continue;
          let val = 0;
          for (const v of sim.units) {
            if (v.hp <= 0) continue;
            const d = Math.hypot(v.pos.x - u.pos.x, v.pos.y - u.pos.y);
            if (d <= 1.6) val += v.team === me ? -THREAT_VALUE[v.kind] : THREAT_VALUE[v.kind];
          }
          if (val > bestVal) {
            bestVal = val;
            best = { c: Math.round(u.pos.x), r: Math.round(u.pos.y) };
          }
        }
        if (!best || bestVal < 2.5) return { score: 0.3, target: best };
        return { score: 1.5 + bestVal * 0.55, target: best };
      }
    }
    return { score: 0, target: null };
  }

  /** Decide the next play (or null to wait/bank). Does NOT execute it — update()
   *  fires it after the reaction delay. */
  private think(sim: Sim): PendingPlay | null {
    const p = sim.players[this.team];
    const ctx = this.buildContext(sim);

    interface Option { slot: number; card: CardDef; score: number; target: TilePos | null }
    const options: Option[] = [];
    for (let i = 0; i < p.hand.length; i++) {
      const s = p.hand[i];
      if (!s) continue;
      const card = CARDS[s.card.id];
      if (card.kind === 'upgrade' && p.upgrades.has(card.upgrade!)) continue;
      if (card.order && p.order) continue; // one standing order at a time
      if (sim.rules.tech) {
        // tech-locked cards aren't options, and never place a building that would start dark
        const req = tierRequirement(card);
        if (req && !sim.hasLiveBuilding(this.team, req)) continue;
        if (card.building) {
          const draw = -BUILDING_STATS[card.building].power;
          if (draw > 0 && draw > ctx.powerLeft) continue;
        }
      }
      const { score, target } = this.scoreCard(sim, card, ctx);
      if (score <= 0) continue;
      // playstyle + B-side personality bends an already-wanted card's priority
      const adjusted = score + this.styleBonus(card, ctx);
      if (card.place !== 'none' && !target) continue;
      // upgrades shouldn't starve the economy
      if (card.kind === 'upgrade' && p.gold < card.gold + 120) continue;
      options.push({ slot: i, card, score: adjusted, target });
    }
    options.sort((a, b) => b.score - a.score);

    for (const opt of options) {
      const affordable = p.gold >= opt.card.gold && p.oil >= opt.card.oil;
      if (affordable) {
        const slot = p.hand[opt.slot];
        return slot ? { slot: opt.slot, target: opt.target, uid: slot.uid } : null;
      }
      // bank for a high-value card if it's affordable soon; otherwise fall through
      const goldWait = ctx.goldRate > 0 ? Math.max(0, opt.card.gold - p.gold) / ctx.goldRate : Infinity;
      const oilWait = opt.card.oil > 0 ? (ctx.oilRate > 0 ? Math.max(0, opt.card.oil - p.oil) / ctx.oilRate : Infinity) : 0;
      if (opt.score >= 3 && Math.max(goldWait, oilWait) <= 5) return null;
    }
    return null;
  }
}

/** Headless AI-vs-AI match: the test harness and balance lab. */
export function runHeadlessMatch(opts: {
  seed: number;
  loadouts: [string[], string[]];
  profiles?: [AiProfile, AiProfile];
  maxTime?: number;
}): { sim: Sim; winner: TeamId | null; time: number } {
  const sim = new Sim(opts.seed, opts.loadouts);
  const profiles = opts.profiles ?? [AI_PROFILES.standard, AI_PROFILES.standard];
  const ais = [new AiController(0, opts.seed * 7 + 1, profiles[0]), new AiController(1, opts.seed * 13 + 2, profiles[1])];
  const maxTime = opts.maxTime ?? 720;
  const dt = 0.05;
  while (!sim.result && sim.time < maxTime) {
    for (const ai of ais) ai.update(sim, dt);
    sim.step();
    sim.events.length = 0; // headless: discard render events
  }
  return { sim, winner: sim.result?.winner ?? null, time: sim.time };
}
