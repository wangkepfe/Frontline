import type { TilePos } from './map';

export type TeamId = 0 | 1;

export interface Vec2 {
  x: number; // column axis, tile units (tile centers at integers)
  y: number; // row axis
}

export type Stance = 'aggressive' | 'defensive' | 'economic' | 'raider';
export type ArmorClass = 'infantry' | 'armor' | 'light' | 'building';
export type WeaponKind = 'smallarms' | 'mg' | 'at' | 'cannon' | 'artillery' | 'hqgun' | 'none';

export type UnitKind = 'rifle' | 'rocket' | 'tank' | 'howitzer' | 'harvester' | 'buggy';
export type BuildingKind = 'hq' | 'powerplant' | 'extractor' | 'derrick' | 'barracks' | 'factory' | 'bunker' | 'atturret';

/** team-wide order cards: a 60s standing directive for every combat unit */
export type OrderKind = 'defend' | 'attack' | 'spread' | 'hitPower' | 'hitEconomy';

export interface StandingOrder {
  kind: OrderKind;
  until: number; // sim time when the order lapses
}

export type HarvesterState = 'toNode' | 'loading' | 'toHq' | 'unloading' | 'idle' | 'fleeing';

/** Per-instance stat overrides from card sides / forge upgrades. */
export interface UnitMods {
  hpMult?: number;
  dmgMult?: number;
  speedAdd?: number;
  stance?: Stance;
  vsBuildingMult?: number;
  boostMult?: number; // harvester boost strength
}

export interface BuildingMods {
  hpMult?: number;
  dmgMult?: number;
  rateMult?: number; // income rate
  prodMult?: number; // production interval multiplier (<1 = faster)
  prodUnit?: UnitKind; // production override (Commando School, Motor Pool)
  territoryRadius?: number; // override of the per-kind projection (Forward Post)
}

export interface Unit {
  id: number;
  team: TeamId;
  kind: UnitKind;
  pos: Vec2;
  prevPos: Vec2; // previous tick position, for render interpolation
  facing: number; // radians
  hp: number;
  maxHp: number;
  // resolved stats (base * mods), used by behavior/combat
  dmg: number;
  speed: number;
  vsBuildingMult: number;
  boostMult: number;
  stance: Stance;
  targetId: number; // entity id (unit or building), 0 = none
  path: TilePos[];
  pathTimer: number; // seconds until next repath allowed
  anchor: Vec2 | null; // defensive stance home
  cooldown: number;
  retargetTimer: number;
  // harvester bookkeeping
  harvestState: HarvesterState;
  assignedNode: number; // building id of boosted extractor/derrick
  stateTimer: number;
  /** tile key of the last load/unload spot — the next dock must differ, so the
   *  convoy visibly shuttles even when mine and HQ are adjacent (-1 = none) */
  lastDock: number;
  /** current path is an idle amble because the real goal is unreachable */
  wandering?: boolean;
}

export interface Building {
  id: number;
  team: TeamId;
  kind: BuildingKind;
  tile: TilePos;
  hp: number;
  maxHp: number;
  dmg: number;
  rateMult: number;
  prodUnit: UnitKind | null;
  prodInterval: number;
  territoryRadius: number;
  prodTimer: number;
  cooldown: number; // weapon cooldown for bunker/turret
  targetId: number;
  /** supply-truck service boost: seconds remaining (0 = unboosted) */
  boostTimer: number;
  /** income multiplier while boostTimer runs (set by the servicing truck) */
  boostMult: number;
  /** pooled production awaiting collection (manual-collect rule, extractor/derrick) */
  stored: number;
  /** electricity: false = grid over capacity, this building is dark and inert */
  powered: boolean;
  /** scripted/prebuilt structures draw no power (tutorials, elite camps) */
  freePower: boolean;
}

export interface Shell {
  id: number;
  team: TeamId;
  pos: Vec2;
  target: Vec2;
  speed: number;
  damage: number;
  radius: number;
  weapon: WeaponKind;
}

export interface PendingStrike {
  team: TeamId;
  pos: Vec2;
  timer: number;
  damage: number;
  radius: number;
  /** nuclear strike: bigger marker/blast, one-shots whatever it lands on */
  nuke?: boolean;
}

