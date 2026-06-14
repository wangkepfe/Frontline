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

export interface AiProfile {
  name: string;
  thinkMin: number; // seconds between decisions
  thinkMax: number;
  aggression: number; // 0..1, weights offensive plays
}

export const AI_PROFILES: Record<string, AiProfile> = {
  standard: { name: 'standard', thinkMin: 0.6, thinkMax: 1.1, aggression: 0.5 },
  turtle: { name: 'turtle', thinkMin: 0.7, thinkMax: 1.2, aggression: 0.25 },
  aggressive: { name: 'aggressive', thinkMin: 0.5, thinkMax: 0.9, aggression: 0.85 }
};

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
}

export class AiController {
  private nextThink: number;
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
    this.nextThink -= dt;
    if (this.nextThink > 0) return;
    this.nextThink = this.rng.range(this.profile.thinkMin, this.profile.thinkMax);
    this.think(sim);
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

    return {
      myHq, enemyHq, threats, threatTotal, armorThreat, infThreat, threatCentroid,
      myExtractors, myDerricks, myBarracks, myFactories, myTanks, myRifles, myHowitzers,
      myArmy, myTrucks, myEco, enemyHarvesters, enemyEco, enemyPlants, enemyArmor,
      enemyArtillery, attackBridge, goldRate, oilRate, myPlants, powerLeft
    };
  }

  private scoreCard(sim: Sim, card: CardDef, ctx: Context): { score: number; target: TilePos | null } {
    const me = this.team;
    const agg = this.profile.aggression;

    const toward = (want: TilePos) => nearestValidTile(sim, me, card, want);
    const defendSpot = () => toward(ctx.threatCentroid ?? ctx.myHq);
    const frontSpot = () => toward(ctx.attackBridge);

    // variants score like their base card (a Siege Tank is still a tank to the AI)
    switch (baseId(card.id)) {
      case 'powerplant': {
        // park plants in the open — one wedged between structures walls off lanes
        const t = clearestValidTile(sim, me, card, ctx.myHq);
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
        return { score: 0.9 + ctx.infThreat * 0.55 + (1 - agg) * 0.6, target: t };
      }
      case 'atturret': {
        const t = defendSpot();
        if (!t) return { score: 0, target: null };
        const enemyHasFactory = sim.buildings.some((b) => b.team !== me && b.kind === 'factory');
        return { score: 0.8 + ctx.armorThreat * 1.1 + (enemyHasFactory ? 0.9 : 0) + (1 - agg) * 0.5, target: t };
      }
      // units muster at the HQ — no targets, score by context only
      case 'rifle': {
        if (ctx.threatTotal > 0.5 && ctx.infThreat >= ctx.armorThreat) {
          return { score: 1.7 + ctx.infThreat * 0.45, target: null };
        }
        return { score: 1.5 + agg * 0.8, target: null };
      }
      case 'rocket': {
        if (ctx.armorThreat > 0) return { score: 2.0 + ctx.armorThreat * 1.2, target: null };
        return { score: 0.9 + ctx.enemyArmor * 0.5, target: null };
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
        return { score: 1.0 + (ctx.enemyHarvesters > 0 ? 1.7 : 0) + (ctx.enemyEco > 0 ? 0.7 : 0), target: null };
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
        return { score: ctx.threatTotal >= 3.5 && ctx.myArmy >= 2 ? 3.0 + ctx.threatTotal * 0.2 : 0, target: null };
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

  private think(sim: Sim): void {
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
      if (card.place !== 'none' && !target) continue;
      // upgrades shouldn't starve the economy
      if (card.kind === 'upgrade' && p.gold < card.gold + 120) continue;
      options.push({ slot: i, card, score, target });
    }
    options.sort((a, b) => b.score - a.score);

    for (const opt of options) {
      const affordable = p.gold >= opt.card.gold && p.oil >= opt.card.oil;
      if (affordable) {
        sim.playCard(this.team, opt.slot, opt.target ?? undefined);
        return;
      }
      // bank for a high-value card if it's affordable soon; otherwise fall through
      const goldWait = ctx.goldRate > 0 ? Math.max(0, opt.card.gold - p.gold) / ctx.goldRate : Infinity;
      const oilWait = opt.card.oil > 0 ? (ctx.oilRate > 0 ? Math.max(0, opt.card.oil - p.oil) / ctx.oilRate : Infinity) : 0;
      if (opt.score >= 3 && Math.max(goldWait, oilWait) <= 5) return;
    }
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
