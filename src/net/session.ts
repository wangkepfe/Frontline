import { generateMap } from '../sim/mapgen';
import type { TeamId } from '../sim/types';
import { NET } from './lockstep';
import { decode, encode, type NetMessage } from './protocol';
import type { Transport } from './transport';

/**
 * Lobby handshake. Before the deterministic sim can run, both peers must agree on
 * the exact match setup (seed, map, both loadouts, rules) so their sims are born
 * identical. The host is authoritative: it picks the seed/map and assigns sides
 * (host = team 0, joiner = team 1).
 */
export interface SessionResult {
  localTeam: TeamId;
  seed: number;
  map: string[];
  loadouts: [string[], string[]];
  manualCollect: boolean;
}

/** Host: wait for the joiner's loadout, then deal out the shared match setup. */
export function hostSession(transport: Transport, hostLoadout: string[], seed: number): Promise<SessionResult> {
  return new Promise((resolve) => {
    transport.onMessage((data) => {
      let msg: NetMessage;
      try {
        msg = decode(data);
      } catch {
        return;
      }
      if (msg.t !== 'hello') return;
      const map = generateMap(seed);
      const loadouts: [string[], string[]] = [hostLoadout, msg.loadout];
      const manualCollect = true; // both sides human, so manual collect is fair
      transport.send(encode({ t: 'start', seed, map, loadouts, delay: NET.INPUT_DELAY, manualCollect }));
      resolve({ localTeam: 0, seed, map, loadouts, manualCollect });
    });
  });
}

/** Joiner: announce our loadout, then accept the host's match setup. */
export function joinSession(transport: Transport, joinLoadout: string[]): Promise<SessionResult> {
  return new Promise((resolve) => {
    transport.onMessage((data) => {
      let msg: NetMessage;
      try {
        msg = decode(data);
      } catch {
        return;
      }
      if (msg.t !== 'start') return;
      resolve({
        localTeam: 1,
        seed: msg.seed,
        map: msg.map,
        loadouts: msg.loadouts,
        manualCollect: msg.manualCollect
      });
    });
    transport.send(encode({ t: 'hello', loadout: joinLoadout }));
  });
}
