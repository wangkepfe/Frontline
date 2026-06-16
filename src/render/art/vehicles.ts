import * as THREE from 'three';
import type { TeamId } from '../../sim/types';
import { C, pm, teamRamp } from './palette';
import { barrel, cbox, drum, hull, lathe, put, rock } from './kit';
import { env, outC, snap, turnTo, UnitPose, UnitRigHandle } from './rig';

/**
 * Vehicle miniatures. Forward = +X. Every moving part is a named pivot driven
 * by sim truth: wheels/sprockets roll exactly distance/r, turrets track only
 * live targets (and ease home after 2.5 s), recoil fires only on real shots,
 * the howitzer deploys its barrel only at the halt, the supply truck's cargo
 * and tipping bed run only in their service states. Idle vehicles are stone still.
 */

const STEEL = () => pm(C.steel.base);
const STEEL_LT = () => pm(C.steel.lit);
const STEEL_DK = () => pm(C.steel.shade);
const OLIVE = () => pm(C.olive.base);
const OLIVE_DK = () => pm(C.olive.shade);
const GUN = () => pm(C.gun.base, 'metal');
const GUN_DK = () => pm(C.gun.shade, 'metal');
const TRACK = () => pm(C.track.base, 'matte');
const TRACK_DK = () => pm(C.track.shade, 'matte');
const GLASS = () => pm(C.glass.base, 'glass');

const TURRET_RATE = 3.0; // rad/s traverse
const TURRET_HOME_AFTER = 2.5; // s without a target before easing back to front

/** Spinning wheel: pivot at axle, drum + face lugs so rotation reads. */
function wheel(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  w: number,
  side: 1 | -1,
  dark = false
): THREE.Object3D {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  parent.add(pivot);
  put(pivot, drum(r, w), dark ? TRACK_DK() : TRACK(), 0, 0, -w / 2 + (side > 0 ? w : 0) * 0, { rx: Math.PI / 2 });
  // face lugs on the outboard side — the visible "it's rolling" cue
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    put(
      pivot,
      cbox(r * 0.3, r * 0.3, 0.008, 0.004),
      dark ? TRACK() : pm(C.track.lit, 'matte'),
      Math.cos(a) * r * 0.5,
      Math.sin(a) * r * 0.5,
      side * (w / 2 + 0.002)
    );
  }
  return pivot;
}

/** Internal helper state for target tracking turrets. */
function tracker(rate: number) {
  let yaw = 0;
  let lastAim = -99;
  return (p: UnitPose | { time: number; dt: number; aimYaw: number | null; bodyYaw: number }): number => {
    let want = yaw;
    if (p.aimYaw !== null) {
      lastAim = p.time;
      want = p.aimYaw - p.bodyYaw;
      while (want > Math.PI) want -= Math.PI * 2;
      while (want < -Math.PI) want += Math.PI * 2;
    } else if (p.time - lastAim > TURRET_HOME_AFTER) {
      want = 0;
    }
    yaw = turnTo(yaw, want, rate * p.dt);
    return yaw;
  };
}

// ── TANK — the gun (long barrel, wide skirted tracks, low hull) ─────────────

