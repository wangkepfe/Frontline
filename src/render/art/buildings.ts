import * as THREE from 'three';
import type { TeamId } from '../../sim/types';
import { C, pm, teamRamp } from './palette';
import { barrel, cbox, drum, hull, lathe, put, rock } from './kit';
import { BuildingPose, BuildingRigHandle, env, outC, snap, turnTo } from './rig';

/**
 * Building miniatures. Every animation is a state read:
 *  - barracks door / factory gate+crane move only while PRODUCING
 *  - extractor sheave & skip / derrick pumpjack run only while income flows
 *    (a full silo stops them — that stillness is the "collect me!" cue)
 *  - bunker, AT turret & the HQ's command gun track live targets and recoil
 *    on real shots
 *  - the HQ radar always sweeps and flags always breathe: command is alive.
 * Forward = +X (view yaws team 0 toward the field).
 */

const CONC = () => pm(C.concrete.base, 'matte');
const CONC_LT = () => pm(C.concrete.lit, 'matte');
const CONC_DK = () => pm(C.concrete.shade, 'matte');
const STEEL = () => pm(C.steel.base);
const STEEL_LT = () => pm(C.steel.lit);
const STEEL_DK = () => pm(C.steel.shade);
const GUN = () => pm(C.gun.base, 'metal');
const GUN_DK = () => pm(C.gun.shade, 'metal');
const TIMBER = () => pm(C.timber.base);
const TIMBER_DK = () => pm(C.timber.shade);
const CLOTH = () => pm(C.cloth.base, 'matte');
const CLOTH_DK = () => pm(C.cloth.shade, 'matte');

// ── shared props ────────────────────────────────────────────────────────────

/** Team flag with a quiet two-segment flutter. Returns the cloth bones. */
function flag(parent: THREE.Object3D, team: TeamId, h: number, x = 0, z = 0): THREE.Object3D[] {
  const accent = teamRamp(team);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  put(g, lathe([[0.009, 0], [0.006, h - 0.01], [0.012, h - 0.008], [0.0001, h]], 6), GUN_DK(), 0, 0, 0);
  const seg1 = new THREE.Group();
  seg1.position.set(0.012, h - 0.065, 0);
  g.add(seg1);
  put(seg1, cbox(0.062, 0.05, 0.008, 0.003), pm(accent.base, 'enamel'), 0.031, 0, 0);
  const seg2 = new THREE.Group();
  seg2.position.set(0.062, 0, 0);
  seg1.add(seg2);
  put(seg2, cbox(0.05, 0.046, 0.007, 0.003), pm(accent.lit, 'enamel'), 0.025, 0, 0);
  return [seg1, seg2];
}

function flutter(bones: THREE.Object3D[], time: number): void {
  if (bones.length === 0) return;
  bones[0].rotation.y = Math.sin(time * 1.7) * 0.18;
  bones[1].rotation.y = Math.sin(time * 1.7 - 0.9) * 0.3;
}

/** Sandbag arc: little cloth lumps around a corner. */
function sandbags(parent: THREE.Object3D, cx: number, cz: number, r: number, a0: number, a1: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / Math.max(1, n - 1);
    const m = put(parent, cbox(0.062, 0.03, 0.034, 0.012), i % 2 === 0 ? CLOTH() : CLOTH_DK(), cx + Math.cos(a) * r, 0.016 + (i % 2) * 0.024, cz + Math.sin(a) * r, { ry: -a });
    m.castShadow = true;
  }
}

/** Concrete apron pad with chamfered edge — every structure sits on one. */
function apron(parent: THREE.Object3D, w: number, d: number, tone = C.concrete.shade): void {
  put(parent, cbox(w, 0.035, d, 0.014), pm(tone, 'matte'), 0, 0.012, 0, { noCast: true });
}

// ── HQ — command (radar mast, bunkered mass, roof gun, flag) ────────────────

