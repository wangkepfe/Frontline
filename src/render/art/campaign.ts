import * as THREE from 'three';
import type { NodeType } from '../../campaign/run';
import { C, pm, teamRamp, vertexMat } from './palette';
import { bake, barrel, cbox, cyl, drum, hash, hull, lathe, mergeChunk, put, rock, wedge } from './kit';
import { Biome } from './biomes';

/**
 * Campaign war-table art (ART_DIRECTION addendum). The node map is a real
 * diorama: a biome theater board (reusing the same flora/mountain/water
 * vocabulary as the battle terrain), a distinct miniature prop per node, and
 * dirt-road ribbons between them. Battle camps vary by node seed but all read
 * as "contested" via a shared red enemy-pennant + smoke motif. Props are kept
 * as individual rigged groups (≈18 per map) so flags flutter and embers glow;
 * the board itself bakes into one merged chunk like the battle terrain.
 */

const TOP = 0.1; // board-top plane (matches terrain.ts TILE_TOP)

export interface PropHandle {
  root: THREE.Group;
  update: (t: number) => void;
}

export const BATTLE_VARIANTS = 5;

// ── shared prop helpers ──────────────────────────────────────────────────────

/** team pennant on a pole — the enemy marker on every fight node */
function pennant(parent: THREE.Object3D, team: 0 | 1, h: number, x: number, z: number): THREE.Object3D[] {
  const accent = teamRamp(team);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  put(g, lathe([[0.012, 0], [0.008, h - 0.01], [0.0001, h]], 6), pm(C.gun.shade, 'metal'), 0, 0, 0);
  const seg1 = new THREE.Group();
  seg1.position.set(0.012, h - 0.09, 0);
  g.add(seg1);
  // triangular pennant: a tapered wedge of enamel cloth
  put(seg1, hull([[0, -0.04, 0.004], [0, 0.04, 0.004], [0, -0.04, -0.004], [0, 0.04, -0.004], [0.12, 0, 0.004], [0.12, 0, -0.004]], 'cmp|pennant'), pm(accent.base, 'enamel'), 0.005, 0, 0);
  const seg2 = new THREE.Group();
  seg2.position.set(0.12, 0, 0);
  seg1.add(seg2);
  put(seg2, hull([[0, -0.028, 0.004], [0, 0.028, 0.004], [0, -0.028, -0.004], [0, 0.028, -0.004], [0.07, 0, 0.004], [0.07, 0, -0.004]], 'cmp|pennant2'), pm(accent.lit, 'enamel'), 0.0, 0, 0);
  return [seg1, seg2];
}

function flutter(bones: THREE.Object3D[], time: number, x = 0): void {
  if (!bones.length) return;
  bones[0].rotation.y = Math.sin(time * 1.6 + x) * 0.22;
  bones[1].rotation.y = Math.sin(time * 1.6 - 0.9 + x) * 0.34;
}

/** sandbag arc */
function sandbags(parent: THREE.Object3D, cx: number, cz: number, r: number, a0: number, a1: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / Math.max(1, n - 1);
    put(parent, cbox(0.07, 0.034, 0.04, 0.014), i % 2 === 0 ? pm(C.cloth.base, 'matte') : pm(C.cloth.shade, 'matte'), cx + Math.cos(a) * r, 0.018 + (i % 2) * 0.026, cz + Math.sin(a) * r, { ry: -a });
  }
}

/** a clearing pad — the dirt circle a prop stands on */
function pad(parent: THREE.Object3D, tone: number, r = 0.6): void {
  put(parent, cyl(r, 0.03, 14), pm(tone, 'matte'), 0, -0.005, 0, { noCast: true, noReceive: false });
}

function crate(parent: THREE.Object3D, x: number, z: number, s: number, tone = C.timber.base, ry = 0): void {
  put(parent, cbox(s, s * 0.85, s, s * 0.13), pm(tone), x, s * 0.42, z, { ry });
  put(parent, cbox(s * 1.02, s * 0.1, s * 0.16, s * 0.04), pm(C.timber.shade), x, s * 0.5, z, { ry }); // strap
}

function drumProp(parent: THREE.Object3D, x: number, z: number, tone: number): void {
  put(parent, drum(0.07, 0.16, 10), pm(tone, 'metal'), x, 0, z); // upright fuel drum
  put(parent, lathe([[0.07, 0], [0.07, 0.012], [0.0001, 0.012]], 10), pm(C.gun.shade, 'metal'), x, 0.16, z); // lid rim
}

