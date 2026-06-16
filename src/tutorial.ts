import type { GameOptions, Hint, HintArrow } from './game';
import type { Sim } from './sim/sim';
import { AI_PROFILES } from './sim/ai';
import type { BuildingKind, TeamId, UnitKind } from './sim/types';

/**
 * Tutorial campaign — eight battles, PvZ pacing: every mission is a real fight
 * that teaches exactly ONE new system and applies it immediately. Enemy HQs are
 * kept LOW in the infantry missions so a small force wins in seconds (no grind),
 * the tier-2 / tech systems are unrolled one rung at a time instead of dumped at
 * once, and short state-triggered hints — each with an on-screen arrow pointing
 * at the card / tile / badge to act on — guide brand-new players by the hand.
 *
 *   1 First Contact   deploy a squad, watch it auto-fight, smash the HQ
 *   2 Supply Lines    two-click mine placement, collect badges, spend
 *   3 Hold the Line   the counter triangle (rockets > tanks) + forest cover
 *   4 Dig In, Push Out buildings fight forever + territory creep
 *   5 Power Up        tech rung 1: electricity + tier LOCKS (no oil yet)
 *   6 Crude Awakening tech rung 2: oil + derrick + first tank + its counter
 *   7 Siege Doctrine  forced B-side: the Siege Tank cracks a walled HQ
 *   8 Total War       synthesis vs a live AI: factory, upgrade, escalation
 */

export interface Mission {
  id: number;
  name: string;
  blurb: string;
  build: (seed: number) => Omit<GameOptions, 'onEnd'>;
}

// ── hint authoring helpers ───────────────────────────────────────────────────
const h = (id: string, text: string, show: Hint['show'], done: Hint['done'], arrow?: HintArrow): Hint =>
  ({ id, text, show, done, arrow });

const card = (id: string): HintArrow => ({ kind: 'card', id });
const tile = (c: number, r: number): HintArrow => ({ kind: 'tile', c, r });
const ENEMY_HQ: HintArrow = { kind: 'enemyHq' };
const BADGE: HintArrow = { kind: 'badge' };

// ── sim-state predicates for hint show/done triggers ─────────────────────────
const has = (s: Sim, team: TeamId, kind: BuildingKind): boolean =>
  s.buildings.some((b) => b.team === team && b.kind === kind && b.hp > 0);
const live = (s: Sim, team: TeamId, kind: BuildingKind): boolean =>
  s.buildings.some((b) => b.team === team && b.kind === kind && b.hp > 0 && b.powered);
const hasUnit = (s: Sim, team: TeamId, kind: UnitKind): boolean =>
  s.units.some((u) => u.team === team && u.kind === kind);
/** standing (non-HQ) enemy structures — the M7 wall counter */
const enemyWall = (s: Sim): number =>
  s.buildings.filter((b) => b.team === 1 && b.kind !== 'hq' && b.hp > 0).length;
const onForest = (s: Sim, team: TeamId): boolean =>
  s.units.some((u) => u.team === team && s.map.terrainAt(Math.round(u.pos.x), Math.round(u.pos.y)) === 'forest');