function buildHq(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.96, 0.96);

  // bunkered berm with sloped walls
  put(
    root,
    hull(
      [
        [-0.45, 0.03, -0.45], [0.45, 0.03, -0.45], [-0.45, 0.03, 0.45], [0.45, 0.03, 0.45],
        [-0.33, 0.28, -0.33], [0.33, 0.28, -0.33], [-0.33, 0.28, 0.33], [0.33, 0.28, 0.33]
      ],
      'hq|berm'
    ),
    CONC(),
    0, 0, 0
  );
  // buttress ribs break the big slope faces
  for (const s of [1, -1] as const) {
    put(root, cbox(0.06, 0.26, 0.07, 0.014), CONC_DK(), 0.39, 0.13, s * 0.17, { rz: 0.42 });
    put(root, cbox(0.07, 0.26, 0.06, 0.014), CONC_DK(), s * 0.17, 0.13, 0.39, { rx: -0.42 });
  }
  // command block with slit windows and accent spine
  put(root, cbox(0.5, 0.24, 0.4, 0.028), CONC_LT(), -0.03, 0.4, -0.02);
  put(root, cbox(0.51, 0.026, 0.06, 0.01), pm(accent.base, 'enamel'), -0.03, 0.5, 0.155); // painted spine
  for (const zz of [-0.09, 0.03]) put(root, cbox(0.012, 0.055, 0.09, 0.005), pm(C.glass.shade, 'glass'), 0.222, 0.43, zz);
  put(root, cbox(0.09, 0.055, 0.012, 0.005), pm(C.glass.shade, 'glass'), 0.05, 0.43, 0.175);
  // blast door (front face of the berm) + frame
  put(root, cbox(0.02, 0.14, 0.17, 0.008), GUN_DK(), 0.4, 0.1, 0.12);
  put(root, cbox(0.014, 0.16, 0.2, 0.006), pm(accent.shade, 'enamel'), 0.385, 0.11, 0.12);
  // jersey barriers
  put(root, cbox(0.16, 0.07, 0.05, 0.015), CONC_DK(), 0.38, 0.035, -0.27, { ry: 0.2 });
  put(root, cbox(0.16, 0.07, 0.05, 0.015), CONC_DK(), 0.2, 0.035, -0.38, { ry: 1.1 });
  sandbags(root, -0.36, 0.36, 0.14, -0.4, 1.8, 5);

  // command gun: an armored medium turret on the roof — the HQ shoots back.
  // Collar ring + traversing head + recoiling barrel, same contract as the
  // AT turret so base defense reads identically everywhere.
  const gunBase = new THREE.Group();
  gunBase.position.set(0.1, 0.52, -0.1);
  root.add(gunBase);
  put(gunBase, lathe([[0.085, 0], [0.08, 0.03], [0.062, 0.045], [0.0001, 0.045]], 9), CONC_DK(), 0, 0, 0); // collar
  const gun = new THREE.Group();
  gun.position.y = 0.045;
  gunBase.add(gun);
  put(
    gun,
    hull(
      [
        [-0.1, 0, -0.075], [0.09, 0, -0.075], [-0.1, 0, 0.075], [0.09, 0, 0.075],
        [-0.075, 0.065, -0.05], [0.065, 0.065, -0.05], [-0.075, 0.065, 0.05], [0.065, 0.065, 0.05]
      ],
      'hq|gunhead'
    ),
    STEEL_LT(),
    0, 0, 0
  );
  put(gun, cbox(0.065, 0.04, 0.01, 0.004), pm(accent.base, 'enamel'), -0.02, 0.018, 0.072); // cheek stripes
  put(gun, cbox(0.065, 0.04, 0.01, 0.004), pm(accent.base, 'enamel'), -0.02, 0.018, -0.072);
  put(gun, lathe([[0.022, 0], [0.025, 0.01], [0.025, 0.03], [0.016, 0.038], [0.0001, 0.038]], 8), STEEL_DK(), -0.045, 0.065, 0); // gunner cupola
  const hqRecoil = new THREE.Group();
  hqRecoil.position.set(0.08, 0.018, 0);
  gun.add(hqRecoil);
  put(hqRecoil, barrel(0.018, 0.013, 0.34, 8), GUN(), 0, 0, 0, { rz: -Math.PI / 2 });
  put(hqRecoil, lathe([[0.02, 0], [0.02, 0.045], [0.0001, 0.045]], 8), GUN_DK(), 0.3, 0, 0, { rz: -Math.PI / 2 }); // muzzle brake
  put(hqRecoil, cbox(0.045, 0.045, 0.04, 0.01), GUN_DK(), -0.012, 0, 0); // breech shroud

  // radar mast on the plateau: short lattice + properly tilted dish
  const mastX = -0.19, mastZ = 0.17;
  for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]] as const) {
    put(root, cbox(0.016, 0.3, 0.016, 0.005), STEEL_DK(), mastX + dx, 0.43, mastZ + dz);
  }
  put(root, cbox(0.12, 0.018, 0.12, 0.008), STEEL_DK(), mastX, 0.585, mastZ);
  const radar = new THREE.Group();
  radar.position.set(mastX, 0.6, mastZ);
  root.add(radar);
  const dish = new THREE.Group();
  dish.position.y = 0.035;
  dish.rotation.z = -0.55; // canted toward the horizon
  radar.add(dish);
  put(dish, lathe([[0.0001, 0], [0.075, 0.016], [0.115, 0.052], [0.12, 0.062], [0.105, 0.06], [0.07, 0.028], [0.0001, 0.014]], 12), STEEL_LT(), 0, 0, 0);
  put(dish, lathe([[0.005, 0], [0.005, 0.085], [0.014, 0.1], [0.0001, 0.105]], 6), STEEL_DK(), 0, -0.01, 0); // feed horn
  put(radar, cbox(0.05, 0.04, 0.04, 0.01), STEEL(), 0, 0.012, 0); // yoke
  // whip antenna + beacon on the command block
  put(root, lathe([[0.006, 0], [0.005, 0.26], [0.0001, 0.26]], 5), GUN_DK(), -0.2, 0.52, -0.16);
  put(root, lathe([[0.013, 0], [0.013, 0.02], [0.0001, 0.028]], 6), pm(C.team1.base, 'ore'), -0.2, 0.78, -0.16);

  const flagBones = flag(root, team, 0.5, 0.38, -0.34);
  const track = tracker(2.4);

  function update(p: BuildingPose): void {
    radar.rotation.y = p.time * 0.7; // always sweeping — command is alive
    flutter(flagBones, p.time);
    gun.rotation.y = track(p);
    const kick = env(p.sinceShot, [[0, 0], [0.04, 1, snap], [0.4, 0, outC]]);
    hqRecoil.position.x = 0.08 - kick * 0.05;
  }

  return { root, update };
}