/** translucent smoke column — a few drifting puffs (own materials, not shared) */
function smoke(parent: THREE.Object3D, x: number, z: number): THREE.Group[] {
  const puffs: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.position.set(x, 0.16 + i * 0.16, z); // taller column so the plume clears the prop
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a443d, transparent: true, opacity: 0.55 - i * 0.12, roughness: 1, depthWrite: false });
    mat.userData.own = true; // one-off (not a shared pm() material) — disposeGroup may free it
    const m = new THREE.Mesh(rock(0.05 + i * 0.03, i + 2, 0.9), mat);
    m.castShadow = false;
    g.add(m);
    parent.add(g);
    puffs.push(g);
  }
  return puffs;
}

function driftSmoke(puffs: THREE.Group[], t: number): void {
  puffs.forEach((p, i) => {
    p.position.x += Math.sin(t * 0.6 + i) * 0.0006;
    p.rotation.y = t * (0.3 + i * 0.1);
    p.scale.setScalar(1 + Math.sin(t * 0.8 + i * 1.7) * 0.12);
  });
}

/** small glowing ember/beacon */
function ember(parent: THREE.Object3D, x: number, y: number, z: number, hex: number, r = 0.03): THREE.Mesh {
  const m = put(parent, lathe([[r, 0], [r, 0.006], [0.0001, 0.01]], 6), pm(hex, 'ore'), x, y, z, { noCast: true });
  return m;
}

// ── battle camps (5 variants, shared "contested" motif) ─────────────────────

function campSandbagRedoubt(root: THREE.Group): THREE.Object3D[] {
  sandbags(root, 0, 0, 0.34, -0.3, 2.5, 7);
  sandbags(root, 0.04, -0.02, 0.18, 1.2, 3.6, 4);
  // mounted MG on a post
  put(root, cbox(0.05, 0.12, 0.05, 0.014), pm(C.gun.shade, 'metal'), 0.02, 0.06, 0.04);
  put(root, barrel(0.014, 0.01, 0.2, 8), pm(C.gun.base, 'metal'), 0.02, 0.15, 0.04, { rz: -Math.PI / 2, ry: 0.3 });
  crate(root, -0.28, 0.24, 0.13);
  crate(root, -0.36, 0.18, 0.1, C.olive.base);
  return pennant(root, 1, 0.4, 0.26, -0.28);
}

function campWatchtower(root: THREE.Group): THREE.Object3D[] {
  for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]] as const) {
    put(root, cbox(0.03, 0.42, 0.03, 0.008), pm(C.timber.shade), dx, 0.21, dz, { rx: dz * 0.12, rz: -dx * 0.12 });
  }
  put(root, cbox(0.34, 0.03, 0.34, 0.01), pm(C.timber.base), 0, 0.44, 0); // platform
  put(root, cbox(0.32, 0.1, 0.04, 0.01), pm(C.timber.shade), 0, 0.5, -0.15); // rail
  put(root, cbox(0.04, 0.1, 0.32, 0.01), pm(C.timber.shade), -0.15, 0.5, 0);
  // sloped roof
  put(root, wedge(0.4, 0.13, 0.4, 0.05), pm(C.olive.shade, 'matte'), 0, 0.55, 0);
  sandbags(root, 0, 0, 0.3, 0.6, 2.4, 5);
  crate(root, 0.28, -0.2, 0.12);
  return pennant(root, 1, 0.34, 0, 0.18);
}

function campGunEmplacement(root: THREE.Group): THREE.Object3D[] {
  // a field gun behind a sandbag horseshoe
  sandbags(root, 0, 0.06, 0.32, 0.2, 2.9, 7);
  const gun = new THREE.Group();
  gun.position.set(0, 0.05, -0.02);
  gun.rotation.y = -0.5;
  root.add(gun);
  put(gun, cbox(0.16, 0.06, 0.1, 0.02), pm(C.olive.base), 0, 0.03, 0); // carriage
  put(gun, drum(0.06, 0.03, 10), pm(C.gun.shade, 'metal'), -0.1, 0.03, 0.07, { rx: -Math.PI / 2 });
  put(gun, drum(0.06, 0.03, 10), pm(C.gun.shade, 'metal'), -0.1, 0.03, -0.07, { rx: -Math.PI / 2 });
  put(gun, barrel(0.022, 0.014, 0.34, 8), pm(C.gun.base, 'metal'), 0.04, 0.08, 0, { rz: 0.5 }); // raised barrel
  crate(root, 0.3, 0.22, 0.1, C.olive.base);
  crate(root, 0.36, 0.16, 0.09, C.olive.shade);
  return pennant(root, 1, 0.38, -0.28, 0.26);
}

