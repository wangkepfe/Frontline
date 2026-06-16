import * as THREE from 'three';
import { C } from './palette';
import { bake, blob, cbox, hash, lathe, rock, wedge } from './kit';
import type { StudioOpts } from './stage';

/**
 * Biome descriptors (ART_DIRECTION addendum). Three terrains share one kit and
 * one lighting rig, retoned per act of the campaign:
 *   temperate — the original green river delta (act I, also every skirmish/
 *               tutorial/MP battle: the TEMPERATE biome reproduces the old
 *               terrain.ts art BYTE-FOR-BYTE so nothing regresses).
 *   desert    — sun-bleached badlands: dunes, red mesas, cacti, dry wadis.
 *   winter    — frozen highlands: snowfields, slate crags, ice river, the
 *               enemy capital.
 *
 * A Biome supplies the tone of each terrain slab plus the flora / mountain /
 * land-detail props and the water sheet. terrain.ts owns the board STRUCTURE
 * (slabs, bridges, banks, skirts, gold/oil seams — those read the same in any
 * biome); the Biome only retones and re-vegetates it. Nothing here imports
 * terrain.ts, so there is no cycle.
 */

export type BiomeId = 'temperate' | 'desert' | 'winter';
export type TerrainKind = 'land' | 'forest' | 'mountain' | 'water' | 'bridge' | 'gold' | 'oil';
type Piece = THREE.BufferGeometry;

/** must equal terrain.ts TILE_TOP — the slab-top plane every prop sits on */
const TOP = 0.1;

