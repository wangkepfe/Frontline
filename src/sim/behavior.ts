import type { Sim } from './sim';
import { Building, Unit, Vec2, dist, tileOf, posOfTile } from './types';
import { TilePos, chebyshev, pushOutOfTerrain, tileKey } from './map';
import { findPath, hasLineOfSight } from './path';
import { ALARM_HOLD, BUILDING_STATS, HARVESTER_TUCK, SHELL_SPEED, UNIT_STATS, UPGRADE_EFFECTS, UnitStats } from './stats';
import { Combatant, acquireTarget, dealDamage, dealSplash, entityPos, findEntity, isUnit } from './combat';

/**
 * Autonomous behavior scripts. The player never commands units directly —
 * stance + placement decide everything that happens here.
 */

function effRange(sim: Sim, u: Unit): number {
  const st = UNIT_STATS[u.kind];
  let r = st.range;
  if (u.kind === 'howitzer' && sim.players[u.team].upgrades.has('barrels')) r += UPGRADE_EFFECTS.barrels;
  return r;
}

function moveAlongPath(sim: Sim, u: Unit, dt: number): void {
  if (u.path.length === 0) return;
  const next = u.path[0];
  const tx = next.c, ty = next.r;
  const dx = tx - u.pos.x, dy = ty - u.pos.y;
  const d = Math.hypot(dx, dy);
  const here = tileOf(u.pos);
  // a position can legitimately round onto an unwalkable tile while skimming
  // its outer band (corner cuts, bank seams) — that's full speed, never the
  // tile's Infinity moveCost, which used to freeze the unit at the corner
  const hereProps = sim.map.inBounds(here.c, here.r) ? sim.map.props(here.c, here.r) : null;
  const cost = hereProps && hereProps.walkable ? hereProps.moveCost : 1;
  const speed = u.speed / cost;
  if (d < 0.12) {
    u.path.shift();
    return;
  }
  const step = Math.min(speed * dt, d);
  u.pos.x += (dx / d) * step;
  u.pos.y += (dy / d) * step;
  pushOutOfTerrain(sim.map, u.pos);
  u.facing = Math.atan2(dy, dx);
}

/**
 * A* start tile for a unit. Normally its rounded tile — but a position can
 * legitimately rest in the outer band of an unwalkable tile (bank skim, the
 * seam lane between two waters). Starting A* there would put the first
 * waypoint on the far side of the blocking core and the unit would press
 * uselessly against it; start from the nearest walkable neighbor instead.
 */
function pathStart(sim: Sim, u: Unit): TilePos {
  const t = tileOf(u.pos);
  if (sim.map.inBounds(t.c, t.r) && sim.map.props(t.c, t.r).walkable) return t;
  return nearestWalkableNeighbor(sim, t, u.pos) ?? t;
}

/**
 * A unit whose goal is truly unreachable mills around nearby instead of
 * freezing in place — it keeps looking alive and re-tries the real goal on the
 * normal repath timer (the world changes: buildings fall, lanes open).
 */
function wanderPath(sim: Sim, u: Unit): TilePos[] {
  const cur = pathStart(sim, u);
  for (let tries = 0; tries < 8; tries++) {
    const ang = sim.rng.range(0, Math.PI * 2);
    const rad = sim.rng.range(1, 2.6);
    const c = Math.round(u.pos.x + Math.cos(ang) * rad);
    const r = Math.round(u.pos.y + Math.sin(ang) * rad);
    if (!sim.map.inBounds(c, r) || !sim.map.props(c, r).walkable || sim.blocked[sim.map.idx(c, r)]) continue;
    if (c === cur.c && r === cur.r) continue;
    const path = findPath(sim.map, sim.blocked, cur, { c, r });
    if (path && path.length <= 6) return path;
  }
  return [];
}