function campTrenchLine(root: THREE.Group): THREE.Object3D[] {
  // a zig-zag earth berm
  let px = -0.34, pz = 0.2;
  for (let i = 1; i < 5; i++) {
    const nx = -0.34 + i * 0.22;
    const nz = i % 2 === 0 ? 0.2 : -0.05;
    const mx = (px + nx) / 2, mz = (pz + nz) / 2;
    const len = Math.hypot(nx - px, nz - pz);
    put(root, cbox(len + 0.1, 0.08, 0.1, 0.02), pm(C.timber.shade, 'matte'), mx, 0.04, mz, { ry: Math.atan2(nz - pz, nx - px) });
    px = nx; pz = nz;
  }
  sandbags(root, 0.0, 0.18, 0.14, 0.4, 2.2, 4);
  // helmets peeking
  for (const [hx, hz] of [[-0.18, 0.1], [0.04, -0.02], [0.24, 0.12]] as const) {
    put(root, lathe([[0.03, 0], [0.032, 0.012], [0.022, 0.026], [0.0001, 0.03]], 8), pm(C.olive.shade), hx, 0.06, hz);
  }
  crate(root, -0.34, -0.2, 0.1, C.olive.base);
  return pennant(root, 1, 0.34, 0.3, -0.24);
}

function campWreck(root: THREE.Group): THREE.Object3D[] {
  // a knocked-out tank hull, scorched and tilted in a crater
  put(root, cyl(0.4, 0.02, 16), pm(C.oil.shade, 'matte'), 0, 0.005, 0, { noCast: true }); // scorch
  const hullG = new THREE.Group();
  hullG.position.set(0, 0.05, 0);
  hullG.rotation.set(0.12, 0.5, -0.16);
  root.add(hullG);
  put(hullG, cbox(0.34, 0.1, 0.22, 0.03), pm(C.gun.shade, 'metal'), 0, 0.05, 0); // hull
  put(hullG, wedge(0.26, 0.06, 0.18, 0.16), pm(C.gun.base, 'metal'), 0.02, 0.1, 0); // turret remains
  put(hullG, barrel(0.018, 0.012, 0.24, 8), pm(C.gun.shade, 'metal'), 0.1, 0.12, 0, { rz: 0.7 }); // bent barrel
  for (const sx of [-0.15, 0.15]) put(hullG, drum(0.05, 0.34, 9), pm(C.track.shade, 'metal'), sx, 0.03, 0, { rz: Math.PI / 2 }); // throwed tracks
  // debris
  for (let i = 0; i < 4; i++) put(root, rock(0.03, i + 3, 0.7), pm(C.track.base, 'metal'), (hash(i, 1) - 0.5) * 0.7, 0.02, (hash(i, 2) - 0.5) * 0.7);
  return pennant(root, 1, 0.36, -0.26, 0.26);
}

const BATTLE_BUILDERS = [campSandbagRedoubt, campWatchtower, campGunEmplacement, campTrenchLine, campWreck];

// ── service & strongpoint props ─────────────────────────────────────────────

function buildElite(root: THREE.Group): { flags: THREE.Object3D[][]; } {
  // a walled strongpoint: berm + concrete pillbox + AT gun + double pennants
  put(root, hull([[-0.42, 0.02, -0.42], [0.42, 0.02, -0.42], [-0.42, 0.02, 0.42], [0.42, 0.02, 0.42], [-0.3, 0.16, -0.3], [0.3, 0.16, -0.3], [-0.3, 0.16, 0.3], [0.3, 0.16, 0.3]], 'cmp|eliteberm'), pm(C.concrete.shade, 'matte'), 0, 0, 0);
  // pillbox
  put(root, lathe([[0.22, 0], [0.22, 0.14], [0.17, 0.18], [0.0001, 0.18]], 8), pm(C.concrete.base, 'matte'), -0.04, 0.16, -0.02);
  put(root, cbox(0.26, 0.04, 0.06, 0.01), pm(C.gun.shade, 'metal'), -0.04, 0.26, 0.12); // embrasure
  // AT gun on the parapet
  const at = new THREE.Group();
  at.position.set(0.2, 0.16, 0.16);
  at.rotation.y = -0.6;
  root.add(at);
  put(at, lathe([[0.06, 0], [0.05, 0.04], [0.0001, 0.04]], 8), pm(C.gun.shade, 'metal'), 0, 0, 0);
  put(at, cbox(0.1, 0.07, 0.12, 0.02), pm(C.steel.base), 0, 0.05, 0);
  put(at, barrel(0.018, 0.012, 0.3, 8), pm(C.gun.base, 'metal'), 0.06, 0.09, 0, { rz: 0.2 });
  sandbags(root, 0, 0, 0.4, -0.4, 1.6, 6);
  for (let i = 0; i < 3; i++) put(root, cbox(0.06, 0.16, 0.02, 0.006), pm(C.gun.shade, 'metal'), -0.3 + i * 0.04, 0.08, 0.42, { rz: 0.4 }); // wire pickets
  const flags = [pennant(root, 1, 0.46, -0.32, 0.3), pennant(root, 1, 0.4, 0.3, -0.32)];
  return { flags };
}

