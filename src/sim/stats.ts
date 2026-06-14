import type { ArmorClass, BuildingKind, Stance, UnitKind, WeaponKind } from './types';

/** Central balance tables. Tune the game here. Distances in tiles, times in seconds. */

export const TICK_DT = 0.05; // 20 Hz fixed-step sim

// the hand is partitioned by staff desk: 2 building slots (infrastructure),
// 2 unit slots (frontline), 2 action slots (strategy) — see cards.ts CATEGORY_SLOTS
export const HAND_SIZE = 6;
export const INITIAL_HAND = 4;
// global deal timer: a card arrives every rng(MIN..MAX) seconds regardless of
// hand state (a full desk wastes the deal). Proposals linger one long TTL, so
// an idle commander's desks fill up and hold.
export const DRAW_INTERVAL_MIN = 5.0;
export const DRAW_INTERVAL_MAX = 6.0;
export const CARD_TTL = 50;
export const LOADOUT_SIZE = 16;
// paid desk refresh: discard a desk's proposals, two fresh ones arrive at once.
// Each click also slaps a +REFRESH_SURGE temporary surcharge on that desk's
// price; every click's surcharge cools off on its own clock at
// REFRESH_SURGE_DECAY gold/s, so spam rerolling gets expensive fast but the
// price always settles back to REFRESH_COST.
export const REFRESH_COST = 10;
export const REFRESH_DEAL = 2;
export const REFRESH_SURGE = 10;
export const REFRESH_SURGE_DECAY = 1; // gold/s, per click's surcharge
// team-wide order cards stay in effect this long
export const ORDER_DURATION = 60;
// tier-up moment: when a gate building goes live, this many cards of the newly
// unlocked tier are dealt on the spot (echoes the plants-only opening deal)
export const TIER_UNLOCK_DEAL = 2;

// manual resource collection (human player): each extractor/derrick pools its
// own production in 10-packages — the badge pops at 10 and grows 20, 30, ...
// up to the cap; a full silo pauses production until collected
export const COLLECT_STEP = 10;
export const STORE_CAP_GOLD = 90;
export const STORE_CAP_OIL = 60;

export const HQ_INCOME_GOLD = 1; // per second
export const EXTRACTOR_INCOME = 3; // gold/s
export const DERRICK_INCOME = 2; // oil/s
// supply truck service call: docking at a mine/derrick banks its whole silo
// (the manual collect, automated) and boosts that building for a while
export const HARVESTER_BOOST = 1.0; // +100% output while the boost timer runs
export const CONVOY_BOOST_DURATION = 15; // seconds of boost per service call
// per-axis slide toward the structure while docking — bounded so the truck's
// rounded tile stays on its door tile (the convoy's avoid/lastDock bookkeeping)
export const HARVESTER_TUCK = 0.45;

// Territory (where you may build/expand): the HQ projects a generous home
// zone; every other structure projects its own reach, so each placement —
// economy included — pushes the frontier a little further out.
export const TERRITORY_HQ = 4;
export const TERRITORY_BUILDING = 3;

// Endgame pressure: no hard time limit, but long games escalate.
export const ESCALATE_DRAW_T = 300; // faster draws after 5:00
export const ESCALATE_DRAW_MULT = 0.6;
// Nuclear option: after this long, both players are periodically dealt a free
// Nuclear Strike card — one hit erases anything, HQs included. End it.
export const NUKE_UNLOCK_T = 480; // 8:00
export const NUKE_REDEAL = 30; // seconds between nuke deals while one isn't held
export const NUKE = {
  delay: 3.0,
  damage: 99999,
  radius: 2.0
};

// Base-defense alarm: defensive units rush the last building hit for this long.
export const ALARM_HOLD = 8;

export interface UnitStats {
  hp: number;
  speed: number; // tiles/s
  range: number; // tiles
  minRange: number;
  damage: number;
  cooldown: number;
  weapon: WeaponKind;
  armor: ArmorClass;
  sight: number;
  stance: Stance;
  splash: number; // splash radius in tiles, 0 = single target
  guardRadius: number; // defensive stance leash
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  rifle:     { hp: 90,  speed: 1.2, range: 2.2, minRange: 0, damage: 8,  cooldown: 0.6, weapon: 'smallarms', armor: 'infantry', sight: 4.0, stance: 'aggressive', splash: 0,   guardRadius: 3 },
  rocket:    { hp: 100, speed: 1.1, range: 3.0, minRange: 0, damage: 70, cooldown: 2.2, weapon: 'at',        armor: 'infantry', sight: 4.5, stance: 'defensive',  splash: 0,   guardRadius: 3 },
  tank:      { hp: 380, speed: 0.9, range: 2.8, minRange: 0, damage: 50, cooldown: 1.8, weapon: 'cannon',    armor: 'armor',    sight: 4.5, stance: 'aggressive', splash: 0.5, guardRadius: 3 },
  howitzer:  { hp: 120, speed: 0.7, range: 7.0, minRange: 2.5, damage: 70, cooldown: 4.0, weapon: 'artillery', armor: 'light',  sight: 7.5, stance: 'defensive',  splash: 1.2, guardRadius: 1.5 },
  harvester: { hp: 150, speed: 1.3, range: 0,   minRange: 0, damage: 0,  cooldown: 1,   weapon: 'none',      armor: 'light',    sight: 3.0, stance: 'economic',   splash: 0,   guardRadius: 0 },
  buggy:     { hp: 110, speed: 2.4, range: 1.8, minRange: 0, damage: 10, cooldown: 0.4, weapon: 'smallarms', armor: 'light',    sight: 5.0, stance: 'raider',     splash: 0,   guardRadius: 3 }
};

