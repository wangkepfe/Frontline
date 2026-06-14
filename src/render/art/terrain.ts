import * as THREE from 'three';
import { GameMap, MAP_H, MAP_W } from '../../sim/map';
import { C, pm, vertexMat } from './palette';
import { bake, blob, cbox, hash, hull, lathe, mergeChunk, rock } from './kit';

/**
 * The war table. All static terrain bakes into ONE vertex-colored merged mesh
 * (a single draw call); the board sits as a raised diorama block on a timber
 * table frame, with cut-earth cliff skirts at the edges. The only motion is
 * the river's slow drift — the world breathes, nothing performs.
 */

export const TILE_TOP = 0.1;

export interface TerrainHandle {
  group: THREE.Group;
  update: (dt: number) => void;
}

// ── water texture (painted streaks, drifts via uv offset) ───────────────────

function waterTexture(): THREE.CanvasTexture {
  const W = 256, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#2a5d68');
  base.addColorStop(0.5, '#2e6470');
  base.addColorStop(1, '#27545f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // current streaks
  for (let i = 0; i < 26; i++) {
    const y = hash(i, 3) * H;
    const len = 24 + hash(i, 5) * 60;
    const x = hash(i, 7) * W;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(216,205,169,0.16)' : 'rgba(120,190,200,0.13)';
    ctx.fillRect(x, y, len, 1.6 + hash(i, 9) * 1.6);
    if (x + len > W) ctx.fillRect(x - W, y, len, 1.5); // wrap seam
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2.2, 1);
  return tex;
}

// ── flora & props (baked pieces) ────────────────────────────────────────────

type Piece = THREE.BufferGeometry;

/** Deciduous: tapered trunk + 2-tone canopy (shadow mass + lit cap). */
function bakeTree(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  const trunkH = 0.16 * scale;
  out.push(bake(lathe([[0.028, 0], [0.018, trunkH], [0.0001, trunkH]], 6), C.timber.shade, x, TILE_TOP, z));
  out.push(bake(blob(0.155, (seed % 7) + 1, 0.82), C.canopy.base, x, TILE_TOP + trunkH + 0.1 * scale, z, hash(seed, 1) * Math.PI, scale));
  out.push(
    bake(blob(0.095, (seed % 5) + 11, 0.8), C.canopy.lit, x - 0.035 * scale, TILE_TOP + trunkH + 0.16 * scale, z - 0.02 * scale, hash(seed, 2) * Math.PI, scale)
  );
}

/** Conifer: stacked cones, darker. */
function bakeConifer(out: Piece[], x: number, z: number, seed: number, scale: number): void {
  out.push(bake(lathe([[0.024, 0], [0.016, 0.1], [0.0001, 0.1]], 6), C.timber.shade, x, TILE_TOP, z, 0, scale));
  const tones = [C.canopy.shade, C.canopy.base, C.canopy.lit];
  for (let i = 0; i < 3; i++) {
    const r = (0.14 - i * 0.035) * scale;
    const h = 0.14 * scale;
    const y = TILE_TOP + (0.07 + i * 0.085) * scale;
    out.push(bake(lathe([[r, 0], [0.0001, h]], 7), tones[Math.min(i, 2)], x, y, z, hash(seed, 20 + i) * Math.PI));
  }
}

// ── the board ───────────────────────────────────────────────────────────────

export function buildTerrain(map: GameMap): TerrainHandle {
  const group = new THREE.Group();
  const pieces: Piece[] = [];
  const cx = (MAP_W - 1) / 2;
  const cz = (MAP_H - 1) / 2;

  // ── the table itself: timber frame + dark underside (below the waterline) ──
  const frameW = MAP_W + 1.7;
  pieces.push(bake(cbox(frameW, 0.3, MAP_H + 1.7, 0.06), C.timber.shade, cx, -0.18, cz));
  pieces.push(bake(cbox(frameW - 0.5, 0.1, MAP_H + 1.2, 0.03), C.oil.base, cx, -0.09, cz));

  // ── tiles ──
  const sandTones = [C.sand.base, C.sand.lit, C.sand.shade];
  for (let r = 0; r < MAP_H; r++) {
    for (let c = 0; c < MAP_W; c++) {
      const t = map.terrainAt(c, r);
      if (t === 'water') continue; // the river handles itself

      const slabH = 0.1 + hash(c, r, 7) * 0.025;
      const groundTone =
        t === 'forest' ? (hash(c, r) > 0.5 ? C.sage.base : C.sage.shade) :
        t === 'mountain' ? C.crag.shade :
        t === 'oil' ? C.sage.shade :
        sandTones[Math.floor(hash(c, r) * 2.99)];
      if (t !== 'bridge') {
        pieces.push(bake(cbox(0.985, slabH, 0.985, 0.02), groundTone, c, TILE_TOP - slabH / 2, r));
      }

      if (t === 'forest') {
        const n = 3 + Math.floor(hash(c, r, 1) * 2);
        for (let i = 0; i < n; i++) {
          const q = i % 4;
          const px = c + (q % 2 === 0 ? -0.22 : 0.22) + (hash(c, r, 20 + i) - 0.5) * 0.3;
          const pz = r + (q < 2 ? -0.22 : 0.22) + (hash(c, r, 30 + i) - 0.5) * 0.3;
          const scale = 0.75 + hash(c, r, 10 + i) * 0.5;
          if (hash(c, r, 40 + i) < 0.6) bakeTree(pieces, px, pz, c * 31 + r * 7 + i, scale);
          else bakeConifer(pieces, px, pz, c * 17 + r * 13 + i, scale);
        }
      } else if (t === 'mountain') {
        // crag cluster: two spires + a weathered ochre stratum boulder + scree
        const h1 = 1.35 + hash(c, r, 50) * 0.55;
        pieces.push(bake(rock(0.3, (c * 7 + r) % 13 + 1, h1), C.crag.base, c + (hash(c, r, 51) - 0.5) * 0.3, TILE_TOP + 0.12, r + (hash(c, r, 52) - 0.5) * 0.3, hash(c, r, 53) * Math.PI));
        pieces.push(bake(rock(0.22, (c * 11 + r) % 13 + 2, h1 * 0.75), C.crag.lit, c + (hash(c, r, 54) - 0.5) * 0.5, TILE_TOP + 0.08, r + (hash(c, r, 55) - 0.5) * 0.5, hash(c, r, 56) * Math.PI));
        pieces.push(bake(rock(0.13, (c * 5 + r) % 13 + 3, 0.9), C.ochre.shade, c + (hash(c, r, 57) - 0.5) * 0.6, TILE_TOP + 0.04, r + (hash(c, r, 58) - 0.5) * 0.6));
        for (let i = 0; i < 3; i++) {
          pieces.push(bake(rock(0.045, i + 4, 0.7), C.crag.shade, c + (hash(c, r, 60 + i) - 0.5) * 0.8, TILE_TOP + 0.01, r + (hash(c, r, 70 + i) - 0.5) * 0.8));
        }
      } else if (t === 'gold') {
        // crystalline seam: faceted nuggets + one standing crystal
        for (let i = 0; i < 4; i++) {
          const tone = [C.ore.base, C.ore.lit, C.ore.shade, C.ore.base][i];
          pieces.push(bake(rock(0.07 + hash(c, r, 100 + i) * 0.05, i + 5, 0.75), tone, c + (hash(c, r, 110 + i) - 0.5) * 0.55, TILE_TOP + 0.04, r + (hash(c, r, 120 + i) - 0.5) * 0.55, hash(c, r, 130 + i) * Math.PI));
        }
        pieces.push(
          bake(
            hull(
              [
                [-0.05, 0, -0.04], [0.05, 0, -0.04], [-0.05, 0, 0.05], [0.05, 0, 0.05],
                [0.025, 0.22, -0.005], [-0.015, 0.19, 0.015], [0.01, 0.16, 0.03]
              ],
              'ter|crystal'
            ),
            C.ore.lit,
            c + (hash(c, r, 140) - 0.5) * 0.3,
            TILE_TOP,
            r + (hash(c, r, 141) - 0.5) * 0.3,
            hash(c, r, 142) * Math.PI
          )
        );
        for (let i = 0; i < 3; i++) {
          pieces.push(bake(rock(0.035, i + 9, 0.6), C.ochre.base, c + (hash(c, r, 150 + i) - 0.5) * 0.7, TILE_TOP + 0.008, r + (hash(c, r, 160 + i) - 0.5) * 0.7));
        }
      } else if (t === 'oil') {
        // seep: dark pool + rusted standpipe + stained ground
        pieces.push(bake(lathe([[0.3, 0], [0.27, 0.012], [0.0001, 0.012]], 12), C.oil.base, c, TILE_TOP, r));
        pieces.push(bake(lathe([[0.026, 0], [0.026, 0.12], [0.036, 0.13], [0.036, 0.16], [0.0001, 0.16]], 7), C.ochre.shade, c + 0.18, TILE_TOP, r - 0.14));
        pieces.push(bake(cbox(0.07, 0.02, 0.02, 0.006), C.timber.shade, c + 0.18, TILE_TOP + 0.12, r - 0.14));
        for (let i = 0; i < 3; i++) {
          pieces.push(bake(rock(0.035, i + 13, 0.55), C.oil.lit, c + (hash(c, r, 170 + i) - 0.5) * 0.5, TILE_TOP + 0.008, r + (hash(c, r, 180 + i) - 0.5) * 0.5));
        }
      } else if (t === 'land') {
        // sparse life so open ground isn't dead flat
        const v = hash(c, r, 200);
        if (v < 0.07) {
          pieces.push(bake(rock(0.05 + v * 0.4, (c + r * 3) % 11 + 1, 0.7), C.crag.lit, c + (hash(c, r, 210) - 0.5) * 0.6, TILE_TOP + 0.015, r + (hash(c, r, 211) - 0.5) * 0.6));
        } else if (v < 0.2) {
          // grass tuft: 3 tiny cones
          for (let i = 0; i < 3; i++) {
            pieces.push(bake(lathe([[0.018, 0], [0.0001, 0.05 + hash(c, r, 220 + i) * 0.03]], 5), i === 1 ? C.sage.lit : C.sage.base, c + (hash(c, r, 230 + i) - 0.5) * 0.5, TILE_TOP, r + (hash(c, r, 240 + i) - 0.5) * 0.5));
          }
        }
      }

      if (t === 'bridge') {
        // timber trestle. Crossing direction = where the land is: rails sit on
        // the water-facing sides, planks lie across the walking direction.
        const waterEW =
          (map.inBounds(c - 1, r) && map.terrainAt(c - 1, r) === 'water') ||
          (map.inBounds(c + 1, r) && map.terrainAt(c + 1, r) === 'water');
        const ry = waterEW ? 0 : Math.PI / 2; // canonical: river flows E-W, crossing N-S
        const B = (geo: THREE.BufferGeometry, tone: number, lx: number, ly: number, lz: number): void => {
          const ca = Math.cos(ry), sa = Math.sin(ry);
          pieces.push(bake(geo, tone, c + lx * ca + lz * sa, ly, r - lx * sa + lz * ca, ry));
        };
        B(cbox(0.99, 0.05, 1.16, 0.014), C.timber.shade, 0, TILE_TOP - 0.05, 0);
        for (let i = 0; i < 6; i++) {
          B(cbox(0.145, 0.025, 1.1, 0.008), i % 2 === 0 ? C.timber.base : C.timber.shade, -0.41 + i * 0.165, TILE_TOP - 0.012, 0);
        }
        for (const side of [-0.47, 0.47]) {
          B(cbox(0.045, 0.035, 0.99, 0.012), C.timber.base, side, TILE_TOP + 0.085, 0);
          for (const pz of [-0.38, 0, 0.38]) B(cbox(0.035, 0.1, 0.035, 0.01), C.timber.shade, side, TILE_TOP + 0.02, pz);
        }
        for (const px of [-0.33, 0.33]) B(cbox(0.18, 0.22, 0.5, 0.025), C.concrete.shade, px, TILE_TOP - 0.18, 0);
      }
    }
  }

  // ── cliff skirts: the cut-earth edge of the diorama block ──
  const skirt = (x0: number, z0: number, x1: number, z1: number, key: string): Piece => {
    // a sloped wall from tile-top edge down/out to the table frame
    const out = 0.55;
    const nx = z1 - z0, nz = -(x1 - x0); // outward normal (unnormalized, axis-aligned)
    const len = Math.hypot(nx, nz);
    const ox = (nx / len) * out, oz = (nz / len) * out;
    return hull(
      [
        [x0, TILE_TOP - 0.02, z0], [x1, TILE_TOP - 0.02, z1],
        [x0 + ox, -0.1, z0 + oz], [x1 + ox, -0.1, z1 + oz],
        [x0, -0.1, z0], [x1, -0.1, z1]
      ],
      key
    );
  };
  // (edges run clockwise so outward normals face away from the board)
  pieces.push(bake(skirt(-0.49, -0.49, MAP_W - 0.51, -0.49, 'sk|n'), C.crag.shade, 0, 0, 0));
  pieces.push(bake(skirt(MAP_W - 0.51, -0.49, MAP_W - 0.51, MAP_H - 0.51, 'sk|e'), C.crag.base, 0, 0, 0));
  pieces.push(bake(skirt(MAP_W - 0.51, MAP_H - 0.51, -0.49, MAP_H - 0.51, 'sk|s'), C.crag.shade, 0, 0, 0));
  pieces.push(bake(skirt(-0.49, MAP_H - 0.51, -0.49, -0.49, 'sk|w'), C.crag.base, 0, 0, 0));

  // ── river: one merged water sheet with world-mapped UVs (any layout) ──
  const waterTex = waterTexture();
  waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(1, 1);
  const waterMat = new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.45, metalness: 0.05 });
  const waterPieces: THREE.BufferGeometry[] = [];
  const isWet = (c: number, r: number): boolean => {
    if (!map.inBounds(c, r)) return true; // the river runs off the table edge
    const t = map.terrainAt(c, r);
    return t === 'water' || t === 'bridge';
  };
  // bank authored canonically around the DRY tile: its shore edge faces +Z,
  // the lip sits just inside the tile and the toe reaches into the channel
  const bankGeo = hull(
    [
      [-0.51, TILE_TOP - 0.015, 0.46], [0.51, TILE_TOP - 0.015, 0.46],
      [-0.51, -0.05, 0.67], [0.51, -0.05, 0.67],
      [-0.51, -0.05, 0.46], [0.51, -0.05, 0.46]
    ],
    'bank'
  );
  for (let r = 0; r < MAP_H; r++) {
    for (let c = 0; c < MAP_W; c++) {
      const t = map.terrainAt(c, r);
      if (t !== 'water' && t !== 'bridge') continue;
      const q = new THREE.PlaneGeometry(1, 1);
      q.rotateX(-Math.PI / 2);
      q.translate(c, 0.005, r);
      const qp = q.getAttribute('position') as THREE.BufferAttribute;
      const quv = q.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < qp.count; i++) {
        quv.setXY(i, qp.getX(i) * 0.16, qp.getZ(i) * 0.55); // continuous flow along X
      }
      waterPieces.push(q);
      // banks where a dry neighbor meets this channel tile
      const dirs: Array<[number, number, number]> = [
        [0, -1, Math.PI], [0, 1, 0], [-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2]
      ];
      for (const [dc, dr, ry] of dirs) {
        if (!isWet(c + dc, r + dr)) {
          // bank hangs off the dry neighbor's edge, sloping toward this tile
          pieces.push(bake(bankGeo, C.ochre.base, c + dc, 0, r + dr, ry + Math.PI));
          pieces.push(bake(cbox(1.0, 0.012, 0.05, 0.005), C.foam.base, c + dc * 0.36, 0.012, r + dr * 0.36, ry));
        }
      }
    }
  }

  const chunk = mergeChunk(pieces, vertexMat());
  if (chunk) group.add(chunk);
  const waterChunk = mergeChunk(waterPieces, waterMat, false);
  if (waterChunk) {
    waterChunk.castShadow = false;
    group.add(waterChunk);
  }

  function update(dt: number): void {
    waterTex.offset.x += dt * 0.012; // the river drifts, nothing else stirs
  }

  return { group, update };
}
