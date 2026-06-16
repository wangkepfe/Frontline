import type { BuildingKind, BuildingMods, OrderKind, UnitKind, UnitMods, UpgradeId } from './types';

export type CardKind = 'building' | 'unit' | 'upgrade' | 'tactic';
export type PlaceRule = 'gold' | 'oil' | 'land' | 'deploy' | 'none' | 'anywhere';

/**
 * The hand is three staff desks (DESIGN_GUIDEBOOK §5): infrastructure deals
 * building proposals, the frontline desk deals units, the strategy desk deals
 * everything else (tactics, orders, upgrades). Slots are fixed per desk.
 */
export type HandCategory = 'building' | 'unit' | 'action';

export const CATEGORY_SLOTS: Record<HandCategory, number[]> = {
  building: [0, 1],
  unit: [2, 3],
  action: [4, 5]
};

export function cardCategory(def: CardDef): HandCategory {
  return def.kind === 'building' ? 'building' : def.kind === 'unit' ? 'unit' : 'action';
}

export function slotCategory(slot: number): HandCategory {
  return slot < 2 ? 'building' : slot < 4 ? 'unit' : 'action';
}

/**
 * Tech ladder: base (power plant, always playable) → 0 (extractor, needs a live
 * power plant) → 1 (needs a live extractor) → 2 (needs a live derrick).
 */
export type CardTier = 'base' | 0 | 1 | 2;

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  gold: number;
  oil: number;
  place: PlaceRule;
  tier: CardTier;
  building?: BuildingKind;
  unit?: UnitKind;
  upgrade?: UpgradeId;
  desc: string;
  /** A/B side support: both sides share pairId; flip only in campaign loadout phase */
  pairId?: string;
  side?: 'A' | 'B';
  unitMods?: UnitMods;
  buildingMods?: BuildingMods;
  carpet?: boolean; // airstrike B: line of three strikes
  /** nuclear strike: NUKE stats instead of AIRSTRIKE, one-shots anything */
  nuke?: boolean;
  /** team-wide standing order issued for ORDER_DURATION seconds */
  order?: OrderKind;
}

/** the live building a card's tier demands, or null if always playable */
export function tierRequirement(card: CardDef): BuildingKind | null {
  switch (card.tier) {
    case 'base': return null;
    case 0: return 'powerplant';
    case 1: return 'extractor';
    case 2: return 'derrick';
  }
}

/** the card tier a live building of this kind unlocks, or null for non-gates */
export function tierUnlockedBy(kind: BuildingKind): CardTier | null {
  switch (kind) {
    case 'powerplant': return 0;
    case 'extractor': return 1;
    case 'derrick': return 2;
    default: return null;
  }
}

export function tierLabel(tier: CardTier): string {
  return tier === 'base' ? 'BASE' : `T${tier}`;
}