function buildBoss(root: THREE.Group, biome: Biome): { flags: THREE.Object3D[][]; beam: THREE.Mesh } {
  // the enemy citadel: keep on a raised motte, curtain wall, corner towers,
  // a searchlight and a crown of pennants
  put(root, hull([[-0.7, 0.02, -0.7], [0.7, 0.02, -0.7], [-0.7, 0.02, 0.7], [0.7, 0.02, 0.7], [-0.5, 0.2, -0.5], [0.5, 0.2, -0.5], [-0.5, 0.2, 0.5], [0.5, 0.2, 0.5]], 'cmp|motte'), pm(C.concrete.shade, 'matte'), 0, 0, 0);
  // curtain wall ring (4 segments) with crenellations
  for (const [sx, sz, ry, len] of [[0, -0.5, 0, 1.0], [0, 0.5, 0, 1.0], [-0.5, 0, Math.PI / 2, 1.0], [0.5, 0, Math.PI / 2, 1.0]] as const) {
    put(root, cbox(len, 0.18, 0.08, 0.02), pm(C.concrete.base, 'matte'), sx, 0.29, sz, { ry });
    for (let i = 0; i < 5; i++) put(root, cbox(0.08, 0.05, 0.08, 0.015), pm(C.concrete.lit, 'matte'), sx + Math.cos(ry + Math.PI / 2) * (-0.4 + i * 0.2), 0.4, sz + Math.sin(ry + Math.PI / 2) * (-0.4 + i * 0.2), { ry });
  }
  // corner towers
  const flags: THREE.Object3D[][] = [];
  for (const [tx, tz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) {
    put(root, lathe([[0.11, 0], [0.1, 0.34], [0.13, 0.36], [0.0001, 0.36]], 9), pm(C.concrete.base, 'matte'), tx, 0.2, tz);
    put(root, lathe([[0.13, 0], [0.0001, 0.1]], 9), pm(C.gun.shade, 'metal'), tx, 0.56, tz); // tower cap
    flags.push(pennant(root, 1, 0.26, tx, tz + 0.02));
  }
  // central keep
  put(root, cbox(0.42, 0.4, 0.42, 0.04), pm(C.concrete.lit, 'matte'), 0, 0.4, 0);
  put(root, cbox(0.46, 0.05, 0.46, 0.015), pm(C.gun.shade, 'metal'), 0, 0.62, 0); // parapet
  put(root, cbox(0.012, 0.08, 0.12, 0.004), pm(C.glass.shade, 'glass'), 0.215, 0.42, 0); // slit
  // gate (front +Z)
  put(root, cbox(0.16, 0.18, 0.03, 0.01), pm(C.timber.shade), 0, 0.11, 0.51);
  // searchlight on the keep
  const tower = new THREE.Group();
  tower.position.set(0, 0.66, 0);
  root.add(tower);
  put(tower, lathe([[0.05, 0], [0.05, 0.05], [0.07, 0.06], [0.0001, 0.06]], 10), pm(C.steel.base), 0, 0, 0);
  const lamp = pm(0xfff3d0, 'ore');
  put(tower, lathe([[0.06, 0], [0.06, 0.02], [0.0001, 0.02]], 10), lamp, 0, 0.06, 0.0, { rx: -0.3 });
  // beam (translucent cone)
  const beamMat = new THREE.MeshStandardMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.28, depthWrite: false, emissive: 0xffeeb8, emissiveIntensity: 0.7 });
  beamMat.userData.own = true;
  const beam = new THREE.Mesh(lathe([[0.0001, 0], [0.28, 0.9]], 12), beamMat);
  beam.castShadow = false;
  beam.position.set(0, 0.72, 0);
  beam.rotation.z = Math.PI / 2.2;
  root.add(beam);
  // big central pennant — mounted on the keep roof so it clears the keep mass (was buried inside it)
  const crownPole = new THREE.Group();
  crownPole.position.set(0.12, 0.64, -0.12);
  root.add(crownPole);
  flags.push(pennant(crownPole, 1, 0.3, 0, 0));
  if (biome.id === 'winter') for (const [tx, tz] of [[-0.5, -0.5], [0.5, 0.5]] as const) put(root, rock(0.14, tx * 7 + 3, 0.4), pm(C.snow.base), tx, 0.56, tz); // snow on towers
  return { flags, beam };
}