export function buildTank(team: TeamId): UnitRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  const body = new THREE.Group(); // pitch bone (mass lurch)
  body.position.y = 0.0;
  root.add(body);

  // skirted track blocks with raked fronts
  const trackProfile: Array<[number, number]> = [
    [-0.305, 0.045], [-0.25, 0.006], [0.23, 0.006], [0.3, 0.05], [0.305, 0.095], [0.245, 0.128], [-0.245, 0.128], [-0.3, 0.092]
  ];
  const trackGeo = hull(
    trackProfile.flatMap(([x, y]) => [
      [x, y, -0.0675],
      [x, y, 0.0675]
    ] as Array<[number, number, number]>),
    'tank|track'
  );
  const wheels: THREE.Object3D[] = [];
  for (const side of [1, -1] as const) {
    const block = put(body, trackGeo, TRACK(), 0, 0, side * 0.155);
    block.castShadow = true;
    // drive sprockets peeking past the skirt ends
    wheels.push(wheel(body, 0.262, 0.062, side * 0.225, 0.05, 0.03, side, true));
    wheels.push(wheel(body, -0.258, 0.062, side * 0.225, 0.05, 0.03, side, true));
    // fender strip above the track — same steel family, one value down
    put(body, cbox(0.6, 0.014, 0.15, 0.006), STEEL_DK(), 0, 0.14, side * 0.155);
    // side-skirt ribs: steel panels proud of the dark track, breaking the flat skirt face
    for (const rx of [-0.14, 0, 0.14]) put(body, cbox(0.022, 0.085, 0.012, 0.005), STEEL_DK(), rx, 0.07, side * 0.225);
  }

  // hull: belly plate + slab + sloped glacis + rear deck (steel ramp only)
  put(body, cbox(0.56, 0.07, 0.27, 0.016), STEEL_DK(), -0.005, 0.115, 0);
  put(body, cbox(0.5, 0.095, 0.31, 0.02), STEEL(), -0.02, 0.178, 0);
  put(
    body,
    hull(
      [
        [0.22, 0.1, -0.15], [0.22, 0.1, 0.15], [0.22, 0.225, -0.14], [0.22, 0.225, 0.14],
        [0.345, 0.1, -0.12], [0.345, 0.1, 0.12], [0.315, 0.17, -0.1], [0.315, 0.17, 0.1]
      ],
      'tank|glacis'
    ),
    STEEL_LT(),
    0, 0, 0
  );
  put(body, hull(
    [
      [-0.27, 0.1, -0.14], [-0.27, 0.1, 0.14], [-0.34, 0.1, -0.12], [-0.34, 0.1, 0.12],
      [-0.27, 0.21, -0.13], [-0.27, 0.21, 0.13], [-0.33, 0.155, -0.1], [-0.33, 0.155, 0.1]
    ],
    'tank|rear'
  ), STEEL_DK(), 0, 0, 0);
  // engine grilles: two inset panels with a spine between
  put(body, cbox(0.085, 0.012, 0.085, 0.005), GUN_DK(), -0.155, 0.23, 0.055);
  put(body, cbox(0.085, 0.012, 0.085, 0.005), GUN_DK(), -0.155, 0.23, -0.055);
  // headlights: small recessed nubs on the fender fronts
  for (const side of [1, -1] as const) put(body, cbox(0.014, 0.014, 0.02, 0.005), pm(C.foam.base), 0.295, 0.152, side * 0.155);

  // turret: frustum with mantlet, cupola, stowage
  const turret = new THREE.Group();
  turret.position.set(-0.02, 0.225, 0);
  body.add(turret);
  put(
    turret,
    hull(
      [
        [-0.15, 0, -0.115], [0.13, 0, -0.115], [-0.15, 0, 0.115], [0.13, 0, 0.115],
        [-0.115, 0.085, -0.08], [0.1, 0.085, -0.08], [-0.115, 0.085, 0.08], [0.1, 0.085, 0.08]
      ],
      'tank|turret'
    ),
    STEEL_LT(),
    0, 0, 0
  );
  put(turret, cbox(0.07, 0.05, 0.09, 0.012), STEEL(), 0.13, 0.028, 0); // mantlet
  put(turret, lathe([[0.045, 0], [0.05, 0.012], [0.05, 0.034], [0.034, 0.046], [0.0001, 0.048]], 10), STEEL_DK(), -0.055, 0.085, 0.04); // cupola
  put(turret, cbox(0.1, 0.035, 0.05, 0.01), OLIVE_DK(), -0.04, 0.1, -0.055, { ry: 0.1 }); // stowage roll
  put(turret, cbox(0.13, 0.045, 0.012, 0.005), pm(accent.base, 'enamel'), -0.02, 0.04, 0.117); // team flank panel L
  put(turret, cbox(0.13, 0.045, 0.012, 0.005), pm(accent.base, 'enamel'), -0.02, 0.04, -0.117); // team flank panel R
  put(turret, lathe([[0.004, 0], [0.004, 0.14], [0.0001, 0.14]], 5), GUN_DK(), -0.13, 0.08, -0.07); // antenna

  // gun: recoil carriage inside the mantlet pivot
  const recoil = new THREE.Group();
  recoil.position.set(0.15, 0.028, 0);
  turret.add(recoil);
  put(recoil, barrel(0.026, 0.019, 0.42, 9), GUN(), 0, 0, 0, { rz: -Math.PI / 2 });

  const track = tracker(TURRET_RATE);
  let phase = 0;
  let pitch = 0;

  function update(p: UnitPose): void {
    phase += p.speed * p.dt;
    for (const w of wheels) w.rotation.z = -phase / 0.05;

    turret.rotation.y = track(p);

    const kick = env(p.sinceShot, [[0, 0], [0.05, 1, snap], [0.5, 0, outC]]);
    recoil.position.x = 0.15 - kick * 0.07;

    // mass: nose dips on brake, lifts on accel; fire rocks the hull
    const targetPitch = THREE.MathUtils.clamp(-p.accel * 0.012, -0.035, 0.035) + kick * 0.012;
    pitch += (targetPitch - pitch) * Math.min(1, p.dt * 7);
    body.rotation.z = pitch;
  }

  return { root, update };
}