/** Ensure the unit has a path toward the goal tile; repaths on a timer or when the goal changed. */
function steerTo(sim: Sim, u: Unit, goal: TilePos): void {
  const last = u.path.length > 0 ? u.path[u.path.length - 1] : null;
  // a wander path never ends at the goal — let it play out instead of re-rolling every tick
  const stale = !last || (!u.wandering && chebyshev(last, goal) > 1) || u.pathTimer <= 0;
  if (!stale) return;
  const from = pathStart(sim, u);
  // attackers take personal, slightly off-optimal routes (stable per unit) so a
  // push spreads across the map instead of single-filing down one lane;
  // harvesters and base guards keep clean shortest paths
  const jitter = u.stance === 'aggressive' || u.stance === 'raider' ? u.id : undefined;
  const path = findPath(sim.map, sim.blocked, from, goal, jitter);
  if (path) {
    u.path = path;
    u.wandering = false;
  } else {
    u.path = wanderPath(sim, u);
    u.wandering = u.path.length > 0;
  }
  u.pathTimer = 1.8 + sim.rng.next() * 0.6;
}

/**
 * Drive to ANY free tile adjacent to a building (whichever is closest and
 * actually reachable), never the `avoidKey` tile — that's where the harvester
 * last docked, so the convoy always physically moves between mine and HQ.
 * On the door tile the truck pulls in tight against the structure
 * (HARVESTER_DOCK_RANGE) before docking counts — no parking a full tile out.
 * Returns true once the unit is tucked in.
 */
function approachBuilding(sim: Sim, u: Unit, tile: TilePos, avoidKey: number, dt: number): boolean {
  const cur = tileOf(u.pos);
  const curKey = tileKey(cur.c, cur.r);
  // exactly 1: standing ON the building tile (diagonal segments can round onto
  // it mid-drive) must fall through to pathing, not dock at the mesh's center.
  // A blocked ring tile (another building's footprint) is no door either.
  if (chebyshev(cur, tile) === 1 && curKey !== avoidKey && !sim.blocked[sim.map.idx(cur.c, cur.r)]) {
    u.path = [];
    // tuck in against the structure, but stay inside THIS door tile's rounding
    // region — the rounded tile is what avoid/lastDock bookkeeping reads, and
    // an unbounded pull lets an adjacent mine/HQ pair insta-dock both ways
    // from one overlap spot (the convoy would stop driving)
    const tx = cur.c + Math.max(-HARVESTER_TUCK, Math.min(HARVESTER_TUCK, tile.c - cur.c));
    const ty = cur.r + Math.max(-HARVESTER_TUCK, Math.min(HARVESTER_TUCK, tile.r - cur.r));
    const dx = tx - u.pos.x, dy = ty - u.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.08) {
      const step = Math.min(u.speed * dt, d);
      u.pos.x += (dx / d) * step;
      u.pos.y += (dy / d) * step;
      u.facing = Math.atan2(tile.r - u.pos.y, tile.c - u.pos.x);
      return false;
    }
    return true;
  }
  const last = u.path.length > 0 ? u.path[u.path.length - 1] : null;
  const stale = !last || chebyshev(last, tile) > 1 || tileKey(last.c, last.r) === avoidKey || u.pathTimer <= 0;
  if (stale) {
    const cands: TilePos[] = [];
    const fallback: TilePos[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const c = tile.c + dc, r = tile.r + dr;
        if (!sim.map.inBounds(c, r)) continue;
        if (!sim.map.props(c, r).walkable) continue;
        if (sim.blocked[sim.map.idx(c, r)]) continue;
        (tileKey(c, r) === avoidKey ? fallback : cands).push({ c, r });
      }
    }
    // walled-in corner case: the avoided tile is the only door — use it
    const pool = cands.length > 0 ? cands : fallback;
    if (cands.length === 0 && fallback.length > 0 && chebyshev(cur, tile) <= 1) {
      u.path = [];
      return true;
    }
    pool.sort((a, b) => Math.hypot(a.c - u.pos.x, a.r - u.pos.y) - Math.hypot(b.c - u.pos.x, b.r - u.pos.y));
    u.path = [];
    const from = pathStart(sim, u);
    for (const cand of pool) {
      const path = findPath(sim.map, sim.blocked, from, cand);
      if (path) {
        u.path = path;
        break;
      }
    }
    u.pathTimer = 1.8 + sim.rng.next() * 0.6;
  }
  return false;
}

export function nearestWalkableNeighbor(sim: Sim, t: TilePos, from: Vec2, exclude?: TilePos | null): TilePos | null {
  let best: TilePos | null = null;
  let bestD = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const c = t.c + dc, r = t.r + dr;
      if (!sim.map.inBounds(c, r)) continue;
      if (!sim.map.props(c, r).walkable) continue;
      if (sim.blocked[sim.map.idx(c, r)]) continue;
      if (exclude && exclude.c === c && exclude.r === r) continue;
      const d = Math.hypot(c - from.x, r - from.y);
      if (d < bestD) {
        bestD = d;
        best = { c, r };
      }
    }
  }
  return best;
}

