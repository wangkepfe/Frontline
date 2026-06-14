import * as THREE from 'three';
import type { TeamId } from '../../sim/types';
import { C, pm, teamRamp } from './palette';
import { cbox, hull, lathe, put, hash } from './kit';
import { env, outC, snap, turnTo, UnitPose, UnitRigHandle } from './rig';

/**
 * Infantry miniatures. Heroic ~2.8-heads proportions, oversized helmets,
 * chunky weapons (silhouette = "squad" / "tube"). Locomotion is distance-driven
 * (zero foot slide); stationary soldiers hold a miniature's stillness and track
 * their target with the whole body; fire = one sharp kick envelope per shot,
 * rippled through the squad.
 */

// ── shared soldier parts ────────────────────────────────────────────────────

const FATIGUE = () => pm(C.olive.base);
const VEST = () => pm(C.olive.shade);
const HELMET = () => pm(C.olive.shade);
const GUNMETAL = () => pm(C.gun.base, 'metal');
const GUNDARK = () => pm(C.gun.shade, 'metal');
const SKIN = () => pm(C.skin.base, 'matte');
const BOOT = () => pm(C.gun.shade, 'matte');

interface Soldier {
  g: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  torso: THREE.Object3D;
  arms: THREE.Object3D;
  baseY: number;
  /** gait phase (radians) — advanced by traveled distance only */
  phase: number;
  /** current body yaw relative to unit root (aim tracking) */
  yaw: number;
  restYaw: number;
  /** kneel blend 0..1 (rocket gunner) */
  kneel: number;
}

function leg(side: 1 | -1): THREE.Object3D {
  const pivot = new THREE.Group(); // at the hip
  put(pivot, cbox(0.026, 0.082, 0.03, 0.007), FATIGUE(), 0.001, -0.05, 0);
  put(pivot, cbox(0.038, 0.02, 0.03, 0.006), BOOT(), 0.009, -0.108, 0); // sole lands at y=0
  pivot.rotation.x = side * 0.05; // slight A-stance
  return pivot;
}

/**
 * One miniature soldier. kind:
 *  - 'rifle'  : carbine held two-handed
 *  - 'gunner' : launcher tube on the right shoulder
 *  - 'loader' : no long weapon, ammo backpack
 */
function makeSoldier(team: TeamId, kind: 'rifle' | 'gunner' | 'loader', seed: number): Soldier {
  const accent = teamRamp(team);
  const g = new THREE.Group();

  const legL = leg(1);
  legL.position.set(0, 0.118, 0.017);
  g.add(legL);
  const legR = leg(-1);
  legR.position.set(0, 0.118, -0.017);
  g.add(legR);

  // pelvis sits on the hips
  put(g, cbox(0.05, 0.026, 0.046, 0.008), VEST(), 0, 0.124, 0);

  const torso = new THREE.Group();
  torso.position.set(0, 0.137, 0);
  g.add(torso);

  // chest: shoulders broader than waist (trapezoid hull), vest plate over it
  put(
    torso,
    hull(
      [
        [-0.024, 0, -0.026], [0.024, 0, -0.026], [-0.024, 0, 0.026], [0.024, 0, 0.026],
        [-0.03, 0.062, -0.034], [0.026, 0.062, -0.034], [-0.03, 0.062, 0.034], [0.026, 0.062, 0.034]
      ],
      'inf|chest'
    ),
    FATIGUE(),
    0, 0.002, 0
  );
  put(torso, cbox(0.05, 0.04, 0.06, 0.01), VEST(), 0.004, 0.022, 0);
  // backpack
  put(torso, cbox(0.024, 0.05, 0.042, 0.008), kind === 'loader' ? pm(C.ore.shade) : VEST(), -0.035, 0.03, 0);
  // team pauldron — the accent (left shoulder, faces the camera side)
  put(torso, cbox(0.018, 0.014, 0.02, 0.005), pm(accent.base, 'enamel'), 0.002, 0.057, 0.034);

  // head + helmet (oversized — the miniature read)
  const head = new THREE.Group();
  head.position.set(0, 0.068, 0);
  torso.add(head);
  put(head, cbox(0.03, 0.032, 0.03, 0.008), SKIN(), 0.004, 0.014, 0);
  put(
    head,
    lathe(
      [
        [0.034, 0.024], [0.039, 0.03], [0.035, 0.038], [0.022, 0.05], [0.0001, 0.054]
      ],
      9
    ),
    HELMET(),
    0, 0, 0
  );

  // arms + weapon as one aimed mass
  const arms = new THREE.Group();
  arms.position.set(0.012, 0.034, 0);
  torso.add(arms);

  if (kind === 'rifle') {
    put(arms, cbox(0.058, 0.019, 0.019, 0.005), FATIGUE(), 0.034, -0.004, 0.03, { ry: 0.42 }); // left arm to foregrip
    put(arms, cbox(0.048, 0.019, 0.019, 0.005), FATIGUE(), 0.018, -0.006, -0.03, { ry: -0.34 }); // right arm to trigger
    const rifle = new THREE.Group();
    rifle.position.set(0.042, -0.002, 0.008);
    arms.add(rifle);
    put(rifle, cbox(0.055, 0.026, 0.016, 0.005), GUNDARK(), -0.02, -0.002, 0); // stock + receiver
    put(rifle, cbox(0.1, 0.0145, 0.0135, 0.004), GUNMETAL(), 0.052, 0.003, 0); // barrel + handguard
    put(rifle, cbox(0.013, 0.026, 0.012, 0.004), GUNDARK(), 0.014, -0.024, 0); // magazine
  } else if (kind === 'gunner') {
    put(arms, cbox(0.05, 0.018, 0.018, 0.005), FATIGUE(), 0.024, 0.016, -0.014, { ry: -0.2, rz: 0.5 }); // right arm up to tube
    put(arms, cbox(0.05, 0.018, 0.018, 0.005), FATIGUE(), 0.028, 0.0, 0.02, { ry: 0.3 });
    const tube = new THREE.Group();
    tube.name = 'tube';
    tube.position.set(-0.01, 0.034, -0.03); // over the right shoulder
    arms.add(tube);
    put(tube, lathe([[0.0145, 0], [0.0145, 0.2], [0.019, 0.205], [0.019, 0.225], [0.0001, 0.225]], 9), GUNMETAL(), -0.06, 0, 0, { rz: -Math.PI / 2 }); // tube, muzzle +X
    put(tube, lathe([[0.0185, 0], [0.0185, 0.03], [0.0001, 0.03]], 9), GUNDARK(), -0.075, 0, 0, { rz: -Math.PI / 2 }); // exhaust flare
    put(tube, lathe([[0.012, 0], [0.017, 0.012], [0.0001, 0.034]], 9), pm(accent.base, 'enamel'), 0.165, 0, 0, { rz: -Math.PI / 2 }); // warhead tip = team read
  } else {
    // loader: hands free, carries a spare rocket across the chest
    put(arms, cbox(0.05, 0.017, 0.017, 0.005), FATIGUE(), 0.022, -0.004, 0.022, { ry: 0.4 });
    put(arms, cbox(0.05, 0.017, 0.017, 0.005), FATIGUE(), 0.022, -0.004, -0.022, { ry: -0.4 });
    put(arms, lathe([[0.011, 0], [0.011, 0.1], [0.015, 0.11], [0.0001, 0.13]], 8), GUNDARK(), 0.045, -0.006, 0.05, { rx: Math.PI / 2, rz: 0.15 });
  }

  const restYaw = (hash(seed, team, 3) - 0.5) * 0.3; // members aren't clones
  g.rotation.y = restYaw;
  return { g, legL, legR, torso, arms, baseY: 0, phase: hash(seed, team, 7) * Math.PI * 2, yaw: restYaw, restYaw, kneel: 0 };
}

