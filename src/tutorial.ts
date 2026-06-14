import type { GameOptions, Hint } from './game';
import { AI_PROFILES } from './sim/ai';
import { AI_LOADOUTS } from './sim/cards';

/**
 * Tutorial campaign — PvZ pacing: every mission is a real battle, each one
 * introduces a single new system, hints are short and state-triggered.
 */

export interface Mission {
  id: number;
  name: string;
  blurb: string;
  build: (seed: number) => Omit<GameOptions, 'onEnd'>;
}

const h = (id: string, text: string, show: Hint['show'], done: Hint['done']): Hint => ({ id, text, show, done });

export const MISSIONS: Mission[] = [
  {
    id: 1,
    name: 'First Contact',
    blurb: 'Deploy squads. Watch them fight.',
    build: (seed) => ({
      seed,
      playerLoadout: ['rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle'],
      simOptions: {
        rules: { manualCollect: false, escalation: false, tech: false, hqGun: false },
        start: { gold: [400, 0], hqHp: [null, 700] },
        waves: [
          { t: 0, team: 1, unit: 'rifle', tile: { c: 9, r: 4 }, hp: 70 },
          { t: 0, team: 1, unit: 'rifle', tile: { c: 10, r: 4 }, hp: 70 },
          { t: 45, team: 1, unit: 'rifle', tile: { c: 10, r: 3 }, hp: 70 },
          { t: 90, team: 1, unit: 'rifle', tile: { c: 9, r: 3 }, hp: 70 }
        ]
      },
      hints: [
        h('deploy', 'Press a Rifle card — the squad musters at your HQ.', () => true, (s, g) => g.stats.cardsPlayed >= 1),
        h('auto', 'Your squads fight on their own — keep feeding the push.', (s, g) => g.stats.cardsPlayed >= 1, (s, g) => g.stats.cardsPlayed >= 3),
        h('expire', 'Proposals expire — the EXP stamp counts down. Use them or lose them.', (s, g) => g.stats.cardsPlayed >= 3 && s.time > 30, (s) => s.time > 55),
        h('win', 'Destroy the enemy HQ to win.', (s, g) => g.stats.cardsPlayed >= 3, (s) => s.time > 90)
      ]
    })
  },
  {
    id: 2,
    name: 'Supply Lines',
    blurb: 'Mine gold. Collect it. Spend it.',
    build: (seed) => ({
      seed,
      playerLoadout: ['extractor', 'extractor', 'harvester', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: false, hqGun: false },
        start: { gold: [110, 0], hqHp: [null, 900] },
        waves: [
          { t: 55, team: 1, unit: 'rifle', tile: { c: 9, r: 5 } },
          { t: 56, team: 1, unit: 'rifle', tile: { c: 10, r: 5 } },
          { t: 110, team: 1, unit: 'rifle', tile: { c: 9, r: 5 } },
          { t: 111, team: 1, unit: 'buggy', tile: { c: 10, r: 5 } },
          { t: 165, team: 1, unit: 'rifle', tile: { c: 9, r: 5 } },
          { t: 166, team: 1, unit: 'rifle', tile: { c: 10, r: 5 } }
        ]
      },
      hints: [
        h('mine', 'Play the Extractor card — it builds itself on the nearest gold mine.', () => true, (s) => s.buildings.some((b) => b.team === 0 && b.kind === 'extractor')),
        h('collect', 'Gold piles up at the mine — CLICK the ¤ badge there to bank it! Full mines stop producing.', (s) => s.buildings.some((b) => b.team === 0 && b.stored >= 10), (s, g) => g.stats.collects >= 1),
        h('harvest', 'A Supply Truck banks your mines and boosts them. It drives exposed — protect it.', (s, g) => g.stats.collects >= 1 && s.time > 40, (s) => s.units.some((u) => u.team === 0 && u.kind === 'harvester') || s.time > 130),
        h('push2', 'Raiders will come for your economy. Fund the counter-push.', (s) => s.time > 60, (s) => s.time > 150)
      ]
    })
  },
  {
    id: 3,
    name: 'Armor Doctrine',
    blurb: 'Tanks are coming. Counter them.',
    build: (seed) => ({
      seed,
      playerLoadout: ['rocket', 'rocket', 'rocket', 'rocket', 'rifle', 'rifle', 'bunker', 'rifle'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: false, hqGun: false },
        start: { gold: [260, 0], hqHp: [null, 800], prebuilt: [{ t: 0, team: 0, building: 'extractor', tile: { c: 1, r: 11 } }] },
        waves: [
          { t: 18, team: 1, unit: 'tank', tile: { c: 9, r: 4 }, hp: 240 },
          { t: 60, team: 1, unit: 'tank', tile: { c: 3, r: 4 }, hp: 240 },
          { t: 100, team: 1, unit: 'tank', tile: { c: 9, r: 4 }, hp: 300 },
          { t: 102, team: 1, unit: 'rifle', tile: { c: 10, r: 4 } },
          { t: 150, team: 1, unit: 'tank', tile: { c: 9, r: 4 }, hp: 300 },
          { t: 151, team: 1, unit: 'tank', tile: { c: 3, r: 4 }, hp: 300 }
        ]
      },
      hints: [
        h('armor', 'Enemy armor inbound — Rocket Teams hold ground and melt tanks.', () => true, (s) => s.players[0].damageDealt > 200),
        h('counters', 'Counters win fights: rockets beat tanks, rifles beat rockets, MGs beat rifles.', (s) => s.time > 65, (s) => s.time > 110),
        h('forest', 'Infantry standing in forest takes far less fire.', (s) => s.time > 110, (s) => s.time > 160)
      ]
    })
  },
  {
    id: 4,
    name: 'Production War',
    blurb: 'Buildings fight forever. Place them forward.',
    build: (seed) => ({
      seed,
      playerLoadout: ['barracks', 'barracks', 'extractor', 'extractor', 'bunker', 'bunker', 'rocket', 'rocket', 'rifle', 'rifle'],
      simOptions: {
        rules: { manualCollect: true, escalation: false, tech: false, hqGun: false },
        start: {
          gold: [200, 0],
          hqHp: [null, 1300],
          prebuilt: [
            { t: 0, team: 1, building: 'barracks', tile: { c: 8, r: 4 } },
            { t: 0, team: 1, building: 'extractor', tile: { c: 11, r: 1 } }
          ]
        },
        waves: [
          { t: 80, team: 1, unit: 'rifle', tile: { c: 4, r: 4 } },
          { t: 160, team: 1, unit: 'rifle', tile: { c: 4, r: 4 } },
          { t: 240, team: 1, unit: 'tank', tile: { c: 8, r: 3 }, hp: 300 }
        ]
      },
      hints: [
        h('barracks', 'A Barracks trains squads forever and pushes the nearest bridge.', () => true, (s) => s.buildings.some((b) => b.team === 0 && b.kind === 'barracks')),
        h('territory', 'Every building you place pushes your build zone outward — creep toward the enemy.', (s) => s.time > 45, (s) => s.buildings.some((b) => b.team === 0 && b.kind !== 'hq' && Math.abs(b.tile.c - 2) + Math.abs(b.tile.r - 10) > 6)),
        h('lane', 'Their barracks feeds one lane. Out-produce it or burn it down.', (s) => s.time > 90, (s) => s.time > 150)
      ]
    })
  },
  {
    id: 5,
    name: 'Combined Arms',
    blurb: 'Everything at once, against a real commander.',
    build: (seed) => ({
      seed,
      playerLoadout: [...AI_LOADOUTS.balanced],
      aiLoadout: [...AI_LOADOUTS.balanced],
      aiProfile: AI_PROFILES.turtle,
      simOptions: {
        rules: { manualCollect: true, escalation: true, incomeMult: [1, 0.75] },
        start: { gold: [180, 120] }
      },
      hints: [
        h('power', 'Nothing runs without electricity — open with a Power Plant.', () => true, (s) => s.buildings.some((b) => b.team === 0 && b.kind === 'powerplant') || s.time > 60),
        h('tiers', 'Tech ladder: Plant → Extractor → Derrick unlock higher tiers. Watch the 🔒 on cards.', (s) => s.buildings.some((b) => b.team === 0 && b.kind === 'powerplant'), (s) => s.buildings.some((b) => b.team === 0 && b.kind === 'derrick') || s.time > 120),
        h('oil', 'Oil fields fund armor — claim the derrick site early.', (s) => s.time > 40, (s) => s.buildings.some((b) => b.team === 0 && b.kind === 'derrick') || s.time > 90),
        h('upgrades', 'Upgrade cards are permanent for the whole battle. Bank for them.', (s) => s.time > 100, (s) => s.players[0].upgrades.size > 0 || s.time > 180),
        h('clock', 'After 5:00 supplies surge. After 8:00 nuclear strikes unlock — land one first.', (s) => s.time > 250, (s) => s.time > 330)
      ]
    })
  }
];

const LS_TUT = 'frontline.tutorial.v1';

export function tutorialProgress(): number {
  const n = parseInt(localStorage.getItem(LS_TUT) ?? '0', 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(MISSIONS.length, n)) : 0;
}

export function completeTutorial(id: number): void {
  if (id > tutorialProgress()) localStorage.setItem(LS_TUT, String(id));
}