function tryFire(sim: Sim, u: Unit, target: Combatant): void {
  const st = UNIT_STATS[u.kind];
  if (u.cooldown > 0) return;
  const tp = entityPos(target);
  const d = dist(u.pos, tp);
  const range = effRange(sim, u);
  if (d > range + 0.05 || d < st.minRange) return;
  if (!hasLineOfSight(sim.map, tileOf(u.pos), { c: Math.round(tp.x), r: Math.round(tp.y) })) return;

  u.cooldown = st.cooldown;
  u.facing = Math.atan2(tp.y - u.pos.y, tp.x - u.pos.x);
  sim.events.push({ t: 'shot', from: { ...u.pos }, to: { x: tp.x, y: tp.y }, weapon: st.weapon, team: u.team, sourceId: u.id });

  if (u.kind === 'howitzer') {
    sim.shells.push({
      id: sim.nextId++,
      team: u.team,
      pos: { ...u.pos },
      target: { x: tp.x, y: tp.y },
      speed: SHELL_SPEED,
      damage: u.dmg,
      radius: st.splash,
      weapon: st.weapon
    });
    return;
  }

  if (st.splash > 0) {
    dealSplash(sim, u.team, st.weapon, u.dmg, tp, st.splash, false, u.vsBuildingMult);
  } else {
    const base = isUnit(target) ? u.dmg : u.dmg * u.vsBuildingMult;
    dealDamage(sim, u.team, st.weapon, base, target);
  }
  sim.events.push({ t: 'impact', pos: { x: tp.x, y: tp.y }, weapon: st.weapon });
}

/** Keep / acquire target with per-kind preferences. */
function updateTarget(sim: Sim, u: Unit, opts: { preferArmor?: boolean; preferEconomy?: boolean; preferBuildings?: boolean; minRange?: number }): Combatant | null {
  const st = UNIT_STATS[u.kind];
  const existing = findEntity(sim, u.targetId);
  if (existing) {
    const d = dist(u.pos, entityPos(existing));
    if (d <= st.sight + 1.5 && (!opts.minRange || d >= opts.minRange - 0.5)) return existing;
  }
  if (u.retargetTimer > 0) {
    return existing;
  }
  u.retargetTimer = 0.3;
  const t = acquireTarget(sim, {
    team: u.team,
    pos: u.pos,
    range: st.sight,
    minRange: opts.minRange,
    preferArmor: opts.preferArmor,
    preferEconomy: opts.preferEconomy,
    preferBuildings: opts.preferBuildings
  });
  u.targetId = t ? t.id : 0;
  return t;
}

function aggressive(sim: Sim, u: Unit, dt: number): void {
  const target = updateTarget(sim, u, { preferArmor: u.kind === 'rocket' });
  if (target) {
    const tp = entityPos(target);
    const d = dist(u.pos, tp);
    const range = effRange(sim, u);
    if (d <= range && hasLineOfSight(sim.map, tileOf(u.pos), { c: Math.round(tp.x), r: Math.round(tp.y) })) {
      u.path = [];
      u.facing = Math.atan2(tp.y - u.pos.y, tp.x - u.pos.x);
      tryFire(sim, u, target);
      return;
    }
    steerTo(sim, u, { c: Math.round(tp.x), r: Math.round(tp.y) });
    moveAlongPath(sim, u, dt);
    tryFire(sim, u, target);
    return;
  }
  // no target: push toward the enemy HQ
  const enemyHq = sim.map.hq[u.team === 0 ? 1 : 0];
  steerTo(sim, u, enemyHq);
  moveAlongPath(sim, u, dt);
}