// ── POWER PLANT — the grid (turbine hall, cooling stack, spinning vent fan) ──

function buildPowerPlant(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.9, 0.86);

  // turbine hall with window band and intake louvers on the front (+X)
  put(root, cbox(0.5, 0.26, 0.42, 0.03), STEEL_DK(), -0.12, 0.16, 0.08);
  put(root, cbox(0.52, 0.028, 0.08, 0.01), pm(accent.base, 'enamel'), -0.12, 0.275, 0.25); // roofline stripe
  put(root, cbox(0.012, 0.07, 0.24, 0.005), pm(C.glass.base, 'glass'), 0.125, 0.18, 0.08);
  for (let i = 0; i < 3; i++) {
    put(root, cbox(0.02, 0.1, 0.07, 0.006), STEEL(), 0.13, 0.08, -0.02 + i * 0.1);
  }

  // cooling stack: fat concrete column, dark throat, painted service band
  put(root, lathe([[0.16, 0], [0.14, 0.16], [0.105, 0.4], [0.1, 0.54], [0.0001, 0.54]], 10), CONC(), 0.22, 0.03, -0.2);
  put(root, lathe([[0.082, 0], [0.082, 0.012], [0.0001, 0.012]], 10), pm(C.oil.base, 'matte'), 0.22, 0.572, -0.2);
  put(root, lathe([[0.107, 0], [0.107, 0.03], [0.0001, 0.03]], 10), pm(accent.shade, 'enamel'), 0.22, 0.42, -0.2);

  // roof vent fan — painted spokes give the spin read while the grid hums
  const fan = new THREE.Group();
  fan.position.set(-0.12, 0.305, 0.08);
  root.add(fan);
  put(fan, drum(0.095, 0.03, 12), GUN_DK(), 0, -0.015, 0);
  for (let i = 0; i < 3; i++) {
    put(fan, cbox(0.16, 0.012, 0.028, 0.005), pm(accent.base, 'enamel'), 0, 0.012, 0, { ry: (i / 3) * Math.PI });
  }

  // transformer yard: coil drums with glass insulator pins
  for (const [tx, tz] of [[-0.34, -0.24], [-0.18, -0.28]] as const) {
    put(root, drum(0.05, 0.12, 9), STEEL(), tx, 0.012, tz);
    put(root, lathe([[0.012, 0], [0.008, 0.045], [0.014, 0.055], [0.0001, 0.065]], 6), pm(C.glass.shade, 'glass'), tx, 0.135, tz);
  }
  // feeder pylon with crossarm
  put(root, cbox(0.02, 0.3, 0.02, 0.006), STEEL_DK(), 0.3, 0.15, 0.3);
  put(root, cbox(0.16, 0.014, 0.014, 0.005), STEEL_DK(), 0.3, 0.27, 0.3);
  put(root, cbox(0.09, 0.07, 0.09, 0.012), TIMBER_DK(), 0.34, 0.035, -0.32, { ry: 0.4 }); // cable spool crate

  const flagBones = flag(root, team, 0.4, -0.4, 0.32);
  let spin = 0;

  function update(p: BuildingPose): void {
    flutter(flagBones, p.time);
    if (p.producing) spin += p.dt * (2.4 + p.rate * 0.5);
    fan.rotation.y = spin; // still fan = no power flowing
  }

  return { root, update };
}