// ── BUGGY — speed (oversized wheels, raked stance, roll cage) ───────────────

export function buildBuggy(team: TeamId): UnitRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  const body = new THREE.Group(); // roll/pitch bone
  root.add(body);

  // tub + raked nose
  put(body, cbox(0.3, 0.055, 0.2, 0.014), OLIVE(), -0.01, 0.095, 0);
  put(
    body,
    hull(
      [
        [-0.16, 0.12, -0.1], [-0.16, 0.12, 0.1], [-0.16, 0.175, -0.09], [-0.16, 0.175, 0.09],
        [0.09, 0.12, -0.1], [0.09, 0.12, 0.1], [0.05, 0.165, -0.09], [0.05, 0.165, 0.09],
        [0.21, 0.12, -0.075], [0.21, 0.12, 0.075]
      ],
      'buggy|top'
    ),
    OLIVE(),
    0, 0, 0
  );
  put(body, cbox(0.1, 0.014, 0.15, 0.006), pm(accent.base, 'enamel'), 0.13, 0.133, 0); // hood panel
  put(body, cbox(0.015, 0.05, 0.14, 0.006), GLASS(), 0.065, 0.19, 0, { rz: -0.25 }); // windshield
  // open roll hoop over the bed — the gun stays visible from the game camera
  for (const side of [1, -1] as const) {
    put(body, cbox(0.016, 0.105, 0.016, 0.006), GUN_DK(), -0.1, 0.215, side * 0.085);
    put(body, cbox(0.07, 0.014, 0.014, 0.006), GUN_DK(), -0.135, 0.255, side * 0.085, { rz: 0.45 }); // rear brace
  }
  put(body, cbox(0.016, 0.016, 0.185, 0.006), GUN_DK(), -0.1, 0.272, 0); // hoop crossbar
  put(body, drum(0.06, 0.04, 10), TRACK(), -0.195, 0.155, 0, { rz: Math.PI / 2 }); // spare wheel on tail
  // bull bar
  put(body, cbox(0.016, 0.05, 0.16, 0.006), GUN_DK(), 0.225, 0.1, 0);

  // pintle MG proud above the hoop
  const gun = new THREE.Group();
  gun.position.set(-0.1, 0.285, 0);
  body.add(gun);
  put(gun, lathe([[0.012, -0.013], [0.012, 0.01], [0.0001, 0.01]], 8), GUN_DK(), 0, 0, 0); // pintle
  put(gun, cbox(0.075, 0.03, 0.026, 0.008), GUN_DK(), 0.01, 0.025, 0);
  const mgRecoil = new THREE.Group();
  gun.add(mgRecoil);
  put(mgRecoil, cbox(0.13, 0.014, 0.014, 0.004), GUN(), 0.1, 0.028, 0);
  put(mgRecoil, cbox(0.02, 0.022, 0.016, 0.006), GUN(), 0.045, 0.012, 0); // grip block
  put(gun, cbox(0.028, 0.026, 0.02, 0.006), pm(accent.shade, 'enamel'), -0.005, 0.022, 0.026); // ammo box

  const wheels = [
    wheel(body, 0.155, 0.075, 0.125, 0.075, 0.05, 1),
    wheel(body, 0.155, 0.075, -0.125, 0.075, 0.05, -1),
    wheel(body, -0.135, 0.075, 0.125, 0.075, 0.05, 1),
    wheel(body, -0.135, 0.075, -0.125, 0.075, 0.05, -1)
  ];

  const track = tracker(6.0);
  let phase = 0;
  let prevYaw: number | null = null;
  let roll = 0;
  let pitch = 0;

  function update(p: UnitPose): void {
    phase += p.speed * p.dt;
    for (const w of wheels) w.rotation.z = -phase / 0.075;

    gun.rotation.y = track(p);
    const kick = env(p.sinceShot, [[0, 0], [0.03, 1, snap], [0.12, 0, outC]]);
    mgRecoil.position.x = -kick * 0.012;

    // chassis talk: lean into turns, pitch with throttle — speed is the read
    let yawRate = 0;
    if (prevYaw !== null && p.dt > 0) {
      let d = p.bodyYaw - prevYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yawRate = d / p.dt;
    }
    prevYaw = p.bodyYaw;
    const targetRoll = THREE.MathUtils.clamp(yawRate * p.speed * 0.045, -0.16, 0.16);
    roll += (targetRoll - roll) * Math.min(1, p.dt * 8);
    const targetPitch = THREE.MathUtils.clamp(-p.accel * 0.02, -0.06, 0.06);
    pitch += (targetPitch - pitch) * Math.min(1, p.dt * 8);
    body.rotation.x = roll;
    body.rotation.z = pitch;
  }

  return { root, update };
}