function defensive(sim: Sim, u: Unit, dt: number, hold?: { anchor: Vec2; leash: number }): void {
  const st = UNIT_STATS[u.kind];
  // base alarm: while any friendly building is under fire, every defensive
  // unit re-anchors on it — the guard force converges, fights, and walks
  // home once the alarm cools down
  const alarm = sim.baseAlarm[u.team];
  const responding = alarm !== null && sim.time - alarm.time < ALARM_HOLD;
  const anchor = responding ? alarm.pos : (hold?.anchor ?? u.anchor ?? u.pos);
  const leash = hold?.leash ?? st.guardRadius;
  const target = updateTarget(sim, u, {
    preferArmor: u.kind === 'rocket',
    preferBuildings: u.kind === 'howitzer',
    minRange: st.minRange
  });

  if (target) {
    const tp = entityPos(target);
    const d = dist(u.pos, tp);
    const range = effRange(sim, u);
    const inLeash = dist(u.pos, anchor) <= leash;
    if (d <= range && d >= st.minRange && hasLineOfSight(sim.map, tileOf(u.pos), { c: Math.round(tp.x), r: Math.round(tp.y) })) {
      u.path = [];
      tryFire(sim, u, target);
      return;
    }
    // only creep toward the target while staying leashed to the anchor
    if (inLeash && d > range) {
      const towards = { c: Math.round(tp.x), r: Math.round(tp.y) };
      steerTo(sim, u, towards);
      // trim path so we never leave the leash
      if (u.path.length > 0) {
        const next = u.path[0];
        if (Math.hypot(next.c - anchor.x, next.r - anchor.y) > leash) {
          u.path = [];
          u.targetId = 0;
          return;
        }
      }
      moveAlongPath(sim, u, dt);
      return;
    }
    if (!inLeash) u.targetId = 0;
  }
  // strayed beyond the leash: come home first
  if (dist(u.pos, anchor) > leash + 0.5) {
    steerTo(sim, u, { c: Math.round(anchor.x), r: Math.round(anchor.y) });
    moveAlongPath(sim, u, dt);
    return;
  }
  // on post: patrol — amble to a random nearby spot, pause, repeat. Guards stay
  // alive-looking without ever wandering past their leash.
  u.stateTimer -= dt;
  if (u.path.length === 0 && u.stateTimer <= 0) {
    u.stateTimer = sim.rng.range(2.0, 5.0);
    for (let tries = 0; tries < 8; tries++) {
      const ang = sim.rng.range(0, Math.PI * 2);
      const rad = sim.rng.range(0.8, Math.max(1.2, leash));
      const c = Math.round(anchor.x + Math.cos(ang) * rad);
      const r = Math.round(anchor.y + Math.sin(ang) * rad);
      if (!sim.map.inBounds(c, r) || !sim.map.props(c, r).walkable || sim.blocked[sim.map.idx(c, r)]) continue;
      const path = findPath(sim.map, sim.blocked, pathStart(sim, u), { c, r });
      // reject pathological detours (e.g. around a mountain) that leave the post
      if (path && path.length <= leash * 2 + 2) {
        u.path = path;
        break;
      }
    }
  }
  moveAlongPath(sim, u, dt);
}

/**
 * Directed raid (order cards): hunt a specific class of enemy building. Fights
 * whatever crosses its path, but the march goal is the nearest target kind;
 * with none left it falls through to the general advance.
 */
function directed(sim: Sim, u: Unit, dt: number, kinds: ReadonlyArray<Building['kind']>): void {
  const target = updateTarget(sim, u, { preferBuildings: true });
  if (target) {
    const tp = entityPos(target);
    const d = dist(u.pos, tp);
    const range = effRange(sim, u);
    if (d <= range && hasLineOfSight(sim.map, tileOf(u.pos), { c: Math.round(tp.x), r: Math.round(tp.y) })) {
      u.path = [];
      u.facing = Math.atan2(tp.y - u.pos.y, tp.x - u.pos.x);
      tryFire(sim, u, target);
      return;
    }
    steerTo(sim, u, { c: Math.round(tp.x), r: Math.round(tp.y) });
    moveAlongPath(sim, u, dt);
    tryFire(sim, u, target);
    return;
  }
  let goal: TilePos | null = null;
  let bestD = Infinity;
  for (const b of sim.buildings) {
    if (b.team === u.team || b.hp <= 0) continue;
    if (!kinds.includes(b.kind)) continue;
    const d = Math.hypot(b.tile.c - u.pos.x, b.tile.r - u.pos.y);
    if (d < bestD) {
      bestD = d;
      goal = b.tile;
    }
  }
  if (!goal) goal = sim.map.hq[u.team === 0 ? 1 : 0];
  steerTo(sim, u, goal);
  moveAlongPath(sim, u, dt);
}