// ── BARRACKS — tents + drill (long hall, swinging door while training) ──────

function buildBarracks(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.92, 0.8);

  // ridge-tent hall: olive field canvas over a timber frame
  put(
    root,
    hull(
      [
        [-0.38, 0.03, -0.24], [0.3, 0.03, -0.24], [-0.38, 0.03, 0.24], [0.3, 0.03, 0.24],
        [-0.38, 0.22, -0.17], [0.3, 0.22, -0.17], [-0.38, 0.22, 0.17], [0.3, 0.22, 0.17],
        [-0.38, 0.3, 0], [0.3, 0.3, 0]
      ],
      'brk|tent'
    ),
    pm(C.olive.base, 'matte'),
    -0.02, 0, -0.12
  );
  put(root, cbox(0.72, 0.018, 0.05, 0.008), pm(C.olive.shade, 'matte'), -0.06, 0.3, -0.12); // ridge cap
  // gable door (front, +X) that swings open while a squad drills
  put(root, cbox(0.02, 0.17, 0.15, 0.008), TIMBER_DK(), 0.285, 0.085, -0.12);
  const door = new THREE.Group();
  door.position.set(0.295, 0.02, -0.045);
  root.add(door);
  put(door, cbox(0.016, 0.15, 0.12, 0.006), pm(accent.shade, 'enamel'), 0, 0.075, -0.06);
  // drill yard: rifle rack + crates + sandbags
  put(root, cbox(0.16, 0.02, 0.03, 0.008), TIMBER(), 0.1, 0.1, 0.3, { ry: 0.15 });
  for (let i = 0; i < 4; i++) put(root, cbox(0.012, 0.13, 0.012, 0.004), GUN(), 0.045 + i * 0.038, 0.07, 0.3 + (i % 2) * 0.012, { rz: 0.25, ry: 0.15 });
  put(root, cbox(0.11, 0.09, 0.11, 0.015), TIMBER(), -0.28, 0.045, 0.28, { ry: 0.3 });
  put(root, cbox(0.09, 0.07, 0.09, 0.012), TIMBER_DK(), -0.16, 0.035, 0.33, { ry: 0.7 });
  sandbags(root, 0.3, 0.28, 0.1, -0.6, 1.6, 4);

  const flagBones = flag(root, team, 0.42, -0.4, 0.32);
  let open = 0;

  function update(p: BuildingPose): void {
    flutter(flagBones, p.time);
    open += ((p.producing ? 1 : 0) - open) * Math.min(1, p.dt * 5);
    door.rotation.y = open * 1.5; // swings wide while training, shut when idle
  }

  return { root, update };
}

// ── FACTORY — industry (sawtooth roof, gate + gantry while building) ────────