// ── squad rig ───────────────────────────────────────────────────────────────

const WALK_RATE = 11.5; // gait phase rad/s per tile/s — tuned so feet never slide
const TURN_RATE = 7.5; // body aim tracking, rad/s

function squadRig(soldiers: Soldier[], spots: [number, number][], opts: { kneelGunner?: boolean }): UnitRigHandle {
  const root = new THREE.Group();
  soldiers.forEach((s, i) => {
    s.g.position.set(spots[i][0], 0, spots[i][1]);
    root.add(s.g);
  });

  function update(p: UnitPose): void {
    const alive = Math.max(1, Math.ceil(p.hpFrac * soldiers.length));
    const moving = p.speed > 0.05;

    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      const visible = i < alive;
      if (s.g.visible !== visible) s.g.visible = visible;
      if (!visible) continue;

      // ── gait: phase advances by traveled distance only ──
      s.phase += p.speed * WALK_RATE * p.dt;
      const amp = moving ? Math.min(0.62, 0.3 + p.speed * 0.28) : 0;
      const swing = Math.sin(s.phase) * amp;
      const lift = Math.max(0, Math.sin(s.phase * 2)) /* CoM passes over the planted foot */;

      // ── aim: stationary soldiers square up to the target; movers face travel ──
      const wantYaw = !moving && p.aimYaw !== null ? p.aimYaw - p.bodyYaw : s.restYaw;
      s.yaw = turnTo(s.yaw, wantYaw, TURN_RATE * p.dt);
      s.g.rotation.y = s.yaw;

      // ── kneel blend (rocket gunner braces to fire) ──
      const wantKneel = opts.kneelGunner && i === 0 && !moving && p.aimYaw !== null ? 1 : 0;
      s.kneel += (wantKneel - s.kneel) * Math.min(1, p.dt * 6);
      const k = s.kneel;

      s.legL.rotation.z = swing + k * 0.95;
      s.legR.rotation.z = -swing - k * 1.35;
      s.g.position.y = moving ? lift * 0.006 : -k * 0.052;

      // torso: lean into the run, settle upright at the halt
      s.torso.rotation.z = -(moving ? 0.1 + p.speed * 0.05 : 0) - k * 0.08;

      // ── fire: one kick envelope per actual shot, rippled through the squad ──
      const t = p.sinceShot - i * 0.055;
      const kick = env(t, [[0, 0], [0.045, 1, snap], [0.3, 0, outC]]);
      s.arms.rotation.z = kick * (opts.kneelGunner && i === 0 ? 0.1 : 0.16);
      s.arms.position.x = 0.012 - kick * 0.012;
      // weapon settles level while aiming, dips on the move
      s.arms.rotation.z += moving ? 0.12 + Math.sin(s.phase) * 0.035 : 0;
    }
  }

  return { root, update };
}

// ── public builders ─────────────────────────────────────────────────────────

export function buildRifleSquad(team: TeamId): UnitRigHandle {
  const soldiers = [makeSoldier(team, 'rifle', 1), makeSoldier(team, 'rifle', 2), makeSoldier(team, 'rifle', 3)];
  return squadRig(soldiers, [[0.09, 0], [-0.078, 0.105], [-0.078, -0.105]], {});
}

export function buildRocketTeam(team: TeamId): UnitRigHandle {
  const soldiers = [makeSoldier(team, 'gunner', 4), makeSoldier(team, 'loader', 5)];
  return squadRig(soldiers, [[0.055, 0.05], [-0.075, -0.07]], { kneelGunner: true });
}