export const MISSIONS: Mission[] = [
  {
    id: 1,
    name: 'First Contact',
    blurb: 'Deploy a squad. Watch it march and fight on its own.',
    build: (seed) => ({
      seed,
      playerLoadout: ['rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle'],
      simOptions: {
        rules: { manualCollect: false, escalation: false, tech: false, hqGun: false },
        start: { gold: [400, 0], hqHp: [null, 120] },
        waves: [
          { t: 0, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 70 },
          { t: 0, team: 1, unit: 'rifle', tile: { c: 10, r: 4 }, hp: 70 },
          { t: 45, team: 1, unit: 'rifle', tile: { c: 9, r: 3 }, hp: 70 }
        ]
      },
      hints: [
        h('deploy', 'Press a Rifle card — your squad musters at HQ and marches itself.',
          () => true, (s, g) => g.stats.cardsPlayed >= 1, card('rifle')),
        h('auto', 'They fight on their own. Keep the pressure up — pour more squads in.',
          (s, g) => g.stats.cardsPlayed >= 1, (s, g) => g.stats.cardsPlayed >= 3, card('rifle')),
        h('win', 'Smash the enemy HQ to win — that diamond up top is your target.',
          (s, g) => g.stats.cardsPlayed >= 3, (s) => s.time > 90, ENEMY_HQ)
      ]
    })
  },
  {
    id: 2,
    name: 'Supply Lines',
    blurb: 'Build a mine, bank the gold, and spend it on the war.',
    build: (seed) => ({
      seed,
      playerLoadout: ['extractor', 'harvester', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: false, hqGun: false },
        start: { gold: [120, 0], hqHp: [null, 160] },
        waves: [
          { t: 55, team: 1, unit: 'rifle', tile: { c: 9, r: 5 }, hp: 80 },
          { t: 58, team: 1, unit: 'buggy', tile: { c: 10, r: 5 }, hp: 90 },
          { t: 120, team: 1, unit: 'rifle', tile: { c: 9, r: 5 }, hp: 80 },
          { t: 122, team: 1, unit: 'rifle', tile: { c: 10, r: 5 }, hp: 80 }
        ]
      },
      hints: [
        h('arm', 'Press the Extractor card to ARM it — a blueprint ghost appears on the gold mine.',
          () => true, (s, g) => g.armedCardId() === 'extractor' || has(s, 0, 'extractor'), card('extractor')),
        h('place', 'Now CLICK the glowing gold mine to build it there. Right-click cancels.',
          (s, g) => g.armedCardId() === 'extractor' && !has(s, 0, 'extractor'), (s) => has(s, 0, 'extractor'), tile(1, 11)),
        h('collect', 'Gold pools at the mine. CLICK the badge to bank it — a full silo stops producing!',
          (s) => s.buildings.some((b) => b.team === 0 && b.stored >= 10), (s, g) => g.stats.collects >= 1, BADGE),
        h('spend', 'Banked gold buys squads. Spend it and push their HQ.',
          (s, g) => g.stats.collects >= 1, (s, g) => g.stats.cardsPlayed >= 3 || s.time > 130, card('rifle')),
        h('harvest', 'A Supply Truck auto-banks and boosts your mine — but it drives exposed. Protect it.',
          (s) => s.time > 70, (s) => hasUnit(s, 0, 'harvester') || s.time > 150, card('harvester'))
      ]
    })
  },
  {
    id: 3,
    name: 'Hold the Line',
    blurb: 'Tanks are coming. Rifles bounce off — bring the right tool.',
    build: (seed) => ({
      seed,
      playerLoadout: ['rocket', 'rocket', 'rocket', 'rifle', 'rifle', 'rifle', 'attackorder', 'rifle'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: false, hqGun: false },
        start: {
          gold: [280, 0],
          hqHp: [null, 200],
          prebuilt: [{ t: 0, team: 0, building: 'extractor', tile: { c: 1, r: 11 } }]
        },
        waves: [
          { t: 18, team: 1, unit: 'tank', tile: { c: 9, r: 4 }, hp: 200 },
          { t: 60, team: 1, unit: 'tank', tile: { c: 3, r: 4 }, hp: 220 },
          { t: 100, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 80 },
          { t: 102, team: 1, unit: 'rifle', tile: { c: 10, r: 4 }, hp: 80 },
          { t: 150, team: 1, unit: 'tank', tile: { c: 9, r: 4 }, hp: 300 }
        ]
      },
      hints: [
        h('armor', 'Tank inbound! Rifles bounce off armor — Rocket Teams hold ground and melt tanks.',
          () => true, (s) => hasUnit(s, 0, 'rocket') || s.players[0].damageDealt > 150, card('rocket')),
        h('triangle', 'The triangle: rockets beat tanks, rifles beat rockets, MG bunkers beat rifles. Mix, don’t mass.',
          (s) => s.time > 45, (s) => s.time > 90),
        h('forest', 'Park infantry in forest — the trees cut incoming fire by 30%.',
          (s) => s.time > 90, (s) => onForest(s, 0) || s.time > 140, tile(8, 8)),
        h('finish', 'Armor cleared — order a General Offensive and drive everything into their HQ.',
          (s) => s.time > 120, (s) => s.time > 180, card('attackorder'))
      ]
    })
  },
  {
    id: 4,
    name: 'Dig In, Push Out',
    blurb: 'Buildings fight forever and shove your territory forward.',
    build: (seed) => ({
      seed,
      playerLoadout: ['barracks', 'bunker', 'extractor', 'extractor', 'rifle', 'rifle', 'rocket', 'rifle'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: false, hqGun: false },
        start: {
          gold: [220, 0],
          hqHp: [null, 260],
          prebuilt: [
            { t: 0, team: 1, building: 'barracks', tile: { c: 8, r: 4 } },
            { t: 0, team: 0, building: 'extractor', tile: { c: 1, r: 11 } }
          ]
        },
        waves: [
          { t: 70, team: 1, unit: 'rifle', tile: { c: 4, r: 4 }, hp: 80 },
          { t: 150, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 80 },
          { t: 230, team: 1, unit: 'tank', tile: { c: 8, r: 3 }, hp: 280 }
        ]
      },
      hints: [
        h('barracks', 'Arm the Barracks, then CLICK a land tile to build it. It trains squads forever and pushes a lane.',
          () => true, (s) => has(s, 0, 'barracks'), card('barracks')),
        h('territory', 'Every building EXTENDS your build zone (the glowing tiles). Place forward to creep toward the enemy.',
          (s) => has(s, 0, 'barracks'),
          // satisfied by placing a building at the forward frontier (the arrow tile {6,9}
          // is chebyshev 4 from HQ); time fallback so it can never permanently shadow the
          // later M4 hints if the player builds only close to home
          (s) => s.buildings.some((b) => b.team === 0 && b.kind !== 'hq' && b.hp > 0 && Math.max(Math.abs(b.tile.c - 2), Math.abs(b.tile.r - 10)) >= 4) || s.time > 160,
          tile(6, 9)),
        h('bunker', 'Plant a Bunker on your new frontier — its MG shreds infantry and never retreats.',
          (s) => has(s, 0, 'barracks') && s.time > 50, (s) => has(s, 0, 'bunker') || s.time > 150, card('bunker')),
        h('outbuild', 'Their Barracks feeds one lane. Out-produce it — or burn it down.',
          (s) => s.time > 120, (s) => enemyWall(s) === 0 || s.time > 220, tile(8, 4))
      ]
    })
  },
  {
    id: 5,
    name: 'Power Up',
    blurb: 'Nothing runs without electricity. Light the grid, climb the ladder.',
    build: (seed) => ({
      seed,
      playerLoadout: ['powerplant', 'extractor', 'barracks', 'rifle', 'rifle', 'rifle', 'rocket', 'bunker'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: true, hqGun: false },
        start: { gold: [120, 0], hqHp: [null, 220] },
        waves: [
          { t: 0, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 80 },
          { t: 70, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 90 },
          { t: 140, team: 1, unit: 'rifle', tile: { c: 10, r: 4 }, hp: 90 },
          { t: 200, team: 1, unit: 'buggy', tile: { c: 10, r: 5 }, hp: 100 }
        ]
      },
      hints: [
        h('power', 'With tech ON, EVERYTHING needs power. The Power Plant has no lock — arm it first.',
          () => true, (s) => has(s, 0, 'powerplant'), card('powerplant')),
        h('powerplace', 'CLICK a buildable land tile just forward of your HQ to drop the plant.',
          (s, g) => g.armedCardId() === 'powerplant' && !has(s, 0, 'powerplant'), (s) => has(s, 0, 'powerplant'), tile(3, 9)),
        h('unlock', 'Grid live — locked cards just unlocked! Arm the Extractor and click the gold mine.',
          (s) => has(s, 0, 'powerplant') && !has(s, 0, 'extractor'), (s) => has(s, 0, 'extractor'), tile(1, 11)),
        h('creep', 'Power feeds a Barracks now. Place it FORWARD to creep your frontier and out-produce them.',
          (s) => has(s, 0, 'extractor') && s.time > 50, (s) => has(s, 0, 'barracks') || s.time > 160, card('barracks'))
      ]
    })
  },
  {
    id: 6,
    name: 'Crude Awakening',
    blurb: 'Oil unlocks armor. Roll out your first tank — and respect its counter.',
    build: (seed) => ({
      seed,
      playerLoadout: ['powerplant', 'extractor', 'derrick', 'tank', 'rocket', 'rifle', 'rifle', 'attackorder'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: true, hqGun: false },
        start: { gold: [200, 0], oil: [40, 0], hqHp: [null, 320] },
        waves: [
          { t: 50, team: 1, unit: 'rocket', tile: { c: 9, r: 4 }, hp: 100 },
          { t: 110, team: 1, unit: 'rocket', tile: { c: 9, r: 4 }, hp: 100 },
          { t: 113, team: 1, unit: 'rifle', tile: { c: 10, r: 4 }, hp: 80 },
          { t: 180, team: 1, unit: 'rocket', tile: { c: 3, r: 4 }, hp: 100 }
        ]
      },
      hints: [
        h('open', 'Open like you trained: arm the Power Plant and place it near HQ.',
          (s) => !has(s, 0, 'powerplant'), (s) => has(s, 0, 'powerplant'), card('powerplant')),
        h('extract', 'Now the Extractor on the gold mine — it feeds the grid and unlocks the next tier.',
          (s) => has(s, 0, 'powerplant') && !has(s, 0, 'extractor'), (s) => has(s, 0, 'extractor'), tile(1, 11)),
        h('oilgate', 'Tanks run on OIL. Arm the Derrick and CLICK the oil field to reach Tier 2.',
          (s) => live(s, 0, 'extractor') && !has(s, 0, 'derrick'), (s) => has(s, 0, 'derrick'), tile(5, 8)),
        h('tankunlock', 'Derrick live — TIER 2 unlocked! The Tank lock cleared. Bank oil, then roll it out.',
          (s) => live(s, 0, 'derrick') && !hasUnit(s, 0, 'tank'), (s) => hasUnit(s, 0, 'tank'), card('tank')),
        h('screen', 'Their Rocket Teams hunt your tank — armor still loses to rockets. Screen it with rifles.',
          (s) => hasUnit(s, 0, 'tank') && s.time > 40, (s) => s.time > 150, card('rifle')),
        h('crush', 'A tank shrugs off infantry and smashes buildings. Order the offensive and drive it home.',
          (s) => hasUnit(s, 0, 'tank'), (s) => s.time > 190, card('attackorder'))
      ]
    })
  },
  {
    id: 7,
    name: 'Siege Doctrine',
    blurb: 'Their HQ hides behind a wall. The same tank, a different doctrine, breaks it.',
    build: (seed) => ({
      seed,
      playerLoadout: ['powerplant', 'extractor', 'derrick', 'tank_b', 'rocket', 'rifle', 'airstrike', 'attackorder'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: true, hqGun: false },
        start: {
          gold: [240, 0],
          oil: [80, 0],
          hqHp: [null, 350],
          prebuilt: [
            { t: 0, team: 0, building: 'powerplant', tile: { c: 3, r: 9 } },
            { t: 0, team: 0, building: 'extractor', tile: { c: 1, r: 11 } },
            { t: 0, team: 1, building: 'bunker', tile: { c: 9, r: 4 } },
            { t: 0, team: 1, building: 'bunker', tile: { c: 10, r: 3 } },
            { t: 0, team: 1, building: 'atturret', tile: { c: 8, r: 3 } }
          ]
        },
        waves: [
          { t: 40, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 80 },
          { t: 120, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 80 }
        ]
      },
      hints: [
        h('setup', 'Their HQ hides behind a wall. Reach Tier 2 first — arm the Derrick and CLICK the oil field.',
          (s) => !has(s, 0, 'derrick'), (s) => has(s, 0, 'derrick'), tile(5, 8)),
        h('bside', 'B-side card! The purple B = SIEGE doctrine, +50% vs buildings. (In campaign you flip A↔B between battles.) Roll it out.',
          (s) => has(s, 0, 'derrick') && !hasUnit(s, 0, 'tank'), (s) => hasUnit(s, 0, 'tank'), card('tank_b')),
        h('wall', 'Infantry bounce off that wall — your Siege Tank is built to demolish bunkers. Smash a hole.',
          (s) => hasUnit(s, 0, 'tank') && enemyWall(s) >= 3, (s) => enemyWall(s) < 3, tile(9, 4)),
        h('breach', 'Wall breached — pour through into their HQ. (Airstrike can crack a stubborn cluster.)',
          (s) => enemyWall(s) < 3, (s) => s.time > 220, ENEMY_HQ)
      ]
    })
  },
  {
    id: 8,
    name: 'Total War',
    blurb: 'Everything you trained, at once, against a real commander.',
    build: (seed) => ({
      seed,
      playerLoadout: [
        'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'factory', 'bunker',
        'rifle', 'rifle', 'rocket', 'tank', 'harvester', 'sabot', 'airstrike', 'attackorder'
      ],
      aiLoadout: [
        'powerplant', 'powerplant', 'extractor', 'extractor', 'derrick', 'barracks', 'factory', 'bunker',
        'rifle', 'rifle', 'rocket', 'tank', 'howitzer', 'harvester', 'airstrike', 'attackorder'
      ],
      aiProfile: AI_PROFILES.standard,
      simOptions: {
        rules: { manualCollect: true, escalation: true, tech: true, hqGun: true, incomeMult: [1, 0.85] },
        start: { gold: [180, 130] }
      },
      hints: [
        h('open', 'Full battle. Open the way you trained: Power, then Extractor, then Derrick. Build forward.',
          (s) => s.time < 60 && !has(s, 0, 'powerplant'), (s) => has(s, 0, 'powerplant') || s.time > 60, card('powerplant')),
        h('factory', 'A War Factory rolls out a tank every 20s on its own — your armor, automated. Place it forward.',
          (s) => has(s, 0, 'derrick') && !has(s, 0, 'factory') && s.time > 60, (s) => has(s, 0, 'factory') || s.time > 200, card('factory')),
        h('upgrade', 'Sabot Rounds is PERMANENT for the whole battle — bank oil for it; your tanks bite harder forever.',
          (s) => has(s, 0, 'factory') && s.time > 120, (s) => s.players[0].upgrades.size > 0 || s.time > 260, card('sabot')),
        h('airstrike', 'Airstrike hits anywhere after a short delay — save it for a turtled cluster or a wounded HQ.',
          (s) => s.time > 200 && s.players[0].oil >= 40, (s) => s.time > 300, card('airstrike')),
        h('clock', 'At 5:00 supplies surge; at 8:00 NUKES are dealt to BOTH sides — land yours first. End it.',
          (s) => s.time > 290, (s) => s.time > 380, ENEMY_HQ)
      ]
    })
  }
];

const LS_TUT = 'frontline.tutorial.v2';

export function tutorialProgress(): number {
  const n = parseInt(localStorage.getItem(LS_TUT) ?? '0', 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(MISSIONS.length, n)) : 0;
}

export function completeTutorial(id: number): void {
  if (id > tutorialProgress()) localStorage.setItem(LS_TUT, String(id));
}