function buildFactory(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.94, 0.9);

  put(root, cbox(0.8, 0.3, 0.62, 0.03), STEEL_DK(), -0.04, 0.18, 0); // hall
  // wall ribs + window band so the box isn't a monolith
  for (const xr of [-0.3, -0.04, 0.22]) put(root, cbox(0.05, 0.28, 0.025, 0.01), STEEL(), xr, 0.17, 0.315);
  put(root, cbox(0.5, 0.06, 0.014, 0.006), pm(C.glass.base, 'glass'), -0.04, 0.24, 0.312);
  // sawtooth roof: two exaggerated teeth, glass on the steep front faces
  for (const xo of [-0.24, 0.16]) {
    put(
      root,
      hull(
        [
          [xo - 0.2, 0.32, -0.3], [xo + 0.2, 0.32, -0.3], [xo - 0.2, 0.32, 0.3], [xo + 0.2, 0.32, 0.3],
          [xo + 0.12, 0.5, -0.3], [xo + 0.2, 0.5, 0.3], [xo + 0.2, 0.5, -0.3], [xo + 0.12, 0.5, 0.3]
        ],
        `fac|tooth${xo}`
      ),
      STEEL(),
      0, 0, 0
    );
    put(root, cbox(0.012, 0.15, 0.56, 0.005), pm(C.glass.base, 'glass'), xo + 0.185, 0.41, 0, { rz: 0.12 });
  }
  put(root, cbox(0.82, 0.025, 0.08, 0.01), pm(accent.base, 'enamel'), -0.04, 0.335, 0.29); // roofline stripe
  // smokestack
  put(root, lathe([[0.05, 0], [0.045, 0.3], [0.055, 0.32], [0.05, 0.38], [0.0001, 0.38]], 9), pm(C.ochre.shade, 'matte'), -0.33, 0.32, -0.2);
  // vehicle gate (front +X): slides up while producing
  put(root, cbox(0.025, 0.26, 0.34, 0.01), STEEL_LT(), 0.37, 0.15, 0); // gate frame
  const gate = new THREE.Group();
  gate.position.set(0.378, 0, 0);
  root.add(gate);
  put(gate, cbox(0.018, 0.2, 0.28, 0.008), GUN_DK(), 0, 0.11, 0);
  put(gate, cbox(0.018, 0.04, 0.28, 0.008), pm(accent.shade, 'enamel'), 0.004, 0.025, 0); // hazard skirt
  // roof gantry crane: traverses while producing
  const rail = put(root, cbox(0.04, 0.03, 0.66, 0.012), STEEL_LT(), 0.05, 0.55, 0);
  rail.castShadow = true;
  const crane = new THREE.Group();
  crane.position.set(0.05, 0.565, 0);
  root.add(crane);
  put(crane, cbox(0.2, 0.045, 0.05, 0.014), pm(C.ochre.base), 0, 0.02, 0);
  put(crane, lathe([[0.016, 0], [0.016, 0.05], [0.0001, 0.05]], 7), GUN_DK(), 0.07, -0.045, 0);
  // pallet stacks in the yard
  put(root, cbox(0.12, 0.05, 0.1, 0.012), TIMBER(), 0.33, 0.025, 0.32, { ry: 0.2 });
  put(root, cbox(0.1, 0.04, 0.08, 0.01), STEEL(), 0.2, 0.02, 0.36, { ry: -0.3 });

  let work = 0;

  function update(p: BuildingPose): void {
    work += ((p.producing ? 1 : 0) - work) * Math.min(1, p.dt * 4);
    gate.position.y = work * 0.17; // gate up = line is running
    crane.position.z = Math.sin(p.time * (0.55 + p.rate * 0.2)) * 0.24 * work; // gantry traverses
  }

  return { root, update };
}

// ── EXTRACTOR — mine-works (headframe sheave, travelling skip) ──────────────

