import * as THREE from 'three';
import type { GameMap } from '../sim/map';
import type { BuildingKind, TeamId, UnitKind } from '../sim/types';
import { TEAM_COLORS } from './art/palette';
import { UNIT_SCALE, buildBuildingRig, buildUnitRig } from './art/catalog';
import { TILE_TOP, TerrainHandle, buildTerrain as buildBoard } from './art/terrain';
import type { Biome } from './art/biomes';
import type { BuildingRigHandle, UnitRigHandle } from './art/rig';

/**
 * Facade over the art pipeline (src/render/art/). The view talks rigs; the
 * ghost/placement system only needs static rest-pose meshes. All geometry is
 * kit-cached and shared — never dispose anything flagged userData.shared.
 */

export { TEAM_COLORS, TILE_TOP, UNIT_SCALE, buildBuildingRig, buildUnitRig };
export type { Biome, BuildingRigHandle, TerrainHandle, UnitRigHandle };

export function buildTerrain(map: GameMap, biome?: Biome): TerrainHandle {
  return buildBoard(map, biome);
}

/** Static rest-pose mesh (placement holograms). */
export function buildUnitMesh(kind: UnitKind, team: TeamId): THREE.Group {
  return buildUnitRig(kind, team).root;
}

/** Static rest-pose mesh (placement holograms). */
export function buildBuildingMesh(kind: BuildingKind, team: TeamId): THREE.Group {
  return buildBuildingRig(kind, team).root;
}
