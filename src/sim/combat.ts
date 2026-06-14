import type { Sim } from './sim';
import type { Building, Unit, WeaponKind } from './types';
import { dist, tileOf } from './types';
import { hasLineOfSight } from './path';
import { DAMAGE_MATRIX, DAMAGE_VARIANCE, FOREST_COVER, SMOKE_COVER, UNIT_STATS, UPGRADE_EFFECTS } from './stats';

export type Combatant = Unit | Building;

export function isUnit(e: Combatant): e is Unit {
  return (e as Unit).pos !== undefined;
}

export function entityPos(e: Combatant): { x: number; y: number } {
  return isUnit(e) ? e.pos : { x: e.tile.c, y: e.tile.r };
}

export function entityArmor(e: Combatant): 'infantry' | 'armor' | 'light' | 'building' {
  return isUnit(e) ? UNIT_STATS[e.kind].armor : 'building';
}

/** Full damage pipeline: matrix multiplier, roll variance, upgrades, forest cover. */
export function dealDamage(sim: Sim, attackerTeam: 0 | 1, weapon: WeaponKind, base: number, target: Combatant): void {
  if (weapon === 'none' || target.hp <= 0) return;
  const armor = entityArmor(target);
  let dmg = base * DAMAGE_MATRIX[weapon][armor];

  // every hit rolls within a band — no two shots land identically
  dmg *= sim.rng.range(1 - DAMAGE_VARIANCE, 1 + DAMAGE_VARIANCE);

  const atkPlayer = sim.players[attackerTeam];
  const defPlayer = sim.players[target.team];

  if (weapon === 'cannon' && armor === 'armor' && atkPlayer.upgrades.has('sabot')) dmg *= UPGRADE_EFFECTS.sabot;
  if (weapon === 'smallarms' && armor === 'armor' && atkPlayer.upgrades.has('apammo')) dmg *= UPGRADE_EFFECTS.apammo;
  if (weapon === 'at' && armor === 'armor' && defPlayer.upgrades.has('reactive')) dmg *= UPGRADE_EFFECTS.reactive;

  // forest cover protects infantry only — a tank in the woods is still a big target
  if (isUnit(target) && armor === 'infantry') {
    const tile = tileOf(target.pos);
    if (sim.map.inBounds(tile.c, tile.r) && sim.map.terrainAt(tile.c, tile.r) === 'forest') {
      const cover = defPlayer.upgrades.has('smoke') ? SMOKE_COVER : FOREST_COVER;
      dmg *= 1 - cover;
    }
  }

  target.hp -= dmg;
  atkPlayer.damageDealt += dmg;

  // a building under enemy fire sounds the base alarm — defensive units respond
  if (!isUnit(target) && attackerTeam !== target.team) {
    sim.baseAlarm[target.team] = { pos: { x: target.tile.c, y: target.tile.r }, time: sim.time };
  }
}

/** Splash damage around a point (artillery shells, tank HE, airstrikes). */
export function dealSplash(
  sim: Sim,
  attackerTeam: 0 | 1,
  weapon: WeaponKind,
  base: number,
  at: { x: number; y: number },
  radius: number,
  friendlyFire: boolean,
  vsBuildingMult = 1
): void {
  for (const u of sim.units) {
    if (u.hp <= 0) continue;
    if (!friendlyFire && u.team === attackerTeam) continue;
    const d = dist(u.pos, at);
    if (d <= radius) {
      const falloff = 1 - 0.5 * (d / radius);
      dealDamage(sim, attackerTeam, weapon, base * falloff, u);
    }
  }
  for (const b of sim.buildings) {
    if (b.hp <= 0) continue;
    if (!friendlyFire && b.team === attackerTeam) continue;
    const d = dist({ x: b.tile.c, y: b.tile.r }, at);
    if (d <= radius) {
      const falloff = 1 - 0.5 * (d / radius);
      dealDamage(sim, attackerTeam, weapon, base * falloff * vsBuildingMult, b);
    }
  }
}

export interface TargetQuery {
  team: 0 | 1; // the attacker's team
  pos: { x: number; y: number };
  range: number; // acquisition range
  minRange?: number;
  preferArmor?: boolean;
  preferEconomy?: boolean;
  preferBuildings?: boolean;
  needLos?: boolean;
}

/** Pick the best enemy target. Lower score wins. */
export function acquireTarget(sim: Sim, q: TargetQuery): Combatant | null {
  let best: Combatant | null = null;
  let bestScore = Infinity;
  const fromTile = { c: Math.round(q.pos.x), r: Math.round(q.pos.y) };

  const consider = (e: Combatant) => {
    if (e.team === q.team || e.hp <= 0) return;
    const p = entityPos(e);
    const d = dist(q.pos, p);
    if (d > q.range) return;
    if (q.minRange && d < q.minRange) return;
    if (q.needLos !== false) {
      if (!hasLineOfSight(sim.map, fromTile, { c: Math.round(p.x), r: Math.round(p.y) })) return;
    }
    let score = d;
    const armor = entityArmor(e);
    if (q.preferArmor && armor === 'armor') score -= 100;
    if (q.preferEconomy) {
      if (isUnit(e) && e.kind === 'harvester') score -= 200;
      else if (!isUnit(e) && (e.kind === 'extractor' || e.kind === 'derrick')) score -= 100;
    }
    if (q.preferBuildings && !isUnit(e)) score -= 100;
    // harvesters are low-priority targets for normal combat units
    if (!q.preferEconomy && isUnit(e) && e.kind === 'harvester') score += 50;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  };

  for (const u of sim.units) consider(u);
  for (const b of sim.buildings) consider(b);
  return best;
}

export function findEntity(sim: Sim, id: number): Combatant | null {
  if (id === 0) return null;
  for (const u of sim.units) if (u.id === id && u.hp > 0) return u;
  for (const b of sim.buildings) if (b.id === id && b.hp > 0) return b;
  return null;
}
