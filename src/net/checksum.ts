import type { Sim } from '../sim/sim';
import type { Building, PlayerState, Unit } from '../sim/types';

/**
 * Determinism verification for lockstep multiplayer.
 *
 * Two peers running the same deterministic Sim from the same seed, applying the
 * same commands at the same ticks, MUST hold byte-identical state forever. These
 * helpers turn a Sim into something comparable:
 *  - `simSnapshot` → a plain, fully-ordered object for deep-equality + diffing
 *    in tests (gives a readable failure when a desync is introduced).
 *  - `simHash` → a compact 32-bit fingerprint cheap enough to trade over the
 *    wire every couple of seconds so a live desync is caught the moment it happens.
 *
 * Both fold EVERY field that influences the sim's future evolution (positions,
 * hp, timers, rng state, ...). Pure-render state (the view) is irrelevant and
 * deliberately excluded.
 */

// ── fast 32-bit fingerprint ───────────────────────────────────────────────────

// FNV-1a over the exact IEEE-754 bits of every number, so two floats that differ
// in the last mantissa bit produce different hashes (a true desync, never masked).
const fnvBuf = new ArrayBuffer(8);
const fnvF64 = new Float64Array(fnvBuf);
const fnvU32 = new Uint32Array(fnvBuf);

class Hasher {
  private h = 0x811c9dc5;
  private fold(x: number): void {
    // 0x01000193 = FNV prime; Math.imul keeps the multiply in 32-bit space
    this.h = Math.imul(this.h ^ (x & 0xff), 0x01000193);
    this.h = Math.imul(this.h ^ ((x >>> 8) & 0xff), 0x01000193);
    this.h = Math.imul(this.h ^ ((x >>> 16) & 0xff), 0x01000193);
    this.h = Math.imul(this.h ^ ((x >>> 24) & 0xff), 0x01000193);
  }
  /** any finite number, hashed by its exact 64-bit representation */
  num(x: number): this {
    fnvF64[0] = x;
    this.fold(fnvU32[0]);
    this.fold(fnvU32[1]);
    return this;
  }
  int(x: number): this {
    this.fold(x | 0);
    return this;
  }
  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.fold(s.charCodeAt(i));
    this.fold(s.length);
    return this;
  }
  bool(b: boolean): this {
    this.fold(b ? 1 : 0);
    return this;
  }
  get value(): number {
    return this.h >>> 0;
  }
}

function hashUnit(h: Hasher, u: Unit): void {
  h.int(u.id).int(u.team).str(u.kind);
  h.num(u.pos.x).num(u.pos.y).num(u.facing);
  h.num(u.hp).num(u.maxHp).num(u.dmg).num(u.speed);
  h.int(u.targetId).str(u.harvestState).int(u.assignedNode).int(u.lastDock);
  h.num(u.cooldown).num(u.pathTimer).num(u.stateTimer).num(u.retargetTimer);
  h.int(u.path.length);
}

function hashBuilding(h: Hasher, b: Building): void {
  h.int(b.id).int(b.team).str(b.kind).int(b.tile.c).int(b.tile.r);
  h.num(b.hp).num(b.maxHp).num(b.stored).num(b.prodTimer).num(b.cooldown);
  h.num(b.boostTimer).num(b.boostMult).int(b.targetId).bool(b.powered);
}

function hashPlayer(h: Hasher, p: PlayerState): void {
  h.num(p.gold).num(p.oil).num(p.drawTimer).num(p.damageDealt);
  for (const u of [...p.upgrades].sort()) h.str(u);
  h.int(p.upgrades.size);
  for (const slot of p.hand) {
    if (!slot) { h.int(-1); continue; }
    h.int(slot.uid).str(slot.card.id).bool(slot.card.up).num(slot.ttl);
  }
  h.int(p.queue.length);
  for (const c of p.queue) h.str(c.id).bool(c.up);
  if (p.order) h.str(p.order.kind).num(p.order.until);
  else h.int(-1);
  for (const cat of ['building', 'unit', 'action'] as const) {
    for (const s of p.refreshSurge[cat]) h.num(s);
    h.int(p.refreshSurge[cat].length);
  }
}

/** Compact 32-bit fingerprint of the entire authoritative sim state. */
export function simHash(sim: Sim): number {
  const h = new Hasher();
  h.int(sim.tick).num(sim.time).int(sim.nextId).int(sim.rng.state);
  if (sim.result) h.int(sim.result.winner);
  else h.int(-1);
  hashPlayer(h, sim.players[0]);
  hashPlayer(h, sim.players[1]);
  // entity arrays are kept in a deterministic order by the sim, so no sort needed
  h.int(sim.units.length);
  for (const u of sim.units) hashUnit(h, u);
  h.int(sim.buildings.length);
  for (const b of sim.buildings) hashBuilding(h, b);
  h.int(sim.shells.length);
  for (const s of sim.shells) h.num(s.pos.x).num(s.pos.y).num(s.target.x).num(s.target.y).num(s.damage);
  h.int(sim.strikes.length);
  for (const st of sim.strikes) h.num(st.pos.x).num(st.pos.y).num(st.timer).num(st.damage);
  return h.value;
}

// ── full snapshot (tests / debugging) ─────────────────────────────────────────

/** A plain, deterministically-ordered copy of the sim state for deep comparison. */
export function simSnapshot(sim: Sim): unknown {
  return {
    tick: sim.tick,
    time: sim.time,
    nextId: sim.nextId,
    rng: sim.rng.state,
    result: sim.result ? sim.result.winner : null,
    players: sim.players.map((p) => ({
      gold: p.gold,
      oil: p.oil,
      drawTimer: p.drawTimer,
      damageDealt: p.damageDealt,
      upgrades: [...p.upgrades].sort(),
      hand: p.hand.map((s) => (s ? { uid: s.uid, id: s.card.id, up: s.card.up, ttl: s.ttl } : null)),
      queue: p.queue.map((c) => ({ id: c.id, up: c.up })),
      order: p.order ? { kind: p.order.kind, until: p.order.until } : null,
      refreshSurge: {
        building: [...p.refreshSurge.building],
        unit: [...p.refreshSurge.unit],
        action: [...p.refreshSurge.action]
      }
    })),
    units: sim.units.map((u) => ({
      id: u.id, team: u.team, kind: u.kind,
      x: u.pos.x, y: u.pos.y, facing: u.facing,
      hp: u.hp, maxHp: u.maxHp, dmg: u.dmg, speed: u.speed,
      targetId: u.targetId, harvestState: u.harvestState,
      assignedNode: u.assignedNode, lastDock: u.lastDock,
      cooldown: u.cooldown, pathTimer: u.pathTimer,
      stateTimer: u.stateTimer, pathLen: u.path.length
    })),
    buildings: sim.buildings.map((b) => ({
      id: b.id, team: b.team, kind: b.kind, c: b.tile.c, r: b.tile.r,
      hp: b.hp, maxHp: b.maxHp, stored: b.stored, prodTimer: b.prodTimer,
      cooldown: b.cooldown, boostTimer: b.boostTimer, boostMult: b.boostMult,
      targetId: b.targetId, powered: b.powered
    })),
    shells: sim.shells.map((s) => ({ x: s.pos.x, y: s.pos.y, tx: s.target.x, ty: s.target.y, dmg: s.damage })),
    strikes: sim.strikes.map((st) => ({ x: st.pos.x, y: st.pos.y, timer: st.timer, dmg: st.damage }))
  };
}
