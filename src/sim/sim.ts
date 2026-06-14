import { GameMap, TilePos, pushOutOfTerrain } from './map';
import {
  BaseAlarm, Building, BuildingMods, CardRef, HandSlot, PendingStrike, PlayerState, Shell, SimEvent,
  SimOptions, SimRules, TeamId, Unit, UnitKind, UnitMods, BuildingKind, Vec2, Wave
} from './types';
import { Rng } from './rng';
import {
  CARDS, CardDef, CardTier, CATEGORY_SLOTS, HandCategory, cardCategory, tierRequirement,
  tierUnlockedBy
} from './cards';
import {
  AIRSTRIKE, BUILDING_STATS, CARD_TTL, COLLECT_STEP, CONVOY_BOOST_DURATION, DERRICK_INCOME,
  DRAW_INTERVAL_MAX, DRAW_INTERVAL_MIN, ESCALATE_DRAW_MULT, ESCALATE_DRAW_T, EXTRACTOR_INCOME,
  FORGE_BUILDING, FORGE_STRIKE, FORGE_UNIT, HARVESTER_BOOST, HQ_INCOME_GOLD, INITIAL_HAND, NUKE,
  NUKE_REDEAL, NUKE_UNLOCK_T, ORDER_DURATION, REFRESH_COST, REFRESH_DEAL, REFRESH_SURGE,
  REFRESH_SURGE_DECAY, STORE_CAP_GOLD, STORE_CAP_OIL, TICK_DT, TIER_UNLOCK_DEAL, UNIT_STATS
} from './stats';
import { nearestWalkableNeighbor, tickBuilding, tickUnit } from './behavior';
import { dealSplash } from './combat';
import { isValidPlacement, nearestValidTile } from './placement';

export interface PlayResult {
  ok: boolean;
  reason?: string;
}

type LoadoutInput = Array<string | CardRef>;

function normalizeLoadout(input: LoadoutInput): CardRef[] {
  return input.map((e) => (typeof e === 'string' ? { id: e, up: false } : { id: e.id, up: e.up }));
}

export class Sim {
  readonly map: GameMap;
  readonly rng: Rng;
  readonly rules: SimRules;
  time = 0;
  tick = 0;
  nextId = 1;
  players: [PlayerState, PlayerState];
  units: Unit[] = [];
  buildings: Building[] = [];
  shells: Shell[] = [];
  strikes: PendingStrike[] = [];
  events: SimEvent[] = [];
  result: { winner: TeamId } | null = null;
  blocked: Uint8Array;
  /** per team: last friendly building hit by enemy fire (defensive units respond) */
  baseAlarm: [BaseAlarm | null, BaseAlarm | null] = [null, null];
  private lastNukeAt: [number, number] = [-Infinity, -Infinity];
  private waves: Wave[];
  private waveIdx = 0;

  constructor(seed: number, loadouts: [LoadoutInput, LoadoutInput], opts: SimOptions = {}) {
    this.rng = new Rng(seed);
    this.map = new GameMap(opts.mapLayout);
    this.rules = {
      manualCollect: false,
      escalation: true,
      incomeMult: [1, 1],
      tech: true,
      hqGun: true,
      humanTeams: [true, false],
      ...opts.rules
    };
    this.waves = [...(opts.waves ?? [])].sort((a, b) => a.t - b.t);
    this.blocked = new Uint8Array(this.map.w * this.map.h);
    this.players = [
      this.makePlayer(0, normalizeLoadout(loadouts[0])),
      this.makePlayer(1, normalizeLoadout(loadouts[1]))
    ];

    const start = opts.start ?? {};
    for (const team of [0, 1] as const) {
      if (start.gold) this.players[team].gold = start.gold[team];
      if (start.oil) this.players[team].oil = start.oil[team];
      const hq = this.placeBuilding(team, 'hq', this.map.hq[team], {}, false, true);
      const hpOverride = start.hqHp?.[team];
      if (hpOverride != null) {
        hq.hp = hpOverride;
        hq.maxHp = hpOverride;
      }
    }
    for (const pre of start.prebuilt ?? []) {
      if (pre.building) {
        const b = this.placeBuilding(pre.team, pre.building, pre.tile, {}, false, true);
        if (pre.hp != null) {
          b.hp = pre.hp;
          b.maxHp = pre.hp;
        }
      } else if (pre.unit) {
        this.spawnUnit(pre.team, pre.unit, { x: pre.tile.c, y: pre.tile.r });
      }
    }

    // opening hand: a few cards immediately, the rest on the global deal timer.
    // under tech rules the tier gate in drawCard means only base-tier cards
    // (power plants) can open — locked cards wait in the queue.
    for (const p of this.players) {
      for (let i = 0; i < INITIAL_HAND; i++) this.drawCard(p);
    }
  }

