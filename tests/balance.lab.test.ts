import { describe, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { AI_LOADOUTS } from '../src/sim/cards';
import { AI_PROFILES, AiController, runHeadlessMatch } from '../src/sim/ai';

/**
 * Balance lab — not part of the normal suite. Run with:
 *   BALANCE=1 npx vitest run tests/balance.lab.test.ts
 * Prints win rates and match durations across matchups and seeds.
 */

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe.runIf(!!process.env.BALANCE)('balance lab', () => {
  it('matchup win rates', () => {
    const names = Object.keys(AI_LOADOUTS);
    console.log('\n── matchup grid (team0 wins / games, avg duration) ──');
    for (const a of names) {
      for (const b of names) {
        let wins0 = 0;
        let totalT = 0;
        for (const seed of SEEDS) {
          const { winner, time } = runHeadlessMatch({ seed, loadouts: [AI_LOADOUTS[a], AI_LOADOUTS[b]] });
          if (winner === 0) wins0++;
          totalT += time;
        }
        console.log(`${a.padEnd(9)} vs ${b.padEnd(9)} → ${wins0}/${SEEDS.length} wins, avg ${(totalT / SEEDS.length).toFixed(0)}s`);
      }
    }
  }, 600000);

  it('rush pressure vs a passive player', () => {
    console.log('\n── time for each AI profile to kill a do-nothing opponent ──');
    for (const [name, profile] of Object.entries(AI_PROFILES)) {
      const loadout = name === 'aggressive' ? AI_LOADOUTS.rush : name === 'turtle' ? AI_LOADOUTS.armor : AI_LOADOUTS.balanced;
      let total = 0;
      for (const seed of SEEDS.slice(0, 5)) {
        const sim = new Sim(seed, [AI_LOADOUTS.balanced, loadout]);
        const ai = new AiController(1, seed * 13 + 2, profile);
        while (!sim.result && sim.time < 700) {
          ai.update(sim, 0.05);
          sim.step();
          sim.events.length = 0;
        }
        total += sim.time;
      }
      console.log(`${name.padEnd(11)} kills passive player in avg ${(total / 5).toFixed(0)}s`);
    }
  }, 600000);
});

// keep vitest happy when the lab is skipped
describe('balance lab placeholder', () => {
  it('is gated behind BALANCE=1', () => {});
});