/** Base-defense alarm: the last friendly building hit by enemy fire. */
export interface BaseAlarm {
  pos: Vec2;
  time: number;
}

export type UpgradeId = 'sabot' | 'apammo' | 'reactive' | 'smoke' | 'barrels';

/** A card instance in a loadout: id may be an A or B side; up = forged upgrade. */
export interface CardRef {
  id: string;
  up: boolean;
}

export interface HandSlot {
  uid: number; // unique instance id for UI animation keys
  card: CardRef;
  ttl: number;
}

export interface PlayerState {
  team: TeamId;
  gold: number;
  oil: number;
  upgrades: Set<UpgradeId>;
  hand: (HandSlot | null)[];
  queue: CardRef[]; // upcoming cards; reshuffled loadout when empty
  loadout: CardRef[];
  drawTimer: number;
  /** per-desk reissue surcharges: one entry per recent refresh click, each
   *  cooling to zero on its own clock (REFRESH_SURGE / REFRESH_SURGE_DECAY) */
  refreshSurge: { building: number[]; unit: number[]; action: number[] };
  /** active team-wide order, null = units follow their own stances */
  order: StandingOrder | null;
  damageDealt: number; // tiebreak metric + stats
}

/** Scripted enemy spawn for tutorial/campaign scenarios. */
export interface Wave {
  t: number;
  team: TeamId;
  unit?: UnitKind;
  building?: BuildingKind;
  tile: { c: number; r: number };
  hp?: number;
}

export interface SimRules {
  /** team 0's building production pools up until collected by click */
  manualCollect: boolean;
  /** endgame pressure: faster late draws + nuclear strike cards after NUKE_UNLOCK_T */
  escalation: boolean;
  /** per-team income multiplier (elite/boss handicaps) */
  incomeMult: [number, number];
  /** tech tree + electricity. Off for scripted tutorials: no card tiers, grid always on. */
  tech: boolean;
  /** the HQ defends itself with its gun. Off for early scripted tutorials. */
  hqGun: boolean;
  /** which teams are human-commanded. Manual collection only applies to a human
   *  team (an AI can't click its mines); defaults to [player, AI]. Multiplayer
   *  sets both true so the manual-collect economy stays symmetric and fair. */
  humanTeams: [boolean, boolean];
}

export interface SimStart {
  gold?: [number, number];
  oil?: [number, number];
  hqHp?: [number | null, number | null];
  prebuilt?: Wave[]; // spawned at t=0 regardless of wave t
}

export interface SimOptions {
  mapLayout?: string[];
  rules?: Partial<SimRules>;
  start?: SimStart;
  waves?: Wave[];
}

export type SimEvent =
  | { t: 'unitSpawned'; id: number }
  | { t: 'unitDied'; id: number; kind: UnitKind; team: TeamId; pos: Vec2 }
  | { t: 'buildingPlaced'; id: number }
  | { t: 'buildingDestroyed'; id: number; kind: BuildingKind; team: TeamId; tile: TilePos }
  | { t: 'shot'; from: Vec2; to: Vec2; weapon: WeaponKind; team: TeamId; sourceId: number }
  | { t: 'impact'; pos: Vec2; weapon: WeaponKind }
  | { t: 'shellLanded'; pos: Vec2; radius: number }
  | { t: 'strikeCalled'; pos: Vec2; team: TeamId; nuke?: boolean }
  | { t: 'strikeHit'; pos: Vec2; nuke?: boolean }
  | { t: 'cardPlayed'; team: TeamId; cardId: string }
  | { t: 'cardDrawn'; team: TeamId; uid: number }
  | { t: 'cardExpired'; team: TeamId; uid: number }
  | { t: 'orderIssued'; team: TeamId; kind: OrderKind }
  | { t: 'truckCollect'; team: TeamId; id: number; kind: 'gold' | 'oil'; amount: number }
  | { t: 'buildingBoosted'; id: number }
  | { t: 'matchEnd'; winner: TeamId };

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function tileOf(p: Vec2): TilePos {
  return { c: Math.round(p.x), r: Math.round(p.y) };
}

export function posOfTile(t: TilePos): Vec2 {
  return { x: t.c, y: t.r };
}