export interface Biome {
  id: BiomeId;
  /** act name + one-line flavor for the transition splash */
  name: string;
  flavor: string;
  /** lamps/sky retone for studio() */
  studio: StudioOpts;
  /** slab top tone for an open/forest/mountain/oil tile */
  slab: (t: TerrainKind, c: number, r: number) => number;
  /** vegetate a whole forest tile (owns its own scatter loop) */
  flora: (out: Piece[], c: number, r: number) => void;
  /** the crag / mesa / snow-peak cluster on a mountain tile */
  mountain: (out: Piece[], c: number, r: number) => void;
  /** sparse rocks / tufts so open ground isn't dead flat */
  landDetail: (out: Piece[], c: number, r: number) => void;
  /** cliff-skirt tones [N&S, E&W] */
  skirt: [number, number];
  /** river bank earth + the foam line at its lip */
  bank: number;
  foam: number;
  /** the water/ice sheet */
  water: { texture: () => THREE.CanvasTexture; roughness: number; metalness: number; drift: number };
  /** distant horizon-silhouette tone for the campaign backdrop */
  horizon: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPERATE — verbatim port of the original terrain.ts art (do not "improve").
// ─────────────────────────────────────────────────────────────────────────────

function temperateTree(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  const trunkH = 0.16 * scale;
  out.push(bake(lathe([[0.028, 0], [0.018, trunkH], [0.0001, trunkH]], 6), C.timber.shade, x, TOP, z));
  out.push(bake(blob(0.155, (seed % 7) + 1, 0.82), C.canopy.base, x, TOP + trunkH + 0.1 * scale, z, hash(seed, 1) * Math.PI, scale));
  out.push(bake(blob(0.095, (seed % 5) + 11, 0.8), C.canopy.lit, x - 0.035 * scale, TOP + trunkH + 0.16 * scale, z - 0.02 * scale, hash(seed, 2) * Math.PI, scale));
}

function temperateConifer(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  out.push(bake(lathe([[0.024, 0], [0.016, 0.1], [0.0001, 0.1]], 6), C.timber.shade, x, TOP, z, 0, scale));
  const tones = [C.canopy.shade, C.canopy.base, C.canopy.lit];
  for (let i = 0; i < 3; i++) {
    const r = (0.14 - i * 0.035) * scale;
    const h = 0.14 * scale;
    const y = TOP + (0.07 + i * 0.085) * scale;
    out.push(bake(lathe([[r, 0], [0.0001, h]], 7), tones[Math.min(i, 2)], x, y, z, hash(seed, 20 + i) * Math.PI));
  }
}

function temperateFlora(out: Piece[], c: number, r: number): void {
  const n = 3 + Math.floor(hash(c, r, 1) * 2);
  for (let i = 0; i < n; i++) {
    const q = i % 4;
    const px = c + (q % 2 === 0 ? -0.22 : 0.22) + (hash(c, r, 20 + i) - 0.5) * 0.3;
    const pz = r + (q < 2 ? -0.22 : 0.22) + (hash(c, r, 30 + i) - 0.5) * 0.3;
    const scale = 0.75 + hash(c, r, 10 + i) * 0.5;
    if (hash(c, r, 40 + i) < 0.6) temperateTree(out, px, pz, c * 31 + r * 7 + i, scale);
    else temperateConifer(out, px, pz, c * 17 + r * 13 + i, scale);
  }
}

function temperateMountain(out: Piece[], c: number, r: number): void {
  const h1 = 1.35 + hash(c, r, 50) * 0.55;
  out.push(bake(rock(0.3, ((c * 7 + r) % 13) + 1, h1), C.crag.base, c + (hash(c, r, 51) - 0.5) * 0.3, TOP + 0.12, r + (hash(c, r, 52) - 0.5) * 0.3, hash(c, r, 53) * Math.PI));
  out.push(bake(rock(0.22, ((c * 11 + r) % 13) + 2, h1 * 0.75), C.crag.lit, c + (hash(c, r, 54) - 0.5) * 0.5, TOP + 0.08, r + (hash(c, r, 55) - 0.5) * 0.5, hash(c, r, 56) * Math.PI));
  out.push(bake(rock(0.13, ((c * 5 + r) % 13) + 3, 0.9), C.ochre.shade, c + (hash(c, r, 57) - 0.5) * 0.6, TOP + 0.04, r + (hash(c, r, 58) - 0.5) * 0.6));
  for (let i = 0; i < 3; i++) {
    out.push(bake(rock(0.045, i + 4, 0.7), C.crag.shade, c + (hash(c, r, 60 + i) - 0.5) * 0.8, TOP + 0.01, r + (hash(c, r, 70 + i) - 0.5) * 0.8));
  }
}

function temperateLand(out: Piece[], c: number, r: number): void {
  const v = hash(c, r, 200);
  if (v < 0.07) {
    out.push(bake(rock(0.05 + v * 0.4, ((c + r * 3) % 11) + 1, 0.7), C.crag.lit, c + (hash(c, r, 210) - 0.5) * 0.6, TOP + 0.015, r + (hash(c, r, 211) - 0.5) * 0.6));
  } else if (v < 0.2) {
    for (let i = 0; i < 3; i++) {
      out.push(bake(lathe([[0.018, 0], [0.0001, 0.05 + hash(c, r, 220 + i) * 0.03]], 5), i === 1 ? C.sage.lit : C.sage.base, c + (hash(c, r, 230 + i) - 0.5) * 0.5, TOP, r + (hash(c, r, 240 + i) - 0.5) * 0.5));
    }
  }
}

function temperateWater(): THREE.CanvasTexture {
  return streakWater(['#2a5d68', '#2e6470', '#27545f'], 'rgba(216,205,169,0.16)', 'rgba(120,190,200,0.13)');
}

const TEMPERATE_SAND = [C.sand.base, C.sand.lit, C.sand.shade];

// ─────────────────────────────────────────────────────────────────────────────
// DESERT — badlands: dunes, mesas, cacti, dry wadis.
// ─────────────────────────────────────────────────────────────────────────────

function desertCactus(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  const h = (0.24 + hash(seed, 3) * 0.12) * scale;
  out.push(bake(lathe([[0.04, 0], [0.046, 0.02], [0.042, h * 0.85], [0.03, h], [0.0001, h]], 8), C.cactus.base, x, TOP, z));
  out.push(bake(lathe([[0.018, 0], [0.022, 0.01], [0.0001, 0.022]], 6), C.cactus.shade, x, TOP + h, z)); // crown
  const arms = hash(seed, 5) < 0.55 ? 2 : 1;
  for (let a = 0; a < arms; a++) {
    const side = a === 0 ? 1 : -1;
    const ay = TOP + h * (0.42 + hash(seed, 7 + a) * 0.2);
    out.push(bake(cbox(0.05, 0.024, 0.024, 0.008), C.cactus.shade, x + side * 0.035, ay, z, 0));
    out.push(bake(lathe([[0.02, 0], [0.022, 0.02], [0.0001, 0.09 * scale]], 6), C.cactus.base, x + side * 0.062, ay, z));
  }
}

function desertShrub(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  const tones = [C.scrub.shade, C.scrub.base, C.dune.shade];
  const n = 4 + Math.floor(hash(seed, 9) * 3);
  for (let i = 0; i < n; i++) {
    const a = hash(seed, 30 + i) * Math.PI * 2;
    const len = (0.06 + hash(seed, 40 + i) * 0.05) * scale;
    out.push(bake(lathe([[0.008, 0], [0.0001, len]], 4), tones[i % 3], x + Math.cos(a) * 0.02, TOP, z + Math.sin(a) * 0.02, 0, 1));
  }
}

function desertFlora(out: Piece[], c: number, r: number): void {
  const n = 2 + Math.floor(hash(c, r, 1) * 3);
  for (let i = 0; i < n; i++) {
    const q = i % 4;
    const px = c + (q % 2 === 0 ? -0.24 : 0.24) + (hash(c, r, 20 + i) - 0.5) * 0.32;
    const pz = r + (q < 2 ? -0.24 : 0.24) + (hash(c, r, 30 + i) - 0.5) * 0.32;
    const scale = 0.8 + hash(c, r, 10 + i) * 0.5;
    const seed = c * 31 + r * 7 + i;
    const v = hash(c, r, 40 + i);
    if (v < 0.4) desertCactus(out, px, pz, seed, scale);
    else if (v < 0.82) desertShrub(out, px, pz, seed, scale);
    else out.push(bake(rock(0.06 + hash(seed, 2) * 0.05, (seed % 9) + 1, 0.6), C.dune.shade, px, TOP + 0.02, pz)); // bleached boulder
  }
}

/**
 * One eroded red butte: a battered talus apron grounds it, a tapered cliff body
 * carries pale sedimentary strata, a hard caprock overhangs the top, and a lower
 * companion spur breaks the silhouette. Brown clay tones in the lower mass keep
 * it from reading as one saturated red slab; the red is reserved for the cliff.
 */
function desertMesa(out: Piece[], cx: number, cz: number, seed: number, scale: number): void {
  const ry = hash(seed, 1) * Math.PI;
  const bw = (0.58 + hash(seed, 2) * 0.16) * scale;     // cliff base width
  const cliffH = (0.6 + hash(seed, 3) * 0.42) * scale;  // main cliff height
  const topW = bw * 0.82;

  // talus: two wide, low, battered scree skirts so the butte settles into the
  // ground instead of sitting on it like a box
  out.push(bake(wedge(bw * 1.5, cliffH * 0.2, bw * 1.5, bw * 1.06), C.clay.shade, cx, TOP, cz, ry));
  out.push(bake(wedge(bw * 1.16, cliffH * 0.3, bw * 1.16, bw * 0.92), C.clay.base, cx, TOP + cliffH * 0.04, cz, ry));

  // cliff body, gently tapered, sitting on the talus (darker red lower, mid up)
  const bodyY = TOP + cliffH * 0.16;
  out.push(bake(wedge(bw, cliffH * 0.46, bw, bw - (bw - topW) * 0.46), C.mesa.shade, cx, bodyY, cz, ry));
  out.push(bake(wedge(bw - (bw - topW) * 0.46, cliffH * 0.54, bw - (bw - topW) * 0.46, topW), C.mesa.base, cx, bodyY + cliffH * 0.46, cz, ry));

  // painted sedimentary strata wrapping the cliff face — pale bands that catch
  // the key light and read as layered rock
  const strata = [C.dune.lit, C.ochre.lit, C.clay.lit];
  for (let i = 0; i < 3; i++) {
    const f = 0.24 + i * 0.24;
    const w = bw - (bw - topW) * f + 0.02;
    out.push(bake(cbox(w, cliffH * 0.05, w, 0.012), strata[i], cx, bodyY + cliffH * f, cz, ry));
  }

  // hard caprock: a flat slab overhanging the cliff top — the mesa signature
  const capY = bodyY + cliffH;
  out.push(bake(cbox(topW + 0.08, cliffH * 0.08, topW + 0.08, 0.022), C.ochre.base, cx, capY, cz, ry));

  // a lower companion spur offset to one side for an eroded, asymmetric profile
  const sa = ry + 1.4 + hash(seed, 4) * 1.4;
  const sx = cx + Math.cos(sa) * bw * 0.92, sz = cz + Math.sin(sa) * bw * 0.92;
  const spurH = cliffH * (0.36 + hash(seed, 5) * 0.2);
  out.push(bake(wedge(bw * 0.52, spurH * 0.22, bw * 0.52, bw * 0.4), C.clay.shade, sx, TOP, sz, sa));
  out.push(bake(wedge(bw * 0.42, spurH, bw * 0.42, bw * 0.3), C.mesa.base, sx, TOP + spurH * 0.04, sz, sa));
  out.push(bake(cbox(bw * 0.38, spurH * 0.05, bw * 0.38, 0.012), C.dune.lit, sx, TOP + spurH * 0.5, sz, sa)); // strata band
  out.push(bake(cbox(bw * 0.34, spurH * 0.08, bw * 0.34, 0.016), C.ochre.base, sx, TOP + spurH * 1.02, sz, sa));

  // scree boulders tumbled at the foot
  for (let i = 0; i < 5; i++) {
    out.push(bake(rock(0.04 + hash(seed, 60 + i) * 0.035, i + 4, 0.55), i % 2 ? C.mesa.shade : C.clay.shade, cx + (hash(seed, 70 + i) - 0.5) * bw * 1.7, TOP + 0.01, cz + (hash(seed, 80 + i) - 0.5) * bw * 1.7));
  }
}

function desertMountain(out: Piece[], c: number, r: number): void {
  const scale = 0.94 + hash(c, r, 50) * 0.3;
  desertMesa(out, c, r, (c * 7 + r) * 13 + 1, scale);
}

function desertLand(out: Piece[], c: number, r: number): void {
  const v = hash(c, r, 200);
  if (v < 0.1) {
    out.push(bake(rock(0.05 + v * 0.35, ((c + r * 3) % 11) + 1, 0.55), C.mesa.shade, c + (hash(c, r, 210) - 0.5) * 0.6, TOP + 0.012, r + (hash(c, r, 211) - 0.5) * 0.6));
  } else if (v < 0.2) {
    desertShrub(out, c + (hash(c, r, 215) - 0.5) * 0.5, r + (hash(c, r, 216) - 0.5) * 0.5, c * 31 + r, 0.7);
  }
}

function desertWater(): THREE.CanvasTexture {
  return streakWater(['#3f6a52', '#4a7a5e', '#3a624c'], 'rgba(212,189,134,0.18)', 'rgba(150,180,150,0.12)');
}

const DESERT_SAND = [C.dune.base, C.dune.lit, C.dune.shade];

// ─────────────────────────────────────────────────────────────────────────────
// WINTER — frozen highlands: snowfields, slate crags, ice river.
// ─────────────────────────────────────────────────────────────────────────────

function winterPine(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  out.push(bake(lathe([[0.024, 0], [0.016, 0.1], [0.0001, 0.1]], 6), C.timber.shade, x, TOP, z, 0, scale));
  for (let i = 0; i < 3; i++) {
    const r = (0.14 - i * 0.035) * scale;
    const h = 0.15 * scale;
    const y = TOP + (0.07 + i * 0.085) * scale;
    out.push(bake(lathe([[r, 0], [0.0001, h]], 7), C.pine.base, x, y, z, hash(seed, 20 + i) * Math.PI));
    // snow load resting on each tier
    out.push(bake(lathe([[r * 0.74, 0], [0.0001, h * 0.5]], 7), C.snow.lit, x, y + h * 0.12, z, hash(seed, 25 + i) * Math.PI));
  }
}

function winterBareTree(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  const trunkH = 0.17 * scale;
  out.push(bake(lathe([[0.026, 0], [0.016, trunkH], [0.0001, trunkH]], 6), C.timber.shade, x, TOP, z));
  const n = 4 + Math.floor(hash(seed, 9) * 3);
  for (let i = 0; i < n; i++) {
    const a = hash(seed, 30 + i) * Math.PI * 2;
    const len = (0.07 + hash(seed, 40 + i) * 0.05) * scale;
    out.push(bake(lathe([[0.009, 0], [0.0001, len]], 4), C.timber.base, x + Math.cos(a) * 0.02, TOP + trunkH * (0.5 + hash(seed, 45 + i) * 0.4), z + Math.sin(a) * 0.02, 0, 1));
  }
  out.push(bake(blob(0.08, (seed % 5) + 2, 0.55), C.snow.base, x, TOP + trunkH + 0.02 * scale, z, hash(seed, 1) * Math.PI, scale * 0.8)); // snow cap
}

function winterFlora(out: Piece[], c: number, r: number): void {
  const n = 3 + Math.floor(hash(c, r, 1) * 2);
  for (let i = 0; i < n; i++) {
    const q = i % 4;
    const px = c + (q % 2 === 0 ? -0.22 : 0.22) + (hash(c, r, 20 + i) - 0.5) * 0.3;
    const pz = r + (q < 2 ? -0.22 : 0.22) + (hash(c, r, 30 + i) - 0.5) * 0.3;
    const scale = 0.78 + hash(c, r, 10 + i) * 0.5;
    const seed = c * 31 + r * 7 + i;
    if (hash(c, r, 40 + i) < 0.72) winterPine(out, px, pz, seed, scale);
    else winterBareTree(out, px, pz, seed, scale);
  }
}

function winterMountain(out: Piece[], c: number, r: number): void {
  const h1 = 1.4 + hash(c, r, 50) * 0.6;
  out.push(bake(rock(0.3, ((c * 7 + r) % 13) + 1, h1), C.slate.base, c + (hash(c, r, 51) - 0.5) * 0.3, TOP + 0.12, r + (hash(c, r, 52) - 0.5) * 0.3, hash(c, r, 53) * Math.PI));
  out.push(bake(rock(0.18, ((c * 3 + r) % 13) + 4, h1 * 0.6), C.snow.lit, c + (hash(c, r, 51) - 0.5) * 0.3, TOP + 0.12 + 0.36 * h1, r + (hash(c, r, 52) - 0.5) * 0.3, hash(c, r, 53) * Math.PI)); // snow cap on the spire
  out.push(bake(rock(0.22, ((c * 11 + r) % 13) + 2, h1 * 0.7), C.slate.lit, c + (hash(c, r, 54) - 0.5) * 0.5, TOP + 0.08, r + (hash(c, r, 55) - 0.5) * 0.5, hash(c, r, 56) * Math.PI));
  for (let i = 0; i < 3; i++) {
    out.push(bake(rock(0.05, i + 4, 0.6), C.snow.base, c + (hash(c, r, 60 + i) - 0.5) * 0.8, TOP + 0.01, r + (hash(c, r, 70 + i) - 0.5) * 0.8)); // snow drifts at the foot
  }
}

function winterLand(out: Piece[], c: number, r: number): void {
  const v = hash(c, r, 200);
  if (v < 0.08) {
    out.push(bake(rock(0.05 + v * 0.4, ((c + r * 3) % 11) + 1, 0.55), C.slate.lit, c + (hash(c, r, 210) - 0.5) * 0.6, TOP + 0.012, r + (hash(c, r, 211) - 0.5) * 0.6));
  } else if (v < 0.22) {
    // a low snow drift mound
    out.push(bake(blob(0.1 + v * 0.2, ((c * 5 + r) % 7) + 1, 0.32), C.snow.lit, c + (hash(c, r, 212) - 0.5) * 0.5, TOP, r + (hash(c, r, 213) - 0.5) * 0.5));
  }
}

function winterWater(): THREE.CanvasTexture {
  // ice sheet: pale blue with hairline cracks, near-static
  const W = 256, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#a6cdda');
  base.addColorStop(0.5, '#bcdde7');
  base.addColorStop(1, '#a0c6d4');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const x = hash(i, 11) * W, y = hash(i, 13) * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) ctx.lineTo(x + (hash(i, 20 + s) - 0.5) * 60, y + (hash(i, 30 + s) - 0.5) * 26);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 18; i++) ctx.fillRect(hash(i, 41) * W, hash(i, 43) * H, 2 + hash(i, 45) * 5, 1.4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2.2, 1);
  return tex;
}