function raider(sim: Sim, u: Unit, dt: number): void {
  const target = updateTarget(sim, u, { preferEconomy: true });
  if (target) {
    const tp = entityPos(target);
    const d = dist(u.pos, tp);
    const range = effRange(sim, u);
    if (d <= range && hasLineOfSight(sim.map, tileOf(u.pos), { c: Math.round(tp.x), r: Math.round(tp.y) })) {
      u.path = [];
      u.facing = Math.atan2(tp.y - u.pos.y, tp.x - u.pos.x);
      tryFire(sim, u, target);
      return;
    }
    steerTo(sim, u, { c: Math.round(tp.x), r: Math.round(tp.y) });
    moveAlongPath(sim, u, dt);
    tryFire(sim, u, target);
    return;
  }
  // hunt enemy economy: nearest enemy extractor/derrick, else their HQ
  let goal: TilePos | null = null;
  let bestD = Infinity;
  for (const b of sim.buildings) {
    if (b.team === u.team || b.hp <= 0) continue;
    if (b.kind !== 'extractor' && b.kind !== 'derrick') continue;
    const d = Math.hypot(b.tile.c - u.pos.x, b.tile.r - u.pos.y);
    if (d < bestD) {
      bestD = d;
      goal = b.tile;
    }
  }
  if (!goal) goal = sim.map.hq[u.team === 0 ? 1 : 0];
  steerTo(sim, u, goal);
  moveAlongPath(sim, u, dt);
}

function economic(sim: Sim, u: Unit, dt: number): void {
  // flee from nearby armed enemies
  let threat: Unit | null = null;
  for (const e of sim.units) {
    if (e.team === u.team || e.hp <= 0 || UNIT_STATS[e.kind].weapon === 'none') continue;
    const d = dist(u.pos, e.pos);
    if (d < 2.5 && (!threat || d < dist(u.pos, threat.pos))) threat = e;
  }
  const hq = sim.map.hq[u.team];
  if (threat) {
    u.harvestState = 'fleeing';
    steerTo(sim, u, hq);
    moveAlongPath(sim, u, dt);
    return;
  }
  if (u.harvestState === 'fleeing') u.harvestState = u.assignedNode ? 'toNode' : 'idle';

  const node = u.assignedNode ? (findEntity(sim, u.assignedNode) as Building | null) : null;
  if (u.assignedNode && !node) {
    u.assignedNode = 0;
    u.harvestState = 'idle';
  }

  switch (u.harvestState) {
    case 'idle': {
      u.stateTimer -= dt;
      if (u.stateTimer <= 0) {
        u.stateTimer = 1;
        // pick the friendly mine/derrick most in need of a service call:
        // lapsed boost first, fullest silo next, nearest last — skipping
        // nodes another truck has already claimed
        const claimed = new Set<number>();
        for (const v of sim.units) {
          if (v.id !== u.id && v.team === u.team && v.kind === 'harvester' && v.hp > 0 && v.assignedNode) {
            claimed.add(v.assignedNode);
          }
        }
        let best: Building | null = null;
        let bestScore = -Infinity;
        for (const b of sim.buildings) {
          if (b.team !== u.team || b.hp <= 0) continue;
          if (b.kind !== 'extractor' && b.kind !== 'derrick') continue;
          if (claimed.has(b.id)) continue;
          const d = Math.hypot(b.tile.c - u.pos.x, b.tile.r - u.pos.y);
          const score = (b.boostTimer <= 0 ? 100 : 0) + b.stored - d * 2;
          if (score > bestScore) {
            bestScore = score;
            best = b;
          }
        }
        if (best) {
          u.assignedNode = best.id;
          u.harvestState = 'toNode';
        }
      }
      break;
    }
    case 'toNode': {
      if (!node) break;
      // dock at WHICHEVER free side of the mine is closest — never the tile we
      // just unloaded on, so the convoy still visibly drives every leg
      if (approachBuilding(sim, u, node.tile, u.lastDock, dt)) {
        sim.serviceBuilding(u, node); // bank the silo + start the boost on contact
        u.harvestState = 'loading';
        u.stateTimer = 1.2;
      } else {
        moveAlongPath(sim, u, dt);
      }
      break;
    }
    case 'loading': {
      u.stateTimer -= dt;
      if (u.stateTimer <= 0) {
        const t = tileOf(u.pos); // the tuck stays inside the door tile, so this IS the door
        u.lastDock = tileKey(t.c, t.r);
        u.harvestState = 'toHq';
      }
      break;
    }
    case 'toHq': {
      if (approachBuilding(sim, u, hq, u.lastDock, dt)) {
        u.harvestState = 'unloading';
        u.stateTimer = 0.8;
      } else {
        moveAlongPath(sim, u, dt);
      }
      break;
    }
    case 'unloading': {
      u.stateTimer -= dt;
      if (u.stateTimer <= 0) {
        const t = tileOf(u.pos);
        u.lastDock = tileKey(t.c, t.r);
        // round trip done — release the claim and pick the next neediest node
        u.assignedNode = 0;
        u.harvestState = 'idle';
        u.stateTimer = 0;
      }
      break;
    }
  }
}

