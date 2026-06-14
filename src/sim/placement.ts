import type { Sim } from './sim';
import type { TeamId } from './types';
import type { CardDef } from './cards';
import { TilePos, chebyshev } from './map';

/**
 * Territory: tiles within each building's own projection radius. The HQ casts
 * a wide home zone; every other structure pushes the frontier — each placement
 * is also a land grab.
 */
export function inTerritory(sim: Sim, team: TeamId, c: number, r: number): boolean {
  for (const b of sim.buildings) {
    if (b.team !== team || b.territoryRadius <= 0) continue;
    if (Math.max(Math.abs(b.tile.c - c), Math.abs(b.tile.r - r)) <= b.territoryRadius) return true;
  }
  return false;
}

export function isValidPlacement(sim: Sim, team: TeamId, card: CardDef, c: number, r: number): boolean {
  if (!sim.map.inBounds(c, r)) return false;
  const terrain = sim.map.terrainAt(c, r);
  const blocked = sim.blocked[sim.map.idx(c, r)] !== 0;

  // units standing on a build site get nudged aside by placeBuilding
  switch (card.place) {
    case 'anywhere':
      return true;
    case 'none':
      return true;
    case 'gold':
      return terrain === 'gold' && !blocked && inTerritory(sim, team, c, r);
    case 'oil':
      return terrain === 'oil' && !blocked && inTerritory(sim, team, c, r);
    case 'land':
      return terrain === 'land' && !blocked && inTerritory(sim, team, c, r);
    case 'deploy':
      return sim.map.props(c, r).walkable && !blocked && inTerritory(sim, team, c, r);
  }
}

export function validPlacementTiles(sim: Sim, team: TeamId, card: CardDef): TilePos[] {
  const out: TilePos[] = [];
  if (card.place === 'none') return out;
  for (let r = 0; r < sim.map.h; r++) {
    for (let c = 0; c < sim.map.w; c++) {
      if (isValidPlacement(sim, team, card, c, r)) out.push({ c, r });
    }
  }
  return out;
}

/**
 * Valid tile near a desired point with the most open surroundings — used by the
 * AI for support buildings (power plants) that have no business hugging
 * anything: each neighboring building, wall or resource node narrows a lane
 * that units and trucks march through, so clearance outranks closeness.
 */
export function clearestValidTile(sim: Sim, team: TeamId, card: CardDef, want: TilePos): TilePos | null {
  let best: TilePos | null = null;
  let bestScore = Infinity;
  for (const t of validPlacementTiles(sim, team, card)) {
    let crowd = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const c = t.c + dc, r = t.r + dr;
        if (!sim.map.inBounds(c, r) || sim.blocked[sim.map.idx(c, r)] !== 0 || !sim.map.props(c, r).walkable) {
          crowd++;
          continue;
        }
        // an open resource node is a future extractor plus its truck docking lane
        const terr = sim.map.terrainAt(c, r);
        if (terr === 'gold' || terr === 'oil') crowd++;
      }
    }
    // one crowded neighbor costs as much as 4 tiles of distance
    const score = crowd * 4 + chebyshev(t, want) + Math.abs(t.c - want.c) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Closest valid placement tile to a desired point — used by the AI to aim its plays. */
export function nearestValidTile(sim: Sim, team: TeamId, card: CardDef, want: TilePos): TilePos | null {
  let best: TilePos | null = null;
  let bestD = Infinity;
  for (const t of validPlacementTiles(sim, team, card)) {
    const d = chebyshev(t, want) + Math.abs(t.c - want.c) * 0.01; // slight tiebreak stability
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