function buildShop(root: THREE.Group): THREE.Object3D[] {
  // supply depot: tarp hall, crate stacks, fuel drums, a parked truck cab
  put(root, cbox(0.4, 0.16, 0.3, 0.02), pm(C.concrete.base, 'matte'), -0.12, 0.08, -0.04); // store hut
  put(root, wedge(0.46, 0.1, 0.36, 0.2), pm(C.cloth.base, 'matte'), -0.12, 0.16, -0.04); // tarp roof
  put(root, cbox(0.42, 0.02, 0.32, 0.01), pm(C.cloth.shade, 'matte'), -0.12, 0.27, -0.04);
  crate(root, 0.16, 0.1, 0.14);
  crate(root, 0.18, 0.24, 0.12, C.olive.base);
  crate(root, 0.3, 0.14, 0.1, C.timber.shade);
  put(root, cbox(0.12, 0.12, 0.12, 0.02), pm(C.timber.base), 0.16, 0.18, 0.1); // top crate
  drumProp(root, 0.04, 0.28, C.ore.shade);
  drumProp(root, -0.34, 0.22, C.olive.shade);
  // truck cab + flatbed
  const truck = new THREE.Group();
  truck.position.set(0.18, 0, -0.28);
  truck.rotation.y = 0.5;
  root.add(truck);
  put(truck, cbox(0.14, 0.08, 0.2, 0.02), pm(C.olive.base), 0.08, 0.08, 0); // bed
  put(truck, cbox(0.1, 0.1, 0.16, 0.02), pm(C.olive.shade), -0.08, 0.09, 0); // cab
  put(truck, cbox(0.04, 0.05, 0.14, 0.01), pm(C.glass.shade, 'glass'), -0.13, 0.12, 0);
  for (const [wx, wz] of [[-0.08, 0.1], [-0.08, -0.1], [0.1, 0.1], [0.1, -0.1]] as const) put(truck, drum(0.045, 0.04, 10), pm(C.track.base, 'metal'), wx, 0.04, wz, { rx: -Math.PI / 2 });
  return pennant(root, 0, 0.34, -0.32, -0.16);
}

function buildForge(root: THREE.Group): { sparks: THREE.Mesh[] } {
  // field workshop: open awning, anvil, a tank under a repair gantry
  for (const [px, pz] of [[-0.34, -0.2], [0.0, -0.2], [-0.34, 0.2], [0.0, 0.2]] as const) put(root, cbox(0.025, 0.26, 0.025, 0.006), pm(C.timber.shade), px, 0.13, pz);
  put(root, wedge(0.46, 0.06, 0.5, 0.46), pm(C.cloth.shade, 'matte'), -0.17, 0.26, 0); // awning
  // tank under repair (hull + hoisted turret)
  put(root, cbox(0.26, 0.1, 0.18, 0.03), pm(C.olive.base), -0.16, 0.06, 0);
  put(root, drum(0.05, 0.26, 9), pm(C.track.shade, 'metal'), -0.16, 0.04, 0.1, { rz: Math.PI / 2 });
  const gantry = new THREE.Group();
  root.add(gantry);
  put(gantry, cbox(0.04, 0.22, 0.04, 0.01), pm(C.steel.shade), -0.16, 0.11, -0.18);
  put(gantry, cbox(0.04, 0.2, 0.04, 0.01), pm(C.steel.shade), -0.16, 0.1, 0.18);
  put(gantry, cbox(0.04, 0.04, 0.42, 0.01), pm(C.steel.base), -0.16, 0.22, 0); // crossbeam
  put(gantry, wedge(0.16, 0.06, 0.14, 0.1), pm(C.gun.base, 'metal'), -0.16, 0.13, 0); // hoisted turret
  put(gantry, cbox(0.01, 0.08, 0.01, 0.003), pm(C.gun.shade), -0.16, 0.18, 0); // hoist cable
  // anvil + tool bench
  put(root, cbox(0.06, 0.05, 0.03, 0.012), pm(C.gun.shade, 'metal'), 0.22, 0.04, 0.14);
  put(root, cbox(0.16, 0.06, 0.08, 0.015), pm(C.timber.base), 0.24, 0.04, -0.12);
  const sparks = [ember(root, 0.22, 0.08, 0.14, 0xffb347, 0.02), ember(root, -0.16, 0.16, 0, 0xff8c3a, 0.018)];
  return { sparks };
}