export function tickUnit(sim: Sim, u: Unit, dt: number): void {
  u.cooldown = Math.max(0, u.cooldown - dt);
  u.pathTimer -= dt;
  u.retargetTimer -= dt;

  // standing orders override every combat unit's own stance while they run;
  // trucks keep working, and 'spread' only changes spacing (sim.separation)
  const order = sim.players[u.team].order;
  if (order && u.stance !== 'economic' && UNIT_STATS[u.kind].weapon !== 'none') {
    switch (order.kind) {
      case 'defend': {
        const hq = sim.map.hq[u.team];
        defensive(sim, u, dt, { anchor: { x: hq.c, y: hq.r }, leash: 4 });
        return;
      }
      case 'attack':
        aggressive(sim, u, dt);
        return;
      case 'hitPower':
        directed(sim, u, dt, ['powerplant']);
        return;
      case 'hitEconomy':
        directed(sim, u, dt, ['extractor', 'derrick']);
        return;
      case 'spread':
        break; // spacing handled in sim.separation; behavior unchanged
    }
  }

  switch (u.stance) {
    case 'aggressive': aggressive(sim, u, dt); break;
    case 'defensive': defensive(sim, u, dt); break;
    case 'raider': raider(sim, u, dt); break;
    case 'economic': economic(sim, u, dt); break;
  }
}

export function tickBuilding(sim: Sim, b: Building, dt: number): void {
  const st = BUILDING_STATS[b.kind];

  if (!b.powered) return; // dark buildings train nothing and fire nothing

  // autonomous production: spawn toward the front (nearest tile to enemy HQ)
  if (b.prodUnit) {
    b.prodTimer -= dt;
    if (b.prodTimer <= 0) {
      const enemyHq = sim.map.hq[b.team === 0 ? 1 : 0];
      const spot = nearestWalkableNeighbor(sim, b.tile, { x: enemyHq.c, y: enemyHq.r });
      if (spot) {
        sim.spawnUnit(b.team, b.prodUnit, { x: spot.c, y: spot.r });
        b.prodTimer = b.prodInterval;
      } else {
        b.prodTimer = 1; // exits blocked, retry shortly
      }
    }
  }

  // static defenses (the HQ's own gun can be ruled off in early tutorials)
  if (st.weapon !== 'none' && (b.kind !== 'hq' || sim.rules.hqGun)) {
    b.cooldown = Math.max(0, b.cooldown - dt);
    const existing = findEntity(sim, b.targetId);
    const bp = { x: b.tile.c, y: b.tile.r };
    let target = existing;
    if (!target || dist(bp, entityPos(target)) > st.range) {
      target = acquireTarget(sim, {
        team: b.team,
        pos: bp,
        range: st.range,
        preferArmor: b.kind === 'atturret'
      });
      b.targetId = target ? target.id : 0;
    }
    if (target && b.cooldown <= 0) {
      const tp = entityPos(target);
      if (dist(bp, tp) <= st.range && hasLineOfSight(sim.map, b.tile, { c: Math.round(tp.x), r: Math.round(tp.y) })) {
        b.cooldown = st.cooldown;
        dealDamage(sim, b.team, st.weapon, b.dmg, target);
        sim.events.push({ t: 'shot', from: bp, to: { x: tp.x, y: tp.y }, weapon: st.weapon, team: b.team, sourceId: b.id });
        sim.events.push({ t: 'impact', pos: { x: tp.x, y: tp.y }, weapon: st.weapon });
      }
    }
  }
}