function buildExtractor(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.84, 0.84);

  // spoil pile with gold flecks + shaft collar under the frame
  put(root, rock(0.2, 21, 0.42), pm(C.ochre.base, 'matte'), -0.22, 0.02, 0.26);
  put(root, rock(0.05, 22, 0.7), pm(C.ore.base, 'ore'), -0.16, 0.035, 0.2);
  put(root, rock(0.04, 23, 0.7), pm(C.ore.lit, 'ore'), -0.28, 0.03, 0.32);
  put(root, lathe([[0.14, 0], [0.14, 0.05], [0.115, 0.05], [0.115, 0.012], [0.0001, 0.012]], 10), CONC_DK(), 0.02, 0, 0);

  // headframe: two solid tapered truss panels carrying a BIG sheave wheel
  const panelGeo = hull(
    [
      [-0.17, 0, -0.019], [0.21, 0, -0.019], [-0.17, 0, 0.019], [0.21, 0, 0.019],
      [-0.015, 0.54, -0.019], [0.055, 0.54, -0.019], [-0.015, 0.54, 0.019], [0.055, 0.54, 0.019]
    ],
    'ext|panel'
  );
  for (const side of [1, -1] as const) put(root, panelGeo, STEEL_DK(), 0, 0.02, side * 0.105);
  put(root, cbox(0.3, 0.045, 0.19, 0.014), TIMBER_DK(), 0.02, 0.2, 0); // lower brace
  put(root, cbox(0.2, 0.04, 0.19, 0.012), TIMBER(), 0.02, 0.4, 0); // upper brace
  const sheave = new THREE.Group();
  sheave.position.set(0.02, 0.6, 0);
  root.add(sheave);
  put(sheave, drum(0.115, 0.045, 12), GUN(), 0, 0, -0.0225, { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    put(sheave, cbox(0.2, 0.02, 0.014, 0.006), pm(accent.base, 'enamel'), 0, 0, 0.028, { rz: a }); // painted spokes — the spin read
  }
  // skip bucket riding inside the frame + live hoist cable
  const skip = new THREE.Group();
  skip.position.set(0.02, 0.1, 0);
  root.add(skip);
  put(skip, hull(
    [
      [-0.06, 0.09, -0.055], [0.06, 0.09, -0.055], [-0.06, 0.09, 0.055], [0.06, 0.09, 0.055],
      [-0.035, 0, -0.032], [0.035, 0, -0.032], [-0.035, 0, 0.032], [0.035, 0, 0.032]
    ],
    'ext|skip'
  ), pm(C.ochre.base), 0, 0, 0);
  const cable = put(root, lathe([[0.006, 0], [0.006, 1], [0.0001, 1]], 5), GUN_DK(), 0.02, 0, 0);
  cable.castShadow = false;
  // winch house with drum, drive cable running up to the sheave hub
  put(root, cbox(0.22, 0.13, 0.18, 0.02), STEEL_DK(), -0.3, 0.065, -0.27);
  put(root, cbox(0.23, 0.02, 0.05, 0.008), pm(accent.shade, 'enamel'), -0.3, 0.14, -0.21);
  put(root, drum(0.045, 0.09, 9), GUN(), -0.3, 0.11, -0.16, { rx: Math.PI / 2 });
  const guyCable = put(root, lathe([[0.005, 0], [0.005, 1], [0.0001, 1]], 5), GUN_DK(), -0.3, 0.13, -0.2);
  guyCable.castShadow = false;
  {
    const from = new THREE.Vector3(-0.3, 0.13, -0.2);
    const to = new THREE.Vector3(0.02, 0.49, 0);
    const dir = to.clone().sub(from);
    guyCable.scale.y = dir.length();
    guyCable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  // ore bin at the chute mouth — the gold read
  put(root, cbox(0.2, 0.1, 0.16, 0.014), STEEL(), 0.3, 0.05, 0.26, { ry: 0.1 });
  put(root, rock(0.05, 24, 0.7), pm(C.ore.base, 'ore'), 0.27, 0.1, 0.24);
  put(root, rock(0.045, 25, 0.7), pm(C.ore.lit, 'ore'), 0.33, 0.105, 0.3);

  let spin = 0;

  function update(p: BuildingPose): void {
    if (p.producing) spin += p.dt * (1.2 + p.rate * 1.3);
    sheave.rotation.z = spin;
    // skip rides the shaft while ore flows; parks at the collar when stopped
    const k = p.producing ? (Math.sin(spin * 0.45) + 1) / 2 : 0;
    skip.position.y = 0.06 + k * 0.36;
    // hoist cable always spans sheave → skip
    const top = 0.6 - 0.115;
    const bottom = skip.position.y + 0.09;
    cable.position.y = bottom;
    cable.scale.y = Math.max(0.02, top - bottom);
  }

  return { root, update };
}

// ── DERRICK — pumpjack (true walking-beam linkage) ──────────────────────────

function buildDerrick(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.84, 0.84);

  put(root, lathe([[0.2, 0], [0.185, 0.014], [0.0001, 0.014]], 12), pm(C.oil.base, 'matte'), 0.2, 0.03, 0.08, { noCast: true }); // oil slick
  // timber skids under the machine
  for (const side of [1, -1] as const) put(root, cbox(0.6, 0.04, 0.05, 0.012), TIMBER_DK(), -0.06, 0.05, side * 0.08);
  // samson A-post holding the beam pivot
  for (const side of [1, -1] as const) {
    put(root, cbox(0.045, 0.4, 0.045, 0.014), STEEL_DK(), 0, 0.25, side * 0.1, { rx: side * 0.24 });
  }
  // walking beam with painted horsehead
  const beam = new THREE.Group();
  beam.position.set(0, 0.42, 0);
  root.add(beam);
  put(beam, cbox(0.5, 0.05, 0.055, 0.016), STEEL(), 0, 0, 0);
  put(beam, hull(
    [
      [0.22, -0.1, -0.045], [0.22, 0.06, -0.045], [0.22, -0.1, 0.045], [0.22, 0.06, 0.045],
      [0.31, -0.06, -0.04], [0.31, 0.045, -0.04], [0.31, -0.06, 0.04], [0.31, 0.045, 0.04]
    ],
    'der|horsehead'
  ), pm(accent.base, 'enamel'), 0, 0, 0); // the nodding team read
  // crank + chunky counterweights at the tail
  const crank = new THREE.Group();
  crank.position.set(-0.3, 0.15, 0);
  root.add(crank);
  for (const side of [1, -1] as const) {
    put(crank, drum(0.09, 0.026, 10), GUN_DK(), 0, 0, side * 0.055 - 0.013, { rx: Math.PI / 2 });
    put(crank, cbox(0.07, 0.06, 0.024, 0.012), GUN(), 0, 0.055, side * 0.055 - 0.013); // counterweight lobe
  }
  put(crank, cbox(0.035, 0.035, 0.14, 0.012), GUN(), 0, 0, 0); // crankshaft
  // pitman arms — re-aimed every frame to truly connect crank pin ↔ beam tail
  const pitmans: THREE.Mesh[] = [];
  for (const side of [1, -1] as const) {
    pitmans.push(put(root, cbox(0.016, 0.3, 0.02, 0.006), STEEL_LT(), -0.24, 0.28, side * 0.065));
  }
  // polished rod: the part that visibly pumps the well
  const rod = put(root, lathe([[0.0075, 0], [0.0075, 1], [0.0001, 1]], 6), STEEL_LT(), 0.265, 0.16, 0);
  rod.castShadow = false;
  // wellhead under the horsehead nose
  put(root, lathe([[0.045, 0], [0.045, 0.09], [0.026, 0.09], [0.026, 0.16], [0.04, 0.16], [0.04, 0.19], [0.0001, 0.19]], 8), GUN(), 0.265, 0, 0);
  // motor shed + modest day-tank
  put(root, cbox(0.17, 0.12, 0.15, 0.02), STEEL_DK(), -0.33, 0.06, -0.26);
  put(root, drum(0.06, 0.15, 11), STEEL(), 0.26, 0.062, -0.3, { rz: Math.PI / 2 });
  put(root, cbox(0.016, 0.05, 0.11, 0.007), pm(accent.shade, 'enamel'), 0.315, 0.062, -0.3); // tank band

  let theta = 0;
  const CRANK_R = 0.062;
  const BEAM_TAIL = -0.25;

  function update(p: BuildingPose): void {
    if (p.producing) theta += p.dt * (1.1 + p.rate * 0.9);
    crank.rotation.z = theta;
    beam.rotation.z = Math.sin(theta + 0.5) * 0.17; // the nod

    // pitmans connect crank pin ↔ beam tail exactly (XY plane linkage)
    const px = -0.3 + Math.cos(theta) * CRANK_R;
    const py = 0.15 + Math.sin(theta) * CRANK_R;
    const bphi = beam.rotation.z;
    const tx = Math.cos(bphi) * BEAM_TAIL;
    const ty = 0.42 + Math.sin(bphi) * BEAM_TAIL;
    const dx = tx - px, dy = ty - py;
    const len = Math.hypot(dx, dy);
    for (const m of pitmans) {
      m.position.x = (px + tx) / 2;
      m.position.y = (py + ty) / 2;
      m.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      m.scale.y = len / 0.3;
    }
    // polished rod follows the horsehead nose down into the wellhead
    const noseY = 0.42 + Math.sin(bphi) * 0.265;
    rod.scale.y = Math.max(0.03, noseY - 0.16);
  }

  return { root, update };
}