const WINTER_SNOW = [C.snow.base, C.snow.lit, C.snow.shade];

// ── shared water-texture helper (painted current streaks) ───────────────────

function streakWater(stops: [string, string, string], warm: string, cool: string): THREE.CanvasTexture {
  const W = 256, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, stops[0]);
  base.addColorStop(0.5, stops[1]);
  base.addColorStop(1, stops[2]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const y = hash(i, 3) * H;
    const len = 24 + hash(i, 5) * 60;
    const x = hash(i, 7) * W;
    ctx.fillStyle = i % 3 === 0 ? warm : cool;
    ctx.fillRect(x, y, len, 1.6 + hash(i, 9) * 1.6);
    if (x + len > W) ctx.fillRect(x - W, y, len, 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2.2, 1);
  return tex;
}

// ── descriptors ──────────────────────────────────────────────────────────────

export const BIOMES: Record<BiomeId, Biome> = {
  temperate: {
    id: 'temperate',
    name: 'THE GREEN FRONT',
    flavor: 'River deltas and pine ridges. Where the war began.',
    studio: {}, // golden-hour defaults, unchanged
    slab: (t, c, r) =>
      t === 'forest' ? (hash(c, r) > 0.5 ? C.sage.base : C.sage.shade) :
      t === 'mountain' ? C.crag.shade :
      t === 'oil' ? C.sage.shade :
      TEMPERATE_SAND[Math.floor(hash(c, r) * 2.99)],
    flora: temperateFlora,
    mountain: temperateMountain,
    landDetail: temperateLand,
    skirt: [C.crag.shade, C.crag.base],
    bank: C.ochre.base,
    foam: C.foam.base,
    water: { texture: temperateWater, roughness: 0.45, metalness: 0.05, drift: 0.012 },
    horizon: 0x55663f
  },
  desert: {
    id: 'desert',
    name: 'THE DUST FRONT',
    flavor: 'Sun-scorched badlands. Mesas, wadis, and the long dry road.',
    studio: {
      background: 0x1b150f,
      feltColor: 0x322619,
      sunColor: 0xffe2a8,
      sunIntensity: 2.4,
      hemiSky: 0xbcc0c4,  // near-neutral cool fill — restores the warm-key/cool-shadow split (was all-warm yellow)
      hemiGround: 0x7a5e38,
      rimColor: 0xc99a64,
      rimIntensity: 0.5,
      environmentIntensity: 0.52
    },
    slab: (t, c, r) =>
      t === 'forest' ? (hash(c, r) > 0.5 ? C.clay.base : C.clay.shade) :
      t === 'mountain' ? C.mesa.shade :
      t === 'oil' ? C.clay.shade :
      DESERT_SAND[Math.floor(hash(c, r) * 2.99)],
    flora: desertFlora,
    mountain: desertMountain,
    landDetail: desertLand,
    skirt: [C.mesa.shade, C.clay.shade],
    bank: C.clay.base,
    foam: C.dune.lit,
    water: { texture: desertWater, roughness: 0.5, metalness: 0.04, drift: 0.009 },
    horizon: 0xb6884f
  },
  winter: {
    id: 'winter',
    name: 'THE IRON WINTER',
    flavor: 'Frozen highlands at the enemy capital. The last front.',
    studio: {
      background: 0x121821,
      feltColor: 0x222a32,
      sunColor: 0xecf2ff,
      sunIntensity: 1.85,
      hemiSky: 0xccdcef,
      hemiGround: 0x4a5460,
      rimColor: 0xa2c2e2,
      rimIntensity: 0.72,
      environmentIntensity: 0.55
    },
    slab: (t, c, r) =>
      t === 'forest' ? (hash(c, r) > 0.5 ? C.snow.shade : C.frost.base) :
      t === 'mountain' ? C.slate.shade :
      t === 'oil' ? C.frost.shade :
      WINTER_SNOW[Math.floor(hash(c, r) * 2.99)],
    flora: winterFlora,
    mountain: winterMountain,
    landDetail: winterLand,
    skirt: [C.slate.shade, C.frost.shade],
    bank: C.frost.base,
    foam: C.snow.lit,
    water: { texture: winterWater, roughness: 0.82, metalness: 0.06, drift: 0 },
    horizon: 0xb6c6d6
  }
};

export const TEMPERATE = BIOMES.temperate;

export function biomeById(id: BiomeId | undefined): Biome {
  return id ? BIOMES[id] : TEMPERATE;
}
