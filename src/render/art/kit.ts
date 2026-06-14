import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry kit (ART_DIRECTION.md §4). The only allowed primitives.
 * Everything is flat-faceted, parameter-cached, and shared — kit geometry is
 * NEVER disposed (geo.userData.shared marks it for disposeObject to skip).
 */

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

/** Deterministic hash → [0,1). Use for ALL cosmetic variation (no Math.random). */
export function hash(a: number, b = 0, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ── solids ──────────────────────────────────────────────────────────────────

/**
 * Chamfered box — the workhorse. A convex hull of 24 points: each corner is
 * replaced by three points pulled inward along each axis, producing crisp 45°
 * chamfers on all 12 edges that catch the key light.
 */
export function cbox(w: number, h: number, d: number, ch?: number): THREE.BufferGeometry {
  const c = Math.min(ch ?? Math.min(w, h, d) * 0.22, w * 0.49, h * 0.49, d * 0.49);
  return cached(`cb|${w}|${h}|${d}|${c}`, () => {
    const pts: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const x = (w / 2) * sx, y = (h / 2) * sy, z = (d / 2) * sz;
      pts.push(new THREE.Vector3(x - c * sx, y, z));
      pts.push(new THREE.Vector3(x, y - c * sy, z));
      pts.push(new THREE.Vector3(x, y, z - c * sz));
    }
    return new ConvexGeometry(pts);
  });
}

/** Arbitrary convex brush — glacis plates, wedges, turret frustums. */
export function hull(points: Array<[number, number, number]>, key?: string): THREE.BufferGeometry {
  const k = key ?? `hl|${points.map((p) => p.join(',')).join(';')}`;
  return cached(k, () => new ConvexGeometry(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))));
}

/** Symmetric trapezoid prism (hull sugar): w at bottom, wTop at top. */
export function wedge(w: number, h: number, d: number, wTop: number, dTop = d): THREE.BufferGeometry {
  return hull(
    [
      [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, d / 2], [w / 2, 0, d / 2],
      [-wTop / 2, h, -dTop / 2], [wTop / 2, h, -dTop / 2], [-wTop / 2, h, dTop / 2], [wTop / 2, h, dTop / 2]
    ],
    `wg|${w}|${h}|${d}|${wTop}|${dTop}`
  );
}

/** Lathe around Y from an [r, y] profile — chamfered cylinders, domes, barrels. */
export function lathe(profile: Array<[number, number]>, seg = 10): THREE.BufferGeometry {
  const key = `la|${seg}|${profile.map((p) => p.join(',')).join(';')}`;
  return cached(key, () => {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
    const g = new THREE.LatheGeometry(pts, seg);
    return g;
  });
}

/** Chamfer-rimmed cylinder, base at y=0. */
export function cyl(r: number, h: number, seg = 10, ch?: number): THREE.BufferGeometry {
  const c = Math.min(ch ?? Math.min(r, h) * 0.25, r * 0.9, h * 0.45);
  return lathe(
    [
      [0.0001, 0], [r - c, 0], [r, c], [r, h - c], [r - c, h], [0.0001, h]
    ],
    seg
  );
}

/** Road wheel / drum lying on its side comes from rotating this in placement. */
export function drum(r: number, w: number, seg = 12): THREE.BufferGeometry {
  const c = r * 0.18;
  return lathe(
    [
      [0.0001, 0], [r * 0.45, 0], [r * 0.45, w * 0.12], [r - c, w * 0.12], [r, w * 0.3], [r, w * 0.7], [r - c, w * 0.88], [r * 0.45, w * 0.88], [r * 0.45, w], [0.0001, w]
    ],
    seg
  );
}

/** Gun barrel along +Y (rotate into place): tapered, stepped muzzle. */
export function barrel(rBase: number, rMuzzle: number, len: number, seg = 8): THREE.BufferGeometry {
  const m = rMuzzle;
  return lathe(
    [
      [rBase, 0], [rBase, len * 0.18], [m * 1.05, len * 0.55], [m, len * 0.86],
      [m * 1.35, len * 0.88], [m * 1.35, len * 0.97], [m * 0.6, len],
      [0.0001, len]
    ],
    seg
  );
}

/** Seeded faceted rock: jittered icosahedron. Same seed → same rock, no cracks. */
export function rock(r: number, seed: number, squash = 0.8): THREE.BufferGeometry {
  return cached(`rk|${r}|${seed}|${squash}`, () => {
    const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // hash by quantized original position so duplicated verts stay welded
      const qx = Math.round(v.x * 137 / r), qy = Math.round(v.y * 137 / r), qz = Math.round(v.z * 137 / r);
      const j = 0.62 + hash(qx + seed * 17, qy - seed * 5, qz + seed * 3) * 0.62;
      v.multiplyScalar(j);
      pos.setXYZ(i, v.x, v.y * squash, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Seeded canopy blob: rounder than rock, squashed sphere facets. */
export function blob(r: number, seed: number, squash = 0.85): THREE.BufferGeometry {
  return cached(`bl|${r}|${seed}|${squash}`, () => {
    const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const qx = Math.round(v.x * 119 / r), qy = Math.round(v.y * 119 / r), qz = Math.round(v.z * 119 / r);
      const j = 0.88 + hash(qx + seed * 23, qy + seed * 7, qz - seed * 11) * 0.3;
      v.multiplyScalar(j);
      pos.setXYZ(i, v.x, v.y * squash, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

// ── placement ───────────────────────────────────────────────────────────────

export interface PutOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  name?: string;
  noCast?: boolean;
  noReceive?: boolean;
}

/** Place a kit part: mesh with shadows, positioned, optionally rotated/named. */
export function put(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  o: PutOpts = {}
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  if (o.name) m.name = o.name;
  m.castShadow = !o.noCast;
  m.receiveShadow = !o.noReceive;
  parent.add(m);
  return m;
}

// ── terrain merging ─────────────────────────────────────────────────────────

const tmpColor = new THREE.Color();

/**
 * Clone a kit geometry as non-indexed with a baked vertex color + transform,
 * ready for mergeGeometries into one vertex-colored chunk.
 */
export function bake(
  geo: THREE.BufferGeometry,
  hex: number,
  x = 0,
  y = 0,
  z = 0,
  ry = 0,
  scale = 1
): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  g = g as THREE.BufferGeometry;
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  tmpColor.setHex(hex).convertSRGBToLinear();
  for (let i = 0; i < n; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // drop uv so all baked geometries share an attribute set for merging
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const m = new THREE.Matrix4()
    .makeRotationY(ry)
    .premultiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  g.applyMatrix4(m);
  return g;
}

/** Merge baked pieces into one shadow-casting mesh with the shared vc material. */
export function mergeChunk(pieces: THREE.BufferGeometry[], mat: THREE.Material, castShadow = true): THREE.Mesh | null {
  if (pieces.length === 0) return null;
  const merged = mergeGeometries(pieces, false);
  for (const p of pieces) p.dispose(); // baked clones are one-offs
  if (!merged) return null;
  merged.userData.shared = true; // managed by terrain, not per-entity disposal
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}