// ── BUNKER — pillbox (low dome, tracking MG in the slit) ────────────────────

function buildBunker(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.8, 0.8);

  // octagonal pillbox with stepped dome
  put(
    root,
    lathe(
      [
        [0.34, 0], [0.34, 0.1], [0.3, 0.13], [0.285, 0.13], [0.285, 0.2], [0.22, 0.26], [0.1, 0.29], [0.0001, 0.295]
      ],
      8
    ),
    CONC(),
    0, 0.02, 0,
    { ry: Math.PI / 8 }
  );
  // firing slit band (dark inset) + painted lintel
  put(root, cbox(0.2, 0.045, 0.3, 0.01), pm(C.oil.base, 'matte'), 0.21, 0.165, 0, { ry: 0 });
  put(root, cbox(0.02, 0.018, 0.3, 0.006), pm(accent.base, 'enamel'), 0.3, 0.21, 0);
  sandbags(root, 0.26, -0.26, 0.14, -1.2, 1.0, 5);
  put(root, cbox(0.08, 0.05, 0.08, 0.012), TIMBER_DK(), -0.3, 0.025, -0.28, { ry: 0.5 }); // ammo crate

  // MG on a traversing mount inside the slit
  const gun = new THREE.Group();
  gun.position.set(0.1, 0.185, 0);
  root.add(gun);
  const mgRecoil = new THREE.Group();
  gun.add(mgRecoil);
  put(mgRecoil, cbox(0.07, 0.045, 0.045, 0.014), GUN_DK(), 0.1, 0, 0); // mantlet block
  put(mgRecoil, cbox(0.17, 0.016, 0.016, 0.005), GUN(), 0.21, 0.005, 0); // barrel

  const track = tracker(2.6);

  function update(p: BuildingPose): void {
    gun.rotation.y = track(p);
    const kick = env(p.sinceShot, [[0, 0], [0.03, 1, snap], [0.1, 0, outC]]);
    mgRecoil.position.x = -kick * 0.014;
  }

  return { root, update };
}

