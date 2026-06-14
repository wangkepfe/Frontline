import * as THREE from 'three';

/**
 * Animation core (ART_DIRECTION.md §5).
 * Bones are pivots at mechanical joints. Every frame: reset to rest pose, then
 * layer drivers — poses never accumulate drift. Action envelopes are explicit
 * keyframe tables where every key is load-bearing.
 */

// ── easing ──────────────────────────────────────────────────────────────────

export type Ease = (k: number) => number;
export const lin: Ease = (k) => k;
export const inQ: Ease = (k) => k * k;
export const outQ: Ease = (k) => k * (2 - k);
export const outC: Ease = (k) => 1 - Math.pow(1 - k, 3);
export const inOutQ: Ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
/** sharp mechanical snap then settle — recoils, slams */
export const snap: Ease = (k) => 1 - Math.pow(1 - k, 5);
/** slight overshoot — latches, drops into place */
export const outBack: Ease = (k) => {
  const s = 1.4;
  return 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
};

// ── keyframe envelope ───────────────────────────────────────────────────────

/** [time, value, easeIntoThisKey?] */
export type Key = [number, number, Ease?];

/**
 * Sample a keyframe table at time t (seconds). Clamps at both ends.
 * Example — cannon recoil, two keys, both essential:
 *   env(sinceShot, [[0, 0], [0.05, 1, snap], [0.45, 0, outC]])
 */
export function env(t: number, keys: Key[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [tb, vb, e] = keys[i];
    if (t <= tb) {
      const [ta, va] = keys[i - 1];
      const k = (t - ta) / (tb - ta);
      return va + (vb - va) * (e ?? lin)(k);
    }
  }
  return keys[keys.length - 1][1];
}

/** Shortest-arc yaw approach with rate limit (rad/s). */
export function turnTo(current: number, target: number, maxStep: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-maxStep, Math.min(maxStep, d));
  return current + step;
}

// ── rig ─────────────────────────────────────────────────────────────────────

interface Rest {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  s: THREE.Vector3;
}

export class Rig {
  readonly root = new THREE.Group();
  private bones = new Map<string, THREE.Object3D>();
  private rest = new Map<THREE.Object3D, Rest>();

  /** Create a named pivot at a joint position. */
  pivot(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
    const b = new THREE.Group();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    this.bones.set(name, b);
    return b;
  }

  b(name: string): THREE.Object3D {
    const b = this.bones.get(name);
    if (!b) throw new Error(`rig: unknown bone '${name}'`);
    return b;
  }

  has(name: string): boolean {
    return this.bones.has(name);
  }

  /** Call once after building — records the rest pose of every bone. */
  capture(): void {
    for (const [, b] of this.bones) {
      this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
    }
  }

  /** Start of every frame: all bones back to rest, then drivers layer on top. */
  reset(): void {
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
  }
}

// ── pose contracts (what the sim tells the art) ─────────────────────────────

export interface UnitPose {
  dt: number;
  time: number;
  /** actual tiles/s this frame — drives locomotion, zero = miniature stillness */
  speed: number;
  /** accel since last frame (tiles/s²) — mass lurch */
  accel: number;
  /** world yaw the unit body is rendered at (already applied to root) */
  bodyYaw: number;
  /** world yaw toward current target, or null when no target */
  aimYaw: number | null;
  /** seconds since this entity last fired (Infinity = never) */
  sinceShot: number;
  /** 0..1 — squads hide casualties, vehicles can smoke later */
  hpFrac: number;
  /** harvester: ore fraction 0..1; others 0 */
  load: number;
  /** harvester: actively loading/unloading */
  working: boolean;
  /** harvester work mode (drives auger vs tipping bed) */
  harvest?: 'loading' | 'unloading' | null;
}

export interface BuildingPose {
  dt: number;
  time: number;
  /** actively producing a unit (drives industry motion) */
  producing: boolean;
  /** income/production rate multiplier (boosted extractors run faster) */
  rate: number;
  /** world yaw toward current target, or null */
  aimYaw: number | null;
  sinceShot: number;
  /** root world yaw (turret bones counter-rotate against it) */
  bodyYaw: number;
}

export interface UnitRigHandle {
  root: THREE.Group;
  update(p: UnitPose): void;
}

export interface BuildingRigHandle {
  root: THREE.Group;
  update(p: BuildingPose): void;
}

export const STILL: Pick<UnitPose, 'speed' | 'accel' | 'aimYaw' | 'sinceShot' | 'hpFrac' | 'load' | 'working'> = {
  speed: 0,
  accel: 0,
  aimYaw: null,
  sinceShot: Infinity,
  hpFrac: 1,
  load: 0,
  working: false
};