function buildLoot(root: THREE.Group): THREE.Mesh {
  // a cache: a half-buried container, crate stack, draped chute, a glint
  put(root, cbox(0.4, 0.16, 0.2, 0.02), pm(C.steel.base, 'metal'), 0.05, 0.05, 0.0, { ry: 0.2 }); // container, sunk
  put(root, cbox(0.4, 0.02, 0.2, 0.01), pm(C.steel.shade, 'metal'), 0.05, 0.14, 0, { ry: 0.2 });
  for (let i = 0; i < 3; i++) put(root, cbox(0.02, 0.12, 0.18, 0.004), pm(C.steel.shade, 'metal'), -0.1 + i * 0.1, 0.06, 0, { ry: 0.2 }); // ribs
  crate(root, -0.26, 0.16, 0.14);
  crate(root, -0.28, 0.06, 0.12, C.olive.base);
  put(root, cbox(0.12, 0.12, 0.12, 0.02), pm(C.timber.base), -0.26, 0.22, 0.14); // top crate
  // draped parachute
  put(root, lathe([[0.2, 0], [0.16, 0.06], [0.08, 0.1], [0.0001, 0.1]], 10), pm(C.foam.base, 'matte'), 0.24, 0.04, -0.18);
  const glint = ember(root, -0.26, 0.3, 0.14, 0xffe27a, 0.022);
  return glint;
}

function buildEvent(root: THREE.Group): { fire: THREE.Mesh } {
  // an encounter: a lone tent, a signpost, a campfire
  put(root, hull([[-0.16, 0, -0.12], [0.16, 0, -0.12], [-0.16, 0, 0.12], [0.16, 0, 0.12], [-0.16, 0.18, 0], [0.16, 0.18, 0]], 'cmp|tent'), pm(C.cloth.base, 'matte'), -0.18, 0, 0.0);
  put(root, cbox(0.34, 0.014, 0.04, 0.005), pm(C.cloth.shade, 'matte'), -0.18, 0.18, 0); // ridge
  // signpost
  put(root, cbox(0.025, 0.3, 0.025, 0.006), pm(C.timber.shade), 0.28, 0.15, -0.1);
  put(root, cbox(0.16, 0.05, 0.012, 0.004), pm(C.timber.base), 0.32, 0.24, -0.1, { ry: -0.2 });
  put(root, cbox(0.13, 0.045, 0.012, 0.004), pm(C.timber.base), 0.3, 0.17, -0.1, { ry: 0.3 });
  // campfire: log ring + embers
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    put(root, cbox(0.07, 0.02, 0.02, 0.006), pm(C.timber.shade), 0.16 + Math.cos(a) * 0.06, 0.012, 0.18 + Math.sin(a) * 0.06, { ry: a + Math.PI / 2 });
  }
  const fire = ember(root, 0.16, 0.02, 0.18, 0xff7a2a, 0.035);
  return { fire };
}

// ── public: node prop dispatcher ────────────────────────────────────────────

export function buildNodeProp(type: NodeType, seed: number, biome: Biome): PropHandle {
  const root = new THREE.Group();
  const groundLit = biome.slab('land', 0, 0);
  pad(root, groundLit, type === 'boss' ? 1.05 : type === 'elite' ? 0.78 : 0.62);

  let flags: THREE.Object3D[][] = [];
  let puffs: THREE.Group[] = [];
  let embers: THREE.Mesh[] = [];
  let beam: THREE.Mesh | null = null;

  switch (type) {
    case 'battle': {
      const v = Math.floor(hash(seed, 99) * BATTLE_VARIANTS) % BATTLE_VARIANTS;
      flags = [BATTLE_BUILDERS[v](root)];
      puffs = smoke(root, 0.04 + (hash(seed, 5) - 0.5) * 0.3, -0.02 + (hash(seed, 6) - 0.5) * 0.3);
      break;
    }
    case 'elite': {
      const e = buildElite(root);
      flags = e.flags;
      puffs = smoke(root, 0.0, -0.02);
      break;
    }
    case 'boss': {
      const b = buildBoss(root, biome);
      flags = b.flags;
      beam = b.beam;
      break;
    }
    case 'shop': flags = [buildShop(root)]; break;
    case 'forge': embers = buildForge(root).sparks; break;
    case 'loot': embers = [buildLoot(root)]; break;
    case 'event': embers = [buildEvent(root).fire]; break;
  }

  // biome dressing: snow load on winter props
  if (biome.id === 'winter') {
    for (let i = 0; i < 4; i++) put(root, rock(0.05 + hash(seed, 70 + i) * 0.04, i + 1, 0.3), pm(C.snow.lit), (hash(seed, 80 + i) - 0.5) * 0.7, 0.015, (hash(seed, 90 + i) - 0.5) * 0.7, { noCast: true });
  }

  function update(t: number): void {
    flags.forEach((f, i) => flutter(f, t, i * 1.3));
    if (puffs.length) driftSmoke(puffs, t);
    if (beam) beam.rotation.y = Math.sin(t * 0.5) * 0.6;
    embers.forEach((e, i) => e.scale.setScalar(0.85 + Math.sin(t * 4 + i * 2) * 0.25));
  }

  return { root, update };
}