export interface BuildingStats {
  hp: number;
  range: number;
  damage: number;
  cooldown: number;
  weapon: WeaponKind;
  sight: number;
  prodUnit: UnitKind | null;
  prodInterval: number;
  territory: number; // build-zone projection radius, 0 = none
  /** electricity: positive = generates, negative = draws. An unpowered building is inert. */
  power: number;
}

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  // hq gun tuned LOW: it discourages trickle attacks but must not solo a push;
  // hp modest on purpose — a committed wave that reaches the HQ ends the game
  hq:         { hp: 1000, range: 3.4, damage: 8,  cooldown: 0.9,  weapon: 'hqgun', sight: 5, prodUnit: null,   prodInterval: 0,  territory: TERRITORY_HQ,       power: 0 },
  // plants are fragile by design — the grid is a raid target
  powerplant: { hp: 120,  range: 0,   damage: 0,  cooldown: 0,    weapon: 'none', sight: 2, prodUnit: null,    prodInterval: 0,  territory: TERRITORY_BUILDING, power: 8 },
  extractor:  { hp: 200,  range: 0,   damage: 0,  cooldown: 0,    weapon: 'none', sight: 2, prodUnit: null,    prodInterval: 0,  territory: TERRITORY_BUILDING, power: -2 },
  derrick:    { hp: 200,  range: 0,   damage: 0,  cooldown: 0,    weapon: 'none', sight: 2, prodUnit: null,    prodInterval: 0,  territory: TERRITORY_BUILDING, power: -2 },
  barracks:   { hp: 450,  range: 0,   damage: 0,  cooldown: 0,    weapon: 'none', sight: 3, prodUnit: 'rifle', prodInterval: 11, territory: TERRITORY_BUILDING, power: -3 },
  factory:    { hp: 550,  range: 0,   damage: 0,  cooldown: 0,    weapon: 'none', sight: 3, prodUnit: 'tank',  prodInterval: 20, territory: TERRITORY_BUILDING, power: -5 },
  bunker:     { hp: 400,  range: 2.6, damage: 9,  cooldown: 0.35, weapon: 'mg',   sight: 4, prodUnit: null,    prodInterval: 0,  territory: TERRITORY_BUILDING, power: -2 },
  atturret:   { hp: 350,  range: 3.2, damage: 55, cooldown: 2.0,  weapon: 'at',   sight: 4.5, prodUnit: null,  prodInterval: 0,  territory: TERRITORY_BUILDING, power: -3 }
};

/** Damage multiplier matrix: weapon kind vs armor class. The counter system. */
export const DAMAGE_MATRIX: Record<Exclude<WeaponKind, 'none'>, Record<ArmorClass, number>> = {
  smallarms: { infantry: 1.0,  armor: 0.15, light: 0.7, building: 0.3 },
  mg:        { infantry: 1.4,  armor: 0.1,  light: 0.9, building: 0.2 },
  at:        { infantry: 0.35, armor: 1.5,  light: 0.8, building: 0.8 },
  cannon:    { infantry: 0.9,  armor: 1.0,  light: 1.0, building: 1.3 },
  artillery: { infantry: 1.3,  armor: 0.7,  light: 1.2, building: 1.5 },
  // the HQ's medium gun: even, unexciting damage to every troop type — it
  // grinds down trickle attacks so only a committed wave can crack a base
  hqgun:     { infantry: 1.0,  armor: 1.0,  light: 1.0, building: 0.5 }
};

/** every damage roll lands in [1-V, 1+V] × the computed value */
export const DAMAGE_VARIANCE = 0.18;

export const AIRSTRIKE = {
  delay: 1.5,
  damage: 110,
  radius: 1.6
};

export const SHELL_SPEED = 4.5; // howitzer shell travel, tiles/s

export const FOREST_COVER = 0.3;
export const SMOKE_COVER = 0.55; // with smoke doctrine upgrade

/** Forge (campaign card upgrade) effect multipliers, applied per card instance. */
export const FORGE_UNIT = { hp: 1.3, dmg: 1.25 };
export const FORGE_BUILDING = { hp: 1.3, rate: 1.25, prod: 0.8 };
export const FORGE_STRIKE = 1.3;

export const UPGRADE_EFFECTS = {
  sabot: 1.4,    // tank cannon vs armor multiplier
  apammo: 2.5,   // smallarms vs armor multiplier
  reactive: 0.65, // AT damage taken by own armor units
  barrels: 1.5   // howitzer +range
};