// ── AT TURRET — overwatch (long gun on an armored pedestal) ─────────────────

function buildAtTurret(team: TeamId): BuildingRigHandle {
  const accent = teamRamp(team);
  const root = new THREE.Group();
  apron(root, 0.78, 0.78);

  put(root, lathe([[0.3, 0], [0.28, 0.06], [0.2, 0.09], [0.18, 0.17], [0.0001, 0.17]], 9), CONC(), 0, 0.02, 0); // pedestal
  sandbags(root, -0.27, 0.24, 0.13, 1.4, 3.4, 5);
  // ready rack of shells
  put(root, cbox(0.05, 0.04, 0.16, 0.01), TIMBER_DK(), 0.28, 0.02, 0.24, { ry: 0.3 });
  for (let i = 0; i < 3; i++) put(root, lathe([[0.012, 0], [0.012, 0.11], [0.006, 0.13], [0.0001, 0.13]], 7), pm(C.ore.base, 'metal'), 0.26 + i * 0.024, 0.052, 0.22 + i * 0.012, { rz: Math.PI / 2 - 0.3, ry: 0.3 });

  // armored turret head
  const turret = new THREE.Group();
  turret.position.set(0, 0.21, 0);
  root.add(turret);
  put(
    turret,
    hull(
      [
        [-0.13, -0.02, -0.1], [0.12, -0.02, -0.1], [-0.13, -0.02, 0.1], [0.12, -0.02, 0.1],
        [-0.1, 0.08, -0.065], [0.09, 0.08, -0.065], [-0.1, 0.08, 0.065], [0.09, 0.08, 0.065]
      ],
      'att|head'
    ),
    STEEL_LT(),
    0, 0, 0
  );
  put(turret, cbox(0.085, 0.05, 0.012, 0.005), pm(accent.base, 'enamel'), -0.015, 0.02, 0.095); // cheek panels
  put(turret, cbox(0.085, 0.05, 0.012, 0.005), pm(accent.base, 'enamel'), -0.015, 0.02, -0.095);
  put(turret, lathe([[0.03, 0], [0.034, 0.012], [0.034, 0.04], [0.022, 0.05], [0.0001, 0.05]], 8), STEEL_DK(), -0.06, 0.08, 0); // sight cupola
  const recoil = new THREE.Group();
  recoil.position.set(0.1, 0.022, 0);
  turret.add(recoil);
  put(recoil, barrel(0.022, 0.015, 0.46, 8), GUN(), 0, 0, 0, { rz: -Math.PI / 2 });
  put(recoil, cbox(0.05, 0.05, 0.045, 0.012), GUN_DK(), -0.01, 0, 0); // breech shroud

  const track = tracker(2.2);

  function update(p: BuildingPose): void {
    turret.rotation.y = track(p);
    const kick = env(p.sinceShot, [[0, 0], [0.05, 1, snap], [0.55, 0, outC]]);
    recoil.position.x = 0.1 - kick * 0.06;
  }

  return { root, update };
}

// shared turret tracking (same contract as vehicles)
function tracker(rate: number) {
  let yaw = 0;
  let lastAim = -99;
  return (p: BuildingPose): number => {
    let want = yaw;
    if (p.aimYaw !== null) {
      lastAim = p.time;
      want = p.aimYaw - p.bodyYaw;
      while (want > Math.PI) want -= Math.PI * 2;
      while (want < -Math.PI) want += Math.PI * 2;
    } else if (p.time - lastAim > 2.5) {
      want = 0;
    }
    yaw = turnTo(yaw, want, rate * p.dt);
    return yaw;
  };
}

// ── registry ────────────────────────────────────────────────────────────────

export function buildHqRig(team: TeamId): BuildingRigHandle { return buildHq(team); }
export function buildPowerPlantRig(team: TeamId): BuildingRigHandle { return buildPowerPlant(team); }
export function buildBarracksRig(team: TeamId): BuildingRigHandle { return buildBarracks(team); }
export function buildFactoryRig(team: TeamId): BuildingRigHandle { return buildFactory(team); }
export function buildExtractorRig(team: TeamId): BuildingRigHandle { return buildExtractor(team); }
export function buildDerrickRig(team: TeamId): BuildingRigHandle { return buildDerrick(team); }
export function buildBunkerRig(team: TeamId): BuildingRigHandle { return buildBunker(team); }
export function buildAtTurretRig(team: TeamId): BuildingRigHandle { return buildAtTurret(team); }