// ── roads ────────────────────────────────────────────────────────────────────

function roadTone(biome: Biome): number {
  return biome.id === 'desert' ? C.clay.shade : biome.id === 'winter' ? C.frost.shade : C.timber.shade;
}

/**
 * Smooth lateral wander along a road, in roughly [-amp, amp], pinned to 0 at
 * both ends (t = 0 and t = 1) so the ribbon still meets the node centers. Two
 * offset sines seeded per-edge give an organic, non-repeating bend rather than
 * a ruler-straight line.
 */
function meander(t: number, amp: number, seed: number): number {
  const env = Math.sin(Math.PI * t); // 0 at the ends, 1 mid-span
  const p1 = hash(seed, 1) * 6.283;
  const p2 = hash(seed, 2) * 6.283;
  return env * amp * (Math.sin(t * 4.2 + p1) * 0.7 + Math.sin(t * 8.1 + p2) * 0.3);
}

/**
 * A winding dirt-road ribbon between two node centers. Built as short chamfered
 * slabs laid end-to-end along a meandering centerline (no ruler-straight rails),
 * dressed with broken off-axis scuffs and a few verge pebbles so it reads as a
 * natural country track rather than a railway.
 */
export function buildRoad(ax: number, az: number, bx: number, bz: number, biome: Biome, active: boolean): THREE.Group {
  const g = new THREE.Group();
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const ry = Math.atan2(dz, dx);
  g.position.set((ax + bx) / 2, TOP + 0.012, (az + bz) / 2);
  g.rotation.y = -ry; // group local +X runs A→B, local +Z is lateral
  const tone = roadTone(biome);
  const pebbleTone = biome.id === 'winter' ? C.frost.base : C.timber.shade;

  // deterministic per-edge seed → a road always bends & scatters the same way
  const seed = Math.abs(Math.round((ax * 71 + bx * 29 + az * 97 + bz * 13) * 100)) % 9973;
  const amp = Math.min(0.2, len * 0.12);
  const segs = Math.max(5, Math.round(len / 0.2));
  const segLen = len / segs;

  // sample the winding centerline in local space (+X = A→B, +Z = lateral)
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push({ x: -len / 2 + t * len, z: meander(t, amp, seed) });
  }

  // single shared glow material for the active-route highlight (own → disposable)
  let glow: THREE.MeshStandardMaterial | null = null;
  if (active) {
    glow = new THREE.MeshStandardMaterial({ color: 0xd9b25a, emissive: 0xc8923a, emissiveIntensity: 0.6, roughness: 0.5, transparent: true, opacity: 0.85 });
    glow.userData.own = true;
  }

  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[i + 1];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const sa = Math.atan2(b.z - a.z, b.x - a.x); // local tangent angle
    const w = 0.24 + Math.round(hash(seed, i * 3) * 3) * 0.03; // ragged width, quantized for the geo cache
    const bed = put(g, cbox(segLen * 1.25, 0.02, w, 0.008), pm(tone, 'matte'), mx, 0, mz, { ry: -sa, noCast: true });
    bed.receiveShadow = true;
    if (glow) put(g, cbox(segLen * 1.25, 0.024, 0.1, 0.006), glow, mx, 0.004, mz, { ry: -sa, noCast: true });
  }

  // a few pebbles strewn along the verges for a soft, natural edge
  for (let i = 1; i < segs; i += 2) {
    const p = pts[i];
    const sa = Math.atan2(pts[i + 1].z - pts[i - 1].z, pts[i + 1].x - pts[i - 1].x);
    const side = hash(seed, i * 7) < 0.5 ? -1 : 1;
    const d = 0.16 + hash(seed, i * 9) * 0.05;
    const r = 0.028 + Math.round(hash(seed, i * 5) * 2) * 0.014; // quantized radius for the geo cache
    put(g, rock(r, seed + i, 0.7), pm(pebbleTone, 'matte'), p.x - Math.sin(sa) * d * side, r * 0.35, p.z + Math.cos(sa) * d * side, { noCast: true });
  }
  return g;
}

// ── theater board ────────────────────────────────────────────────────────────

export interface BoardOpts {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  avoid: Array<{ x: number; z: number; r: number }>;
}

export interface BoardHandle {
  group: THREE.Group;
  update: (dt: number) => void;
}

/**
 * The campaign board: a biome-toned diorama block dressed with the same flora /
 * mountains / water as the battle terrain, with clearings kept open around the
 * nodes and roads. One merged chunk + one water sheet.
 */