export const CARDS: Record<string, CardDef> = {
  // ── buildings ──────────────────────────────────────────────
  powerplant: { id: 'powerplant', name: 'Power Plant', kind: 'building', gold: 30, oil: 0, place: 'land', tier: 'base', building: 'powerplant', desc: 'Generates 8 power. Everything else needs power — build this first.' },
  extractor: { id: 'extractor', name: 'Gold Extractor', kind: 'building', gold: 60, oil: 0, place: 'gold', tier: 0, building: 'extractor', desc: 'Place on a gold mine. +3 gold/s — click its badge to bank. Unlocks tier 1.' },
  derrick:   { id: 'derrick', name: 'Oil Derrick', kind: 'building', gold: 70, oil: 0, place: 'oil', tier: 1, building: 'derrick', desc: 'Place on an oil field. +2 oil/s — click its badge to bank. Unlocks tier 2.' },
  barracks:  { id: 'barracks', name: 'Barracks', kind: 'building', gold: 120, oil: 0, place: 'land', tier: 1, building: 'barracks', desc: 'Trains a Rifle Squad every 11s, pushing the nearest lane.' },
  factory:   { id: 'factory', name: 'War Factory', kind: 'building', gold: 150, oil: 80, place: 'land', tier: 2, building: 'factory', desc: 'Rolls out a Battle Tank every 20s.' },
  bunker:    { id: 'bunker', name: 'MG Bunker', kind: 'building', gold: 90, oil: 0, place: 'land', tier: 1, building: 'bunker', desc: 'Static MG nest. Shreds infantry.' },
  atturret:  { id: 'atturret', name: 'AT Turret', kind: 'building', gold: 80, oil: 30, place: 'land', tier: 2, building: 'atturret', desc: 'Anti-tank emplacement. Prioritizes vehicles.' },
  // ── units (muster at your HQ — no placement) ───────────────
  rifle:     { id: 'rifle', name: 'Rifle Squad', kind: 'unit', gold: 40, oil: 0, place: 'none', tier: 1, unit: 'rifle', desc: 'Line infantry. Musters at HQ and pushes the lane. Strong in forest.' },
  rocket:    { id: 'rocket', name: 'Rocket Team', kind: 'unit', gold: 60, oil: 0, place: 'none', tier: 1, unit: 'rocket', desc: 'Base guard. Rushes to any of your buildings under attack.' },
  tank:      { id: 'tank', name: 'Battle Tank', kind: 'unit', gold: 80, oil: 40, place: 'none', tier: 2, unit: 'tank', desc: 'Spearhead armor. Crushes infantry and buildings.' },
  howitzer:  { id: 'howitzer', name: 'Mobile Howitzer', kind: 'unit', gold: 70, oil: 50, place: 'none', tier: 2, unit: 'howitzer', desc: 'HQ battery. Bombards anything in long range. Min range.' },
  harvester: { id: 'harvester', name: 'Supply Truck', kind: 'unit', gold: 50, oil: 0, place: 'none', tier: 1, unit: 'harvester', desc: 'Runs your mines: banks their stored haul and boosts each one it visits. Raid bait.' },
  buggy:     { id: 'buggy', name: 'Scout Buggy', kind: 'unit', gold: 50, oil: 10, place: 'none', tier: 2, unit: 'buggy', desc: 'Fast raider. Hunts harvesters and extractors.' },
  // ── upgrades (army-wide, permanent) ────────────────────────
  sabot:     { id: 'sabot', name: 'Sabot Rounds', kind: 'upgrade', gold: 120, oil: 80, place: 'none', tier: 2, upgrade: 'sabot', desc: 'Tank cannons +40% vs armor.' },
  apammo:    { id: 'apammo', name: 'AP Ammo', kind: 'upgrade', gold: 100, oil: 60, place: 'none', tier: 2, upgrade: 'apammo', desc: 'Infantry small-arms pierce armor (2.5x vs vehicles).' },
  reactive:  { id: 'reactive', name: 'Reactive Armor', kind: 'upgrade', gold: 100, oil: 70, place: 'none', tier: 2, upgrade: 'reactive', desc: 'Your vehicles take 35% less AT damage.' },
  smoke:     { id: 'smoke', name: 'Smoke Doctrine', kind: 'upgrade', gold: 80, oil: 0, place: 'none', tier: 2, upgrade: 'smoke', desc: 'Your units in forest take 55% less ranged damage.' },
  barrels:   { id: 'barrels', name: 'Extended Barrels', kind: 'upgrade', gold: 90, oil: 50, place: 'none', tier: 2, upgrade: 'barrels', desc: 'Howitzers +1.5 range.' },
  // ── tactics ────────────────────────────────────────────────
  airstrike: { id: 'airstrike', name: 'Airstrike', kind: 'tactic', gold: 60, oil: 40, place: 'anywhere', tier: 2, desc: 'Call a strike anywhere after a short delay. Heavy splash.' },
  // never in a loadout: the sim deals it to both players in long games
  nuke:      { id: 'nuke', name: 'Nuclear Strike', kind: 'tactic', gold: 0, oil: 0, place: 'anywhere', tier: 'base', nuke: true, desc: 'The war ends now. Erases everything at the target — HQs included.' },

  // orders: 60s team-wide directives, dealt to the strategy desk
  defendorder: { id: 'defendorder', name: 'Defensive Posture', kind: 'tactic', gold: 25, oil: 0, place: 'none', tier: 1, order: 'defend', desc: 'All units fall back and hold the HQ perimeter for 60s.' },
  attackorder: { id: 'attackorder', name: 'General Offensive', kind: 'tactic', gold: 25, oil: 0, place: 'none', tier: 1, order: 'attack', desc: 'All units advance on the enemy HQ for 60s.' },
  spreadorder: { id: 'spreadorder', name: 'Dispersal Order', kind: 'tactic', gold: 25, oil: 0, place: 'none', tier: 1, order: 'spread', desc: 'All units keep wide spacing for 60s — blunts artillery and splash.' },
  hitpower:    { id: 'hitpower', name: 'Target: Power Grid', kind: 'tactic', gold: 40, oil: 0, place: 'none', tier: 1, order: 'hitPower', desc: 'All units hunt enemy power plants for 60s. Dark grids fight back poorly.' },
  hiteconomy:  { id: 'hiteconomy', name: 'Target: Economy', kind: 'tactic', gold: 40, oil: 0, place: 'none', tier: 1, order: 'hitEconomy', desc: 'All units raid enemy mines and derricks for 60s. Starve the war effort.' },

  // ── B sides (flippable in the campaign loadout phase) ──────
  rifle_b:     { id: 'rifle_b', name: 'Garrison Squad', kind: 'unit', gold: 40, oil: 0, place: 'none', tier: 1, unit: 'rifle', desc: 'Home guard: digs in at the HQ and holds.', unitMods: { stance: 'defensive' } },
  rocket_b:    { id: 'rocket_b', name: 'Hunter Team', kind: 'unit', gold: 60, oil: 0, place: 'none', tier: 1, unit: 'rocket', desc: 'Advances with the push, hunting armor.', unitMods: { stance: 'aggressive' } },
  tank_b:      { id: 'tank_b', name: 'Siege Tank', kind: 'unit', gold: 80, oil: 40, place: 'none', tier: 2, unit: 'tank', desc: 'Demolition gun: +50% vs structures, weaker vs units, slow.', unitMods: { dmgMult: 0.7, vsBuildingMult: 2.15, speedAdd: -0.15 } },
  howitzer_b:  { id: 'howitzer_b', name: 'Creeping Barrage', kind: 'unit', gold: 70, oil: 50, place: 'none', tier: 2, unit: 'howitzer', desc: 'Artillery that slowly advances with your line. Risky, relentless.', unitMods: { stance: 'aggressive' } },
  buggy_b:     { id: 'buggy_b', name: 'Gun Buggy', kind: 'unit', gold: 50, oil: 10, place: 'none', tier: 2, unit: 'buggy', desc: 'Skirmisher: fights with the army instead of raiding.', unitMods: { stance: 'aggressive', dmgMult: 1.3 } },
  harvester_b: { id: 'harvester_b', name: 'Armored Hauler', kind: 'unit', gold: 50, oil: 0, place: 'none', tier: 1, unit: 'harvester', desc: 'Hardened convoy: much tougher, slightly weaker boost.', unitMods: { hpMult: 1.8, boostMult: 0.75 } },
  barracks_b:  { id: 'barracks_b', name: 'Commando School', kind: 'building', gold: 120, oil: 0, place: 'land', tier: 1, building: 'barracks', desc: 'Trains Rocket Teams instead of rifles. Slower cadence.', buildingMods: { prodUnit: 'rocket', prodMult: 1.3 } },
  factory_b:   { id: 'factory_b', name: 'Motor Pool', kind: 'building', gold: 150, oil: 80, place: 'land', tier: 2, building: 'factory', desc: 'Rolls out fast Scout Buggies instead of tanks.', buildingMods: { prodUnit: 'buggy', prodMult: 0.55 } },
  bunker_b:    { id: 'bunker_b', name: 'Forward Post', kind: 'building', gold: 90, oil: 0, place: 'land', tier: 1, building: 'bunker', desc: 'Lighter MG post that projects territory much further.', buildingMods: { hpMult: 0.75, territoryRadius: 5 } },
  airstrike_b: { id: 'airstrike_b', name: 'Carpet Run', kind: 'tactic', gold: 60, oil: 40, place: 'anywhere', tier: 2, desc: 'Three lighter strikes in a line across the target.', carpet: true }
};

