import * as THREE from 'three';
import type { BuildingKind, TeamId, UnitKind } from '../../sim/types';
import { C, pm } from './palette';
import { cbox, put } from './kit';
import type { BuildingRigHandle, UnitRigHandle } from './rig';
import { buildRifleSquad, buildRocketTeam } from './infantry';
import { buildBuggy, buildHarvester, buildHowitzer, buildTank } from './vehicles';
import {
  buildAtTurretRig, buildBarracksRig, buildBunkerRig, buildDerrickRig,
  buildExtractorRig, buildFactoryRig, buildHqRig, buildPowerPlantRig
} from './buildings';

/**
 * Asset registry: every unit/building kind resolves to its rigged builder.
 * Placeholders mark assets not yet authored — they must all be gone before
 * the overhaul ships (atelier shows them as grey slugs).
 */

export const UNIT_SCALE = 1.45; // readability over realism on the small map

function placeholderUnit(): UnitRigHandle {
  const root = new THREE.Group();
  put(root, cbox(0.3, 0.16, 0.2, 0.03), pm(C.concrete.base), 0, 0.09, 0);
  return { root, update: () => {} };
}


export function buildUnitRig(kind: UnitKind, team: TeamId): UnitRigHandle {
  let rig: UnitRigHandle;
  switch (kind) {
    case 'rifle': rig = buildRifleSquad(team); break;
    case 'rocket': rig = buildRocketTeam(team); break;
    case 'tank': rig = buildTank(team); break;
    case 'buggy': rig = buildBuggy(team); break;
    case 'howitzer': rig = buildHowitzer(team); break;
    case 'harvester': rig = buildHarvester(team); break;
    default: rig = placeholderUnit();
  }
  rig.root.scale.setScalar(UNIT_SCALE);
  return rig;
}

export function buildBuildingRig(kind: BuildingKind, team: TeamId): BuildingRigHandle {
  switch (kind) {
    case 'hq': return buildHqRig(team);
    case 'powerplant': return buildPowerPlantRig(team);
    case 'barracks': return buildBarracksRig(team);
    case 'factory': return buildFactoryRig(team);
    case 'extractor': return buildExtractorRig(team);
    case 'derrick': return buildDerrickRig(team);
    case 'bunker': return buildBunkerRig(team);
    case 'atturret': return buildAtTurretRig(team);
  }
}

export const UNIT_KINDS: UnitKind[] = ['rifle', 'rocket', 'tank', 'howitzer', 'harvester', 'buggy'];
export const BUILDING_KINDS: BuildingKind[] = ['hq', 'powerplant', 'barracks', 'factory', 'extractor', 'derrick', 'bunker', 'atturret'];