export function buildTheaterBoard(biome: Biome, opts: BoardOpts): BoardHandle {
  const group = new THREE.Group();
  const pieces: THREE.BufferGeometry[] = [];
  const c0 = Math.floor(opts.minX - 1.5), c1 = Math.ceil(opts.maxX + 1.5);
  const r0 = Math.floor(opts.minZ - 1.5), r1 = Math.ceil(opts.maxZ + 1.5);
  const cx = (c0 + c1) / 2, cz = (r0 + r1) / 2;
  const w = c1 - c0 + 1.7, d = r1 - r0 + 1.7;

  // table frame + dark underside
  pieces.push(bake(cbox(w, 0.3, d, 0.06), C.timber.shade, cx, -0.18, cz));
  pieces.push(bake(cbox(w - 0.5, 0.1, d - 0.5, 0.03), C.oil.base, cx, -0.09, cz));

  const near = (x: number, z: number, pad = 0): boolean =>
    opts.avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + pad);

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const slabH = 0.1 + hash(c, r, 7) * 0.025;
      const edge = c <= c0 + 1 || c >= c1 - 1 || r <= r0 + 1 || r >= r1 - 1;
      const clear = near(c, r, 0.7);
      // dressing only off the lanes: forests/mountains on the margins & gaps
      let kind: 'land' | 'forest' | 'mountain' = 'land';
      if (!clear) {
        const v = hash(c, r, 301);
        if (edge && v < 0.5) kind = v < 0.18 ? 'mountain' : 'forest';
        else if (!edge && v < 0.16) kind = v < 0.05 ? 'mountain' : 'forest';
      }
      pieces.push(bake(cbox(0.985, slabH, 0.985, 0.02), biome.slab(kind, c, r), c, TOP - slabH / 2, r));
      if (kind === 'forest') biome.flora(pieces, c, r);
      else if (kind === 'mountain') biome.mountain(pieces, c, r);
      else if (!clear) biome.landDetail(pieces, c, r);
    }
  }

  // distant backdrop ridge along the far (low-Z) edge + sides
  const ridgeTone = biome.horizon;
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const bx = c0 - 0.5 + t * (c1 - c0 + 1);
    const bz = r0 - 1.4 - hash(i, 9) * 1.2;
    const h = 1.2 + hash(i, 11) * 1.8;
    pieces.push(bake(rock(0.7 + hash(i, 13) * 0.5, i + 1, h), ridgeTone, bx, -0.1, bz, hash(i, 15) * Math.PI));
  }
  for (const sx of [c0 - 1.4, c1 + 1.4]) {
    for (let i = 0; i < 8; i++) {
      const bz = r0 + (i / 7) * (r1 - r0);
      pieces.push(bake(rock(0.6 + hash(i, sx) * 0.4, i + 30, 1.3 + hash(i, sx + 1) * 1.2), ridgeTone, sx, -0.1, bz, hash(i, sx + 2) * Math.PI));
    }
  }

  // cliff skirts around the board rectangle
  const skirtPiece = (x0: number, z0: number, x1: number, z1: number, key: string): THREE.BufferGeometry => {
    const out = 0.55;
    const nx = z1 - z0, nz = -(x1 - x0);
    const len = Math.hypot(nx, nz);
    const ox = (nx / len) * out, oz = (nz / len) * out;
    return hull([[x0, TOP - 0.02, z0], [x1, TOP - 0.02, z1], [x0 + ox, -0.1, z0 + oz], [x1 + ox, -0.1, z1 + oz], [x0, -0.1, z0], [x1, -0.1, z1]], key);
  };
  const X0 = c0 - 0.5, X1 = c1 + 0.5, Z0 = r0 - 0.5, Z1 = r1 + 0.5;
  pieces.push(bake(skirtPiece(X0, Z0, X1, Z0, 'cb|n'), biome.skirt[0], 0, 0, 0));
  pieces.push(bake(skirtPiece(X1, Z0, X1, Z1, 'cb|e'), biome.skirt[1], 0, 0, 0));
  pieces.push(bake(skirtPiece(X1, Z1, X0, Z1, 'cb|s'), biome.skirt[0], 0, 0, 0));
  pieces.push(bake(skirtPiece(X0, Z1, X0, Z0, 'cb|w'), biome.skirt[1], 0, 0, 0));

  const chunk = mergeChunk(pieces, vertexMat());
  if (chunk) {
    // mergeChunk flags the merged geometry userData.shared (right for the long-lived
    // battle terrain, wrong here): the campaign board is a one-off rebuilt every
    // render, so clear the flag and let disposeGroup free its buffer. The material
    // (vertexMat) stays shared/cached and is never disposed.
    chunk.geometry.userData.shared = false;
    chunk.geometry.userData.own = true;
    group.add(chunk);
  }

  return { group, update: () => {} };
}