// ── HOWITZER — the arc (elevated barrel, split trails, crew shield) ─────────

export function buildHowitzer(team: TeamId): UnitRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  const body = new THREE.Group(); // fire rock
  root.add(body);

  put(body, cbox(0.17, 0.075, 0.15, 0.018), STEEL_DK(), 0.01, 0.105, 0); // carriage
  put(body, cbox(0.06, 0.045, 0.3, 0.014), TRACK_DK(), 0.045, 0.085, 0); // axle beam ties the wheels in
  // split trails with spades
  for (const side of [1, -1] as const) {
    put(body, cbox(0.3, 0.034, 0.042, 0.01), STEEL_DK(), -0.15, 0.06, side * 0.07, { ry: side * 0.3 });
    put(body, cbox(0.04, 0.05, 0.05, 0.008), GUN_DK(), -0.285, 0.05, side * 0.115, { ry: side * 0.3 });
  }
  const wheels = [wheel(body, 0.045, 0.085, 0.135, 0.085, 0.045, 1), wheel(body, 0.045, 0.085, -0.135, 0.085, 0.045, -1)];

  // traversing platform with crew shield
  const platform = new THREE.Group();
  platform.position.set(0.02, 0.14, 0);
  body.add(platform);
  for (const side of [1, -1] as const) {
    put(platform, cbox(0.016, 0.13, 0.105, 0.006), STEEL(), 0.085, 0.045, side * 0.058, { rz: -0.16, ry: side * -0.12 });
    put(platform, cbox(0.012, 0.05, 0.06, 0.005), pm(accent.base, 'enamel'), 0.092, 0.02, side * 0.062, { rz: -0.16, ry: side * -0.12 }); // shield panel
  }

  // elevating cradle → recoil sled → barrel
  const cradle = new THREE.Group();
  cradle.position.set(0, 0.065, 0);
  platform.add(cradle);
  put(cradle, cbox(0.16, 0.05, 0.06, 0.012), STEEL(), -0.03, -0.01, 0); // cradle box
  const recoil = new THREE.Group();
  cradle.add(recoil);
  put(recoil, barrel(0.028, 0.02, 0.58, 9), GUN(), 0.02, 0, 0, { rz: -Math.PI / 2 });
  put(recoil, cbox(0.07, 0.062, 0.055, 0.014), GUN_DK(), -0.025, 0, 0); // breech
  put(recoil, cbox(0.018, 0.052, 0.052, 0.008), pm(accent.base, 'enamel'), 0.42, 0, 0); // barrel band
  put(cradle, cbox(0.12, 0.024, 0.034, 0.008), GUN_DK(), 0.04, -0.035, 0); // recuperator

  const TRAVEL_ELEV = 0.12;
  const FIRE_ELEV = 0.7; // exaggerated — the "arc" silhouette read
  const track = tracker(1.6); // heavy gun traverses slowly
  let phase = 0;
  let elev = TRAVEL_ELEV;
  let rock_ = 0;

  function update(p: UnitPose): void {
    phase += p.speed * p.dt;
    for (const w of wheels) w.rotation.z = -phase / 0.085;

    platform.rotation.y = track(p);

    // deploy at the halt, stow for the road — the elevation IS the state read
    const deployed = p.speed < 0.05;
    const wantElev = deployed ? FIRE_ELEV : TRAVEL_ELEV;
    elev += (wantElev - elev) * Math.min(1, p.dt * 2.6);
    cradle.rotation.z = elev;

    const kick = env(p.sinceShot, [[0, 0], [0.05, 1, snap], [0.7, 0, outC]]);
    recoil.position.x = -kick * 0.09;
    const wantRock = kick * 0.05;
    rock_ += (wantRock - rock_) * Math.min(1, p.dt * 10);
    body.rotation.z = rock_;
  }

  return { root, update };
}

// ── SUPPLY TRUCK (unit id 'harvester') — flatbed logistics: crates load
//    aboard at the mine, the bed tips them off at the HQ ────────────────────

