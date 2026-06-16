import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { playRun, makePolicy, formatReport, summarize, RunResult, AI_PROFILES } from './campaignLab';

/**
 * Campaign balance Monte-Carlo. NOT part of the normal suite. Run with:
 *   CAMPAIGN=1 npx vitest run tests/campaign-sim.lab.test.ts
 * Optional knobs:  CAMPAIGN_SEEDS=60  CAMPAIGN_TAG=baseline
 *
 * Plays whole runs headless across many seeds and three player "greed" profiles
 * (cautious / balanced / aggressive node selection), prints per-depth win-rate
 * curves + death histograms, and dumps raw results to .lab/<tag>.json.
 */

const N = parseInt(process.env.CAMPAIGN_SEEDS ?? '40', 10);
const TAG = process.env.CAMPAIGN_TAG ?? 'run';

const POLICIES = [
  makePolicy('cautious', 0.2),
  makePolicy('balanced', 0.5),
  makePolicy('aggressive', 0.85)
];

describe.runIf(!!process.env.CAMPAIGN)('campaign balance lab', () => {
  it('plays the campaign across seeds and reports the difficulty curve', () => {
    const all: RunResult[] = [];
    const perPolicy: Record<string, RunResult[]> = {};
    for (const policy of POLICIES) {
      const rs: RunResult[] = [];
      for (let s = 0; s < N; s++) {
        rs.push(playRun(1000 + s * 17, policy, AI_PROFILES.standard));
      }
      perPolicy[policy.name] = rs;
      all.push(...rs);
    }

    for (const policy of POLICIES) console.log(formatReport(policy.name, perPolicy[policy.name]));
    console.log(formatReport('ALL POLICIES', all));

    // headline numbers for quick scanning + tuning targets
    const s = summarize(all);
    console.log('\n── headline ──');
    console.log(`runs ${s.runs}  victory ${(s.victoryRate * 100).toFixed(1)}%  act2 ${(s.reachedAct2 * 100).toFixed(1)}%  act3 ${(s.reachedAct3 * 100).toFixed(1)}%  avgFights ${s.avgBattlesPerRun.toFixed(1)}`);

    try {
      mkdirSync('.lab', { recursive: true });
      writeFileSync(`.lab/${TAG}.json`, JSON.stringify({ tag: TAG, n: N, perPolicy, summary: s }, null, 1));
      console.log(`\nraw → .lab/${TAG}.json`);
    } catch (e) {
      console.log('could not write .lab json:', String(e));
    }
  }, 1_800_000);
});

// keep vitest green when the lab is gated off
describe('campaign lab placeholder', () => {
  it('is gated behind CAMPAIGN=1', () => {});
});
