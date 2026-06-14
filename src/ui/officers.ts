/**
 * Staff officer portraits for the four corner posts (statistics /
 * infrastructure / frontline / strategy) — generated character paintings in
 * the §14 character-sheet style, prepped by electron/prep-officers.cjs
 * (keyed, tight-cropped, 256²) and bundled from src/ so the hashed asset
 * URLs survive the Electron file:// build.
 */

import statsUrl from './officers/stats.png';
import infraUrl from './officers/infra.png';
import frontlineUrl from './officers/frontline.png';
import strategyUrl from './officers/strategy.png';

export type OfficerRole = 'stats' | 'infra' | 'frontline' | 'strategy';

/** dossier nameplates follow the §14.1 characters (rank tracks seniority) */
export const OFFICERS: Record<OfficerRole, { title: string; name: string; blurb: string }> = {
  stats: { title: 'STATISTICS', name: 'LT. E. VOSS', blurb: 'sitrep & ledgers' },
  infra: { title: 'INFRASTRUCTURE', name: 'CPT. R. MASON', blurb: 'building proposals' },
  frontline: { title: 'FRONTLINE', name: 'MAJ. D. KANE', blurb: 'unit proposals' },
  strategy: { title: 'STRATEGY', name: 'COL. A. STERN', blurb: 'action proposals' }
};

const PORTRAITS: Record<OfficerRole, string> = {
  stats: statsUrl,
  infra: infraUrl,
  frontline: frontlineUrl,
  strategy: strategyUrl
};

/** portrait <img> for a staff post's mount */
export function officerPortrait(role: OfficerRole): string {
  return `<img class="portrait-img" src="${PORTRAITS[role]}" alt="${OFFICERS[role].title}" draggable="false">`;
}