export function buildHarvester(team: TeamId): UnitRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  put(body, cbox(0.46, 0.05, 0.24, 0.012), STEEL_DK(), 0.01, 0.09, 0); // chassis
  // military cab, forward
  put(body, cbox(0.17, 0.16, 0.21, 0.022), pm(C.olive.base), 0.175, 0.2, 0);
  put(body, cbox(0.015, 0.07, 0.16, 0.006), GLASS(), 0.262, 0.225, 0); // windshield
  put(body, cbox(0.17, 0.012, 0.21, 0.005), pm(C.olive.shade), 0.175, 0.285, 0); // roof
  put(body, cbox(0.09, 0.012, 0.1, 0.005), pm(accent.base, 'enamel'), 0.175, 0.294, 0); // team roof panel (tightened so the olive frame reads as a painted decal, not a half-roof tint)
  put(body, lathe([[0.012, 0], [0.012, 0.1], [0.018, 0.11], [0.0001, 0.12]], 7), GUN_DK(), 0.11, 0.27, -0.085); // exhaust stack
  put(body, cbox(0.02, 0.05, 0.18, 0.008), GUN_DK(), 0.27, 0.11, 0); // front guard

  // tipping flatbed: pivot at the rear edge so unloading tips backward
  const bed = new THREE.Group();
  bed.position.set(-0.24, 0.115, 0);
  body.add(bed);
  const bx = 0.155; // bed parts are placed relative to the rear pivot
  put(bed, cbox(0.3, 0.022, 0.2, 0.008), STEEL(), bx, 0, 0); // floor
  for (const side of [1, -1] as const) {
    put(bed, cbox(0.3, 0.05, 0.014, 0.006), STEEL(), bx, 0.026, side * 0.105); // low side boards
    put(bed, cbox(0.2, 0.018, 0.009, 0.004), pm(accent.base, 'enamel'), bx, 0.044, side * 0.112); // service stripe
  }
  put(bed, cbox(0.016, 0.07, 0.2, 0.007), STEEL(), bx + 0.155, 0.03, 0, { rz: 0.1 }); // headboard
  put(bed, cbox(0.016, 0.06, 0.2, 0.007), STEEL_LT(), bx - 0.155, 0.026, 0, { rz: -0.1 }); // tailgate

  // the haul — strapped crates + an ore bin, visible only when carrying;
  // group base sits on the bed floor so the load-in scales upward
  const cargo = new THREE.Group();
  cargo.position.set(bx, 0.012, 0);
  bed.add(cargo);
  put(cargo, cbox(0.1, 0.085, 0.15, 0.01), pm(C.timber.base), -0.07, 0.043, 0); // big crate
  put(cargo, cbox(0.1, 0.014, 0.15, 0.005), pm(C.timber.lit), -0.07, 0.092, 0); // lid
  put(cargo, cbox(0.012, 0.087, 0.152, 0.004), GUN_DK(), -0.07, 0.044, 0); // strap
  put(cargo, cbox(0.08, 0.06, 0.11, 0.009), pm(C.timber.shade), 0.045, 0.03, 0.045); // small crate
  put(cargo, cbox(0.07, 0.045, 0.08, 0.008), pm(C.timber.base), 0.05, 0.023, -0.06); // case
  put(cargo, rock(0.042, 11, 0.62), pm(C.ore.base, 'ore'), 0.05, 0.062, -0.058); // ore on the case
  put(cargo, rock(0.034, 13, 0.66), pm(C.ore.lit, 'ore'), 0.1, 0.05, 0.05);

  const wheels = [
    wheel(body, 0.17, 0.06, 0.13, 0.06, 0.045, 1),
    wheel(body, 0.17, 0.06, -0.13, 0.06, 0.045, -1),
    wheel(body, -0.01, 0.06, 0.13, 0.06, 0.045, 1),
    wheel(body, -0.01, 0.06, -0.13, 0.06, 0.045, -1),
    wheel(body, -0.19, 0.06, 0.13, 0.06, 0.045, 1),
    wheel(body, -0.19, 0.06, -0.13, 0.06, 0.045, -1)
  ];

  let phase = 0;
  let rise = 0; // cargo coming aboard while docked at the mine
  let tip = 0; // bed tipped blend

  function update(p: UnitPose): void {
    phase += p.speed * p.dt;
    for (const w of wheels) w.rotation.z = -phase / 0.06;

    const loading = p.harvest === 'loading';
    const unloading = p.harvest === 'unloading';
    const carrying = p.load > 0.04;

    // crates jack up onto the bed during the service stop, ride to the HQ,
    // and tip off there — cargo state is sim truth, never decoration
    rise += (((loading || carrying) && !unloading ? 1 : 0) - rise) * Math.min(1, p.dt * 3.5);
    cargo.visible = rise > 0.05;
    cargo.scale.y = Math.max(0.05, rise);

    tip += ((unloading ? 1 : 0) - tip) * Math.min(1, p.dt * 3);
    bed.rotation.z = tip * 0.42;
  }

  return { root, update };
}
