import * as THREE from 'three';
import type { TeamId } from '../../sim/types';

/**
 * THE single source of color truth (see ART_DIRECTION.md §3).
 * Every material in the game is minted here, cached, and shared. Each family
 * is a 3-value ramp — lit / base / shade — used as painted tones on separate
 * parts. Nothing outside this file may invent a hex.
 */

export interface Ramp {
  lit: number;
  base: number;
  shade: number;
}

export const C = {
  // terrain
  sand:     { lit: 0xddcda4, base: 0xc7b68c, shade: 0xab9a73 } as Ramp,
  sage:     { lit: 0x9aa67e, base: 0x83926b, shade: 0x687a56 } as Ramp,
  canopy:   { lit: 0x6d8a54, base: 0x55703f, shade: 0x405a32 } as Ramp,
  crag:     { lit: 0xa89d8c, base: 0x8d8374, shade: 0x6e6557 } as Ramp,
  ochre:    { lit: 0xc29c5e, base: 0xa9854c, shade: 0x8a6b3c } as Ramp, // crag strata, dust
  water:    { lit: 0x3d7d86, base: 0x2e6470, shade: 0x224d57 } as Ramp,
  foam:     { lit: 0xeae0c2, base: 0xd8cda9, shade: 0xbfb38e } as Ramp,
  // machines & men
  olive:    { lit: 0x77804e, base: 0x636c41, shade: 0x4d5434 } as Ramp,
  steel:    { lit: 0x707a85, base: 0x596069, shade: 0x444a52 } as Ramp,
  gun:      { lit: 0x42464d, base: 0x33373d, shade: 0x26292e } as Ramp,
  track:    { lit: 0x3b3c37, base: 0x2f302c, shade: 0x242521 } as Ramp,
  timber:   { lit: 0xa97e4f, base: 0x8d6840, shade: 0x6e5032 } as Ramp,
  concrete: { lit: 0x9b958a, base: 0x847f74, shade: 0x67635a } as Ramp,
  cloth:    { lit: 0xb5a884, base: 0x9c9070, shade: 0x7e7458 } as Ramp,
  skin:     { lit: 0xc9a07a, base: 0xb08a64, shade: 0x8f6e4e } as Ramp,
  ore:      { lit: 0xe8b83f, base: 0xcc9b30, shade: 0xa37a26 } as Ramp,
  oil:      { lit: 0x2c2a26, base: 0x201f1c, shade: 0x161513 } as Ramp,
  glass:    { lit: 0x39565e, base: 0x2b4249, shade: 0x1f3137 } as Ramp,
  // team enamel — the most saturated thing on the board
  team0:    { lit: 0x4b7fdd, base: 0x2f63c8, shade: 0x244a96 } as Ramp,
  team1:    { lit: 0xe66a3c, base: 0xd14f2a, shade: 0xa53c20 } as Ramp
};

/** UI-facing team hexes (health bars, badges) — brighter than the enamel. */
export const TEAM_COLORS: [number, number] = [0x4585e8, 0xe85d30];

export function teamRamp(team: TeamId): Ramp {
  return team === 0 ? C.team0 : C.team1;
}

/** Surface finishes — how the paint sits on the miniature. */
export type Finish = 'paint' | 'matte' | 'metal' | 'enamel' | 'glass' | 'ore' | 'flat';

const FINISH: Record<Finish, { rough: number; metal: number }> = {
  paint:  { rough: 0.62, metal: 0.12 },              // painted armor, fatigues
  matte:  { rough: 0.92, metal: 0.0 },               // earth, cloth, concrete
  metal:  { rough: 0.42, metal: 0.55 },              // bare gun steel, tracks
  enamel: { rough: 0.34, metal: 0.18 },              // team accent panels, glossy
  glass:  { rough: 0.18, metal: 0.35 },              // visors, windows
  ore:    { rough: 0.35, metal: 0.45 },              // gold deposits (gets emissive glint)
  flat:   { rough: 1.0, metal: 0.0 }                 // shadowless decals
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Mint (or fetch) the shared material for a hex+finish. Never dispose these. */
export function pm(hex: number, finish: Finish = 'paint'): THREE.MeshStandardMaterial {
  const key = `${hex}|${finish}`;
  let m = cache.get(key);
  if (!m) {
    const f = FINISH[finish];
    m = new THREE.MeshStandardMaterial({
      color: hex,
      flatShading: true,
      roughness: f.rough,
      metalness: f.metal
    });
    if (finish === 'ore') {
      m.emissive = new THREE.Color(hex);
      m.emissiveIntensity = 0.18;
    }
    cache.set(key, m);
  }
  return m;
}

/** Shared vertex-colored material for merged terrain chunks. */
let vcMat: THREE.MeshStandardMaterial | null = null;
export function vertexMat(): THREE.MeshStandardMaterial {
  if (!vcMat) {
    vcMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
      metalness: 0.0
    });
  }
  return vcMat;
}