  private makePlayer(team: TeamId, loadout: CardRef[]): PlayerState {
    return {
      team,
      gold: 150,
      oil: 0,
      upgrades: new Set(),
      hand: [null, null, null, null, null, null], // 2 building / 2 unit / 2 action slots
      queue: [],
      loadout,
      drawTimer: DRAW_INTERVAL_MIN,
      refreshSurge: { building: [], unit: [], action: [] },
      order: null,
      damageDealt: 0
    };
  }

  /** next global deal delay: random within range, accelerated by escalation */
  nextDrawInterval(): number {
    const mult = this.time >= ESCALATE_DRAW_T ? ESCALATE_DRAW_MULT : 1;
    return this.rng.range(DRAW_INTERVAL_MIN, DRAW_INTERVAL_MAX) * mult;
  }

  /**
   * A card is dealable unless (a) tech rules lock its tier, or (b) it auto-
   * places and no valid site exists right now — a Gold Extractor with every
   * in-territory mine taken waits in the queue instead of clogging the hand.
   */
  private dealable(team: TeamId, ref: CardRef): boolean {
    const def = CARDS[ref.id];
    if (!def) return true;
    if (def.auto && !this.autoPlaceTile(team, def)) return false;
    if (!this.rules.tech) return true;
    const req = tierRequirement(def);
    return !req || this.hasLiveBuilding(team, req);
  }

  /** where a one-click card would build: the nearest valid site to the HQ */
  autoPlaceTile(team: TeamId, card: CardDef): TilePos | null {
    return nearestValidTile(this, team, card, this.map.hq[team]);
  }

  /**
   * The queue can stall holding only locked cards while the copies that would
   * re-open the ladder (e.g. a power plant that was built and then destroyed)
   * are already spent. Shuffle the spent copies — loadout minus queue minus
   * hand — back into the queue so the ladder is always climbable again.
   */
  private recycleSpent(p: PlayerState): void {
    const key = (c: CardRef) => `${c.id}|${c.up ? 1 : 0}`;
    const counts = new Map<string, { n: number; ref: CardRef }>();
    for (const c of p.loadout) {
      const e = counts.get(key(c));
      if (e) e.n++;
      else counts.set(key(c), { n: 1, ref: c });
    }
    for (const c of p.queue) {
      const e = counts.get(key(c));
      if (e) e.n--;
    }
    for (const s of p.hand) {
      if (!s) continue;
      const e = counts.get(key(s.card));
      if (e) e.n--;
    }
    const spent: CardRef[] = [];
    for (const { n, ref } of counts.values()) {
      for (let i = 0; i < n; i++) spent.push({ id: ref.id, up: ref.up });
    }
    if (spent.length > 0) p.queue.push(...this.rng.shuffle(spent));
  }

  /** first open slot on the desk that deals this card's category, or -1 */
  private freeSlotFor(p: PlayerState, ref: CardRef): number {
    const def = CARDS[ref.id];
    if (!def) return -1;
    return CATEGORY_SLOTS[cardCategory(def)].find((i) => p.hand[i] === null) ?? -1;
  }

