import type { HandCategory } from '../sim/cards';
import type { Sim, PlayResult } from '../sim/sim';
import type { TeamId } from '../sim/types';
import type { TilePos } from '../sim/map';

/**
 * Wire protocol for deterministic-lockstep multiplayer.
 *
 * Only player INTENT crosses the network — never game state. Each command is the
 * exact, tiny description of one thing a commander did; both peers feed the same
 * command into their identical sims at the same tick and stay in perfect sync.
 */

/** A single player action, replayable against any Sim via `applyCommand`. */
export type NetCommand =
  | { k: 'play'; team: TeamId; slot: number; tile?: TilePos }
  | { k: 'collect'; team: TeamId; id: number }
  | { k: 'refresh'; team: TeamId; cat: HandCategory };

/** Messages exchanged over a Transport. */
export type NetMessage =
  /** host → client: everything needed to build an identical Sim and start. */
  | { t: 'start'; seed: number; map: string[]; loadouts: [string[], string[]]; delay: number; manualCollect: boolean }
  /** client → host: the joiner's chosen loadout, sent before `start`. */
  | { t: 'hello'; loadout: string[]; name?: string }
  /** the set of a peer's commands finalized for one execution tick (may be empty). */
  | { t: 'cmd'; tick: number; cmds: NetCommand[] }
  /** periodic state fingerprint for live desync detection. */
  | { t: 'sum'; tick: number; hash: number }
  /** graceful disconnect / surrender notice. */
  | { t: 'bye'; reason?: string };

export function encode(msg: NetMessage): string {
  return JSON.stringify(msg);
}

export function decode(line: string): NetMessage {
  return JSON.parse(line) as NetMessage;
}

/** Result of applying a command — a PlayResult, or the collect claim, or null. */
export type ApplyResult = PlayResult | { kind: 'gold' | 'oil'; amount: number } | null;

/**
 * Apply one command to a sim. Failures (bad slot, not enough gold at exec time)
 * are intentionally swallowed: they fail identically on both peers, so the sims
 * stay in lockstep. Returns whatever the sim method reported, for local UI cues.
 */
export function applyCommand(sim: Sim, cmd: NetCommand): ApplyResult {
  switch (cmd.k) {
    case 'play':
      return sim.playCard(cmd.team, cmd.slot, cmd.tile);
    case 'collect':
      return sim.collectBuilding(cmd.team, cmd.id);
    case 'refresh':
      return sim.refreshRegion(cmd.team, cmd.cat);
  }
}