// wire up A/B pairs (economy buildings deliberately have no B side)
const PAIRS: Array<[string, string]> = [
  ['rifle', 'rifle_b'], ['rocket', 'rocket_b'], ['tank', 'tank_b'], ['howitzer', 'howitzer_b'],
  ['buggy', 'buggy_b'], ['harvester', 'harvester_b'], ['barracks', 'barracks_b'],
  ['factory', 'factory_b'], ['bunker', 'bunker_b'], ['airstrike', 'airstrike_b']
];
for (const [a, b] of PAIRS) {
  CARDS[a].pairId = a;
  CARDS[a].side = 'A';
  CARDS[b].pairId = a;
  CARDS[b].side = 'B';
}

/** the other side of a card, or null if it has no pair */
export function flipSide(id: string): string | null {
  const def = CARDS[id];
  if (!def?.pairId) return null;
  const [a, b] = PAIRS.find(([x]) => x === def.pairId)!;
  return def.id === a ? b : a;
}

/** base id used for AI scoring and reward pools (A side of the pair, or self) */
export function baseId(id: string): string {
  return CARDS[id]?.pairId ?? id;
}

export const DEFAULT_LOADOUT: string[] = [
  'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'factory', 'bunker',
  'rifle', 'rifle', 'rocket', 'tank', 'howitzer', 'harvester', 'airstrike', 'attackorder'
];

// AI doctrine decks. The armor/rush decks deliberately field B-side cards so the
// opponent actually exploits the alternate sides (Siege Tank vs structures, Gun
// Buggy as a skirmisher, Hunter rockets) — its scorer is B-side-aware (ai.ts).
export const AI_LOADOUTS: Record<string, string[]> = {
  balanced: DEFAULT_LOADOUT,
  armor: [
    'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'derrick', 'factory', 'factory',
    'atturret', 'tank', 'tank_b', 'rocket', 'harvester', 'sabot', 'reactive', 'attackorder'
  ],
  rush: [
    'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'barracks', 'rifle',
    'rifle', 'rocket', 'rocket_b', 'buggy_b', 'harvester', 'attackorder', 'hiteconomy', 'airstrike'
  ]
};