  private drawCard(p: PlayerState): boolean {
    if (p.hand.every((s) => s !== null)) return false;
    if (p.loadout.length === 0) return false;
    if (p.queue.length === 0) {
      p.queue = this.rng.shuffle(p.loadout.map((c) => ({ ...c })));
    }
    // tier gate + desk gate: deal the first unlocked card whose desk has room;
    // locked cards and cards for a full desk wait in the queue
    const pick = (c: CardRef) => this.dealable(p.team, c) && this.freeSlotFor(p, c) !== -1;
    let qi = p.queue.findIndex(pick);
    if (qi === -1) {
      this.recycleSpent(p);
      qi = p.queue.findIndex(pick);
      if (qi === -1) return false; // nothing dealable fits — deal wasted
    }
    const card = p.queue.splice(qi, 1)[0];
    const uid = this.nextId++;
    p.hand[this.freeSlotFor(p, card)] = { uid, card, ttl: CARD_TTL };
    this.events.push({ t: 'cardDrawn', team: p.team, uid });
    return true;
  }

  /** live reissue price for a desk: base cost + every still-cooling surcharge */
  refreshCost(team: TeamId, cat: HandCategory): number {
    let cost = REFRESH_COST;
    for (const s of this.players[team].refreshSurge[cat]) cost += Math.ceil(s);
    return cost;
  }

  /**
   * Paid desk refresh: discard the desk's current proposals back into the
   * queue and immediately deal REFRESH_DEAL fresh cards of that category.
   * Each click opens its own +REFRESH_SURGE tab on the desk's price.
   */
  refreshRegion(team: TeamId, cat: HandCategory): PlayResult {
    if (this.result) return { ok: false, reason: 'match over' };
    const p = this.players[team];
    const cost = this.refreshCost(team, cat);
    if (p.gold < cost) return { ok: false, reason: 'resources' };
    p.gold -= cost;
    p.refreshSurge[cat].push(REFRESH_SURGE);
    const discarded: CardRef[] = [];
    for (const i of CATEGORY_SLOTS[cat]) {
      const s = p.hand[i];
      if (s) {
        discarded.push(s.card);
        p.hand[i] = null; // silent discard — the fresh deals make the noise
      }
    }
    if (discarded.length > 0) p.queue = this.rng.shuffle([...p.queue, ...discarded]);
    for (let n = 0; n < REFRESH_DEAL; n++) {
      const slot = CATEGORY_SLOTS[cat].find((i) => p.hand[i] === null);
      if (slot === undefined) break;
      const pick = (c: CardRef) =>
        CARDS[c.id] && cardCategory(CARDS[c.id]) === cat && this.dealable(team, c);
      let qi = p.queue.findIndex(pick);
      if (qi === -1) {
        this.recycleSpent(p);
        qi = p.queue.findIndex(pick);
        if (qi === -1) break; // the loadout has nothing dealable for this desk
      }
      const card = p.queue.splice(qi, 1)[0];
      const uid = this.nextId++;
      p.hand[slot] = { uid, card, ttl: CARD_TTL };
      this.events.push({ t: 'cardDrawn', team, uid });
    }
    return { ok: true };
  }

  private tickHand(p: PlayerState, dt: number): void {
    for (let i = 0; i < p.hand.length; i++) {
      const s = p.hand[i];
      if (!s) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        this.events.push({ t: 'cardExpired', team: p.team, uid: s.uid });
        p.hand[i] = null;
      }
    }
    // the deal timer is global and relentless: a full hand wastes the deal
    p.drawTimer -= dt;
    if (p.drawTimer <= 0) {
      this.drawCard(p);
      p.drawTimer = this.nextDrawInterval();
    }
    // every reissue surcharge cools on its own clock
    for (const cat of ['building', 'unit', 'action'] as const) {
      const surges = p.refreshSurge[cat];
      if (surges.length === 0) continue;
      for (let i = 0; i < surges.length; i++) surges[i] -= REFRESH_SURGE_DECAY * dt;
      p.refreshSurge[cat] = surges.filter((s) => s > 0);
    }
  }

  spawnUnit(team: TeamId, kind: UnitKind, at: Vec2, mods: UnitMods = {}, forged = false): Unit {
    const st = UNIT_STATS[kind];
    const hpMult = (mods.hpMult ?? 1) * (forged ? FORGE_UNIT.hp : 1);
    const dmgMult = (mods.dmgMult ?? 1) * (forged ? FORGE_UNIT.dmg : 1);
    const stance = mods.stance ?? st.stance;
    const jitter = 0.18;
    const u: Unit = {
      id: this.nextId++,
      team,
      kind,
      pos: { x: at.x + this.rng.range(-jitter, jitter), y: at.y + this.rng.range(-jitter, jitter) },
      prevPos: { x: at.x, y: at.y },
      facing: team === 0 ? -Math.PI / 4 : (3 * Math.PI) / 4,
      hp: st.hp * hpMult,
      maxHp: st.hp * hpMult,
      dmg: st.damage * dmgMult,
      speed: Math.max(0.3, st.speed + (mods.speedAdd ?? 0)),
      vsBuildingMult: mods.vsBuildingMult ?? 1,
      boostMult: mods.boostMult ?? 1,
      stance,
      targetId: 0,
      path: [],
      pathTimer: 0,
      anchor: stance === 'defensive' ? { x: at.x, y: at.y } : null,
      cooldown: 0,
      retargetTimer: this.rng.next() * 0.3,
      harvestState: 'idle',
      assignedNode: 0,
      stateTimer: 0,
      lastDock: -1
    };
    u.prevPos = { ...u.pos };
    this.units.push(u);
    this.events.push({ t: 'unitSpawned', id: u.id });
    return u;
  }

  placeBuilding(team: TeamId, kind: BuildingKind, tile: TilePos, mods: BuildingMods = {}, forged = false, gratis = false): Building {
    // a gate kind going live where none was unlocks a tier (checked pre-placement)
    const unlocks =
      !gratis && this.rules.tech && !this.hasLiveBuilding(team, kind) ? tierUnlockedBy(kind) : null;
    const st = BUILDING_STATS[kind];
    const hpMult = (mods.hpMult ?? 1) * (forged ? FORGE_BUILDING.hp : 1);
    const prodInterval = st.prodInterval * (mods.prodMult ?? 1) * (forged ? FORGE_BUILDING.prod : 1);
    const b: Building = {
      id: this.nextId++,
      team,
      kind,
      tile: { ...tile },
      hp: st.hp * hpMult,
      maxHp: st.hp * hpMult,
      dmg: st.damage * (mods.dmgMult ?? 1) * (forged ? FORGE_UNIT.dmg : 1),
      rateMult: (mods.rateMult ?? 1) * (forged ? FORGE_BUILDING.rate : 1),
      prodUnit: mods.prodUnit ?? st.prodUnit,
      prodInterval,
      territoryRadius: mods.territoryRadius ?? st.territory,
      prodTimer: prodInterval > 0 ? prodInterval * 0.5 : 0,
      cooldown: 0,
      targetId: 0,
      boostTimer: 0,
      boostMult: 1,
      stored: 0,
      powered: true,
      freePower: gratis
    };
    this.buildings.push(b);
    this.blocked[this.map.idx(tile.c, tile.r)] = 1;
    // shove any units standing on the construction site to an adjacent tile
    for (const u of this.units) {
      if (Math.round(u.pos.x) === tile.c && Math.round(u.pos.y) === tile.r) {
        const spot = nearestWalkableNeighbor(this, tile, u.pos);
        if (spot) {
          u.pos.x = spot.c;
          u.pos.y = spot.r;
          u.prevPos = { ...u.pos };
          u.path = [];
          u.pathTimer = 0;
        }
      }
    }
    this.events.push({ t: 'buildingPlaced', id: b.id });
    if (unlocks !== null) this.dealTierBonus(team, unlocks);
    return b;
  }

  /**
   * Tier-up moment: the gate just went live, so a couple of cards from the
   * newly unlocked tier arrive on the spot — the plants-only opening deal,
   * echoed up the ladder. Deals only what the queue holds and the hand fits.
   */
  private dealTierBonus(team: TeamId, tier: CardTier): void {
    const p = this.players[team];
    for (let dealt = 0; dealt < TIER_UNLOCK_DEAL; dealt++) {
      const qi = p.queue.findIndex(
        (c) => CARDS[c.id]?.tier === tier && this.dealable(team, c) && this.freeSlotFor(p, c) !== -1
      );
      if (qi === -1) return;
      const card = p.queue.splice(qi, 1)[0];
      const uid = this.nextId++;
      p.hand[this.freeSlotFor(p, card)] = { uid, card, ttl: CARD_TTL };
      this.events.push({ t: 'cardDrawn', team, uid });
    }
  }

  /** Validation half of playCard — also drives UI affordability/placement display. */
  canPlay(team: TeamId, slotIndex: number, target?: TilePos): PlayResult {
    if (this.result) return { ok: false, reason: 'match over' };
    const p = this.players[team];
    const slot = p.hand[slotIndex];
    if (!slot) return { ok: false, reason: 'empty slot' };
    const card = CARDS[slot.card.id];
    if (!card) return { ok: false, reason: 'unknown card' };
    if (this.rules.tech) {
      const req = tierRequirement(card);
      if (req && !this.hasLiveBuilding(team, req)) return { ok: false, reason: `requires ${req}` };
    }
    if (p.gold < card.gold || p.oil < card.oil) return { ok: false, reason: 'resources' };
    if (card.kind === 'unit') {
      if (!this.unitSpawnPoint(team)) return { ok: false, reason: 'spawn blocked' };
      return { ok: true }; // units always muster at the HQ — no targeting
    }
    if (card.kind === 'upgrade' && p.upgrades.has(card.upgrade!)) return { ok: false, reason: 'owned' };
    if (card.auto) {
      // one-click cards pick their own tile; they only need a site to exist
      if (!this.autoPlaceTile(team, card)) return { ok: false, reason: 'no site' };
      return { ok: true };
    }
    if (card.place !== 'none') {
      if (!target) return { ok: false, reason: 'needs target' };
      if (!isValidPlacement(this, team, card, target.c, target.r)) return { ok: false, reason: 'invalid tile' };
    }
    return { ok: true };
  }

  hasLiveBuilding(team: TeamId, kind: BuildingKind): boolean {
    return this.buildings.some((b) => b.team === team && b.kind === kind && b.hp > 0);
  }

  /** units muster on the HQ's front-facing side */
  unitSpawnPoint(team: TeamId): TilePos | null {
    const enemyHq = this.map.hq[team === 0 ? 1 : 0];
    return nearestWalkableNeighbor(this, this.map.hq[team], { x: enemyHq.c, y: enemyHq.r });
  }

  playCard(team: TeamId, slotIndex: number, target?: TilePos): PlayResult {
    const check = this.canPlay(team, slotIndex, target);
    if (!check.ok) return check;
    const p = this.players[team];
    const slot = p.hand[slotIndex]!;
    const card = CARDS[slot.card.id];
    const forged = slot.card.up;

    p.gold -= card.gold;
    p.oil -= card.oil;
    p.hand[slotIndex] = null;
    this.events.push({ t: 'cardPlayed', team, cardId: card.id });

    switch (card.kind) {
      case 'building': {
        // auto cards ignore any provided target: the sim picks the site
        const tile = card.auto ? this.autoPlaceTile(team, card)! : target!;
        this.placeBuilding(team, card.building!, tile, card.buildingMods ?? {}, forged);
        break;
      }
      case 'unit': {
        const spawn = this.unitSpawnPoint(team)!; // canPlay guaranteed it
        this.spawnUnit(team, card.unit!, { x: spawn.c, y: spawn.r }, card.unitMods ?? {}, forged);
        break;
      }
      case 'upgrade':
        p.upgrades.add(card.upgrade!);
        break;
      case 'tactic': {
        if (card.order) {
          p.order = { kind: card.order, until: this.time + ORDER_DURATION };
          this.events.push({ t: 'orderIssued', team, kind: card.order });
          break;
        }
        if (card.nuke) {
          this.strikes.push({
            team,
            pos: { x: target!.c, y: target!.r },
            timer: NUKE.delay,
            damage: NUKE.damage,
            radius: NUKE.radius,
            nuke: true
          });
          this.events.push({ t: 'strikeCalled', pos: { x: target!.c, y: target!.r }, team, nuke: true });
          break;
        }
        const dmg = AIRSTRIKE.damage * (forged ? FORGE_STRIKE : 1);
        const tiles: TilePos[] = card.carpet
          ? [-1, 0, 1].map((d) => ({ c: target!.c + d, r: target!.r }))
          : [target!];
        for (const t of tiles) {
          if (!this.map.inBounds(t.c, t.r)) continue;
          this.strikes.push({
            team,
            pos: { x: t.c, y: t.r },
            timer: AIRSTRIKE.delay,
            damage: card.carpet ? dmg * 0.7 : dmg,
            radius: AIRSTRIKE.radius
          });
          this.events.push({ t: 'strikeCalled', pos: { x: t.c, y: t.r }, team });
        }
        break;
      }
    }
    return { ok: true };
  }

  /**
   * Manual collection: bank one building's pooled production, quantized to
   * 10-packages (collect 10, 20, 30...); the sub-10 remainder keeps accruing.
   */
  collectBuilding(team: TeamId, buildingId: number): { kind: 'gold' | 'oil'; amount: number } | null {
    const b = this.buildings.find((x) => x.id === buildingId);
    if (!b || b.team !== team || b.hp <= 0) return null;
    if (b.kind !== 'extractor' && b.kind !== 'derrick') return null;
    const amount = Math.floor(b.stored / COLLECT_STEP) * COLLECT_STEP;
    if (amount < COLLECT_STEP) return null;
    b.stored -= amount;
    const p = this.players[team];
    if (b.kind === 'extractor') {
      p.gold += amount;
      return { kind: 'gold', amount };
    }
    p.oil += amount;
    return { kind: 'oil', amount };
  }

  /**
   * Supply-truck service call: the truck docks at a mine/derrick, banks the
   * whole silo on the spot (the manual collect, automated) and puts the
   * building into a timed production boost.
   */
  serviceBuilding(truck: Unit, b: Building): void {
    if (b.hp <= 0) return;
    const amount = Math.floor(b.stored);
    if (amount >= 1) {
      b.stored -= amount;
      const p = this.players[b.team];
      const kind = b.kind === 'extractor' ? 'gold' : 'oil';
      if (kind === 'gold') p.gold += amount;
      else p.oil += amount;
      this.events.push({ t: 'truckCollect', team: b.team, id: b.id, kind, amount });
    }
    b.boostTimer = CONVOY_BOOST_DURATION;
    b.boostMult = 1 + HARVESTER_BOOST * truck.boostMult;
    this.events.push({ t: 'buildingBoosted', id: b.id });
  }

  /**
   * Electricity: plants add capacity; consumers draw it in PLACEMENT ORDER, so
   * an overbuilt grid browns out the newest structures (they sit dark until
   * capacity returns). Scripted scenarios (rules.tech off) skip the grid, and
   * prebuilt/wave structures are grandfathered in free.
   */
  private allocatePower(): void {
    const left: [number, number] = [0, 0];
    for (const b of this.buildings) {
      if (b.hp <= 0) continue;
      const gen = BUILDING_STATS[b.kind].power;
      if (gen > 0) left[b.team] += gen;
    }
    for (const b of this.buildings) {
      if (b.hp <= 0) continue;
      const draw = -BUILDING_STATS[b.kind].power;
      if (draw <= 0 || b.freePower || !this.rules.tech) {
        b.powered = true;
        continue;
      }
      if (draw <= left[b.team]) {
        left[b.team] -= draw;
        b.powered = true;
      } else {
        b.powered = false;
      }
    }
  }

  private income(dt: number): void {
    for (const b of this.buildings) {
      if (b.hp <= 0) continue;
      if (b.boostTimer > 0) b.boostTimer = Math.max(0, b.boostTimer - dt); // decays even when dark
      if (!b.powered) continue; // a dark mine pumps nothing
      const p = this.players[b.team];
      const mult = this.rules.incomeMult[b.team];
      const boost = b.boostTimer > 0 ? b.boostMult : 1;
      // HQ trickle always banks directly; under the manual-collect rule each
      // human extractor/derrick pools its production until clicked — and a full
      // silo stops producing, so ignoring your mines has a price. AI teams always
      // auto-bank (they can't click), so manual-collect only gates human teams.
      const manual = this.rules.manualCollect && this.rules.humanTeams[b.team];
      if (b.kind === 'hq') {
        p.gold += HQ_INCOME_GOLD * mult * dt;
      } else if (b.kind === 'extractor') {
        const amt = EXTRACTOR_INCOME * b.rateMult * boost * mult * dt;
        if (manual) b.stored = Math.min(STORE_CAP_GOLD, b.stored + amt);
        else p.gold += amt;
      } else if (b.kind === 'derrick') {
        const amt = DERRICK_INCOME * b.rateMult * boost * mult * dt;
        if (manual) b.stored = Math.min(STORE_CAP_OIL, b.stored + amt);
        else p.oil += amt;
      }
    }
  }

  private runWaves(): void {
    while (this.waveIdx < this.waves.length && this.waves[this.waveIdx].t <= this.time) {
      const w = this.waves[this.waveIdx++];
      if (w.building) {
        const b = this.placeBuilding(w.team, w.building, w.tile, {}, false, true);
        if (w.hp != null) {
          b.hp = w.hp;
          b.maxHp = w.hp;
        }
      } else if (w.unit) {
        const u = this.spawnUnit(w.team, w.unit, { x: w.tile.c, y: w.tile.r });
        if (w.hp != null) {
          u.hp = w.hp;
          u.maxHp = w.hp;
        }
      }
    }
  }

  private moveShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      const dx = s.target.x - s.pos.x, dy = s.target.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      const step = s.speed * dt;
      if (d <= step) {
        dealSplash(this, s.team, s.weapon, s.damage, s.target, s.radius, false);
        this.events.push({ t: 'shellLanded', pos: { ...s.target }, radius: s.radius });
        this.shells.splice(i, 1);
      } else {
        s.pos.x += (dx / d) * step;
        s.pos.y += (dy / d) * step;
      }
    }
  }

  private tickStrikes(dt: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const st = this.strikes[i];
      st.timer -= dt;
      if (st.timer <= 0) {
        // strikes are indiscriminate — friendly fire is on, placement skill matters
        dealSplash(this, st.team, 'artillery', st.damage, st.pos, st.radius, true);
        this.events.push({ t: 'strikeHit', pos: { ...st.pos }, nuke: st.nuke });
        this.strikes.splice(i, 1);
      }
    }
  }

  /** Soft collision: push overlapping units apart so blobs spread out readably. */
  private separation(): void {
    const minD = 0.48;
    // dispersal order: combat units of that team hold wide spacing (anti-splash);
    // trucks are exempt — docking needs tight tolerances
    const spreadD = 1.4;
    const spread = [this.players[0].order?.kind === 'spread', this.players[1].order?.kind === 'spread'];
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      for (let j = i + 1; j < this.units.length; j++) {
        const b = this.units[j];
        const wide =
          a.team === b.team && spread[a.team] && a.stance !== 'economic' && b.stance !== 'economic';
        const pairMin = wide ? spreadD : minD;
        let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        if (d >= pairMin || d === 0) continue;
        if (d < 1e-5) {
          dx = this.rng.range(-0.1, 0.1);
          dy = this.rng.range(-0.1, 0.1);
        }
        // wide spacing pushes gently — a posture, not an explosion
        const push = (pairMin - d) * (wide ? 0.18 : 0.5);
        const nx = (dx / (d || 0.1)) * push;
        const ny = (dy / (d || 0.1)) * push;
        this.tryNudge(a, -nx, -ny);
        this.tryNudge(b, nx, ny);
      }
    }
  }

  private tryNudge(u: Unit, dx: number, dy: number): void {
    const nx = u.pos.x + dx, ny = u.pos.y + dy;
    const c = Math.round(nx), r = Math.round(ny);
    if (!this.map.inBounds(c, r)) return;
    if (this.blocked[this.map.idx(c, r)]) return; // buildings block their whole tile
    // terrain blocks only its inset core: crowd pressure may squeeze a unit
    // along a bank or through the seam between two unwalkable tiles
    u.pos.x = nx;
    u.pos.y = ny;
    pushOutOfTerrain(this.map, u.pos);
  }

  private cleanupDeaths(): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.hp > 0) continue;
      this.events.push({ t: 'unitDied', id: u.id, kind: u.kind, team: u.team, pos: { ...u.pos } });
      this.units.splice(i, 1);
    }
    let hqDown: Building[] = [];
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const b = this.buildings[i];
      if (b.hp > 0) continue;
      this.blocked[this.map.idx(b.tile.c, b.tile.r)] = 0;
      // any truck en route to this building re-plans
      for (const u of this.units) {
        if (u.assignedNode === b.id) {
          u.assignedNode = 0;
          u.harvestState = 'idle';
        }
      }
      this.events.push({ t: 'buildingDestroyed', id: b.id, kind: b.kind, team: b.team, tile: { ...b.tile } });
      if (b.kind === 'hq') hqDown.push(b);
      this.buildings.splice(i, 1);
    }
    if (hqDown.length > 0 && !this.result) {
      let winner: TeamId;
      if (hqDown.length === 2) {
        // simultaneous destruction: whoever dealt more total damage takes it
        winner = this.players[0].damageDealt >= this.players[1].damageDealt ? 0 : 1;
      } else {
        winner = hqDown[0].team === 0 ? 1 : 0;
      }
      this.result = { winner };
      this.events.push({ t: 'matchEnd', winner });
    }
  }

  step(): void {
    if (this.result) return;
    const dt = TICK_DT;
    this.time += dt;
    this.tick++;

    for (const u of this.units) {
      u.prevPos.x = u.pos.x;
      u.prevPos.y = u.pos.y;
    }

    this.runWaves();
    this.allocatePower();
    this.income(dt);
    for (const p of this.players) {
      this.tickHand(p, dt);
      if (p.order && this.time >= p.order.until) p.order = null; // directive lapses
    }
    for (const u of this.units) if (u.hp > 0) tickUnit(this, u, dt);
    for (const b of this.buildings) if (b.hp > 0) tickBuilding(this, b, dt);
    this.moveShells(dt);
    this.tickStrikes(dt);
    this.separation();

    // endgame: no hard time limit — instead, long wars go nuclear
    if (this.rules.escalation && this.time >= NUKE_UNLOCK_T) this.dealNukes();

    this.cleanupDeaths();
  }

  /**
   * The nuclear option: once unlocked, each player periodically receives a
   * free Nuclear Strike card (never while already holding one). Whoever lands
   * one first ends the war — stalemates resolve by reflexes, not a timer.
   */
  private dealNukes(): void {
    for (const p of this.players) {
      if (p.hand.some((s) => s && s.card.id === 'nuke')) continue;
      if (this.time - this.lastNukeAt[p.team] < NUKE_REDEAL) continue;
      const slot = p.hand.findIndex((s) => s === null);
      if (slot === -1) continue; // hand jammed full — retry next tick
      const uid = this.nextId++;
      p.hand[slot] = { uid, card: { id: 'nuke', up: false }, ttl: CARD_TTL };
      this.lastNukeAt[p.team] = this.time;
      this.events.push({ t: 'cardDrawn', team: p.team, uid });
    }
  }

  /** Drain accumulated render/UI events. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  hqOf(team: TeamId): Building | null {
    return this.buildings.find((b) => b.kind === 'hq' && b.team === team) ?? null;
  }
}
