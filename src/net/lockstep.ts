import type { Sim } from '../sim/sim';
import type { TeamId } from '../sim/types';
import { simHash } from './checksum';
import { ApplyResult, NetCommand, NetMessage, applyCommand, decode, encode } from './protocol';
import type { Transport } from './transport';

/** Tunables shared by both peers (must match, so they live in one place). */
export const NET = {
  /** ticks of input latency: a command issued at tick T executes at T+delay on
   *  BOTH peers simultaneously. Buys time for the command to cross the wire so
   *  neither peer ever has to stall on a healthy LAN. 3 ticks ≈ 150 ms. */
  INPUT_DELAY: 3,
  /** trade a state fingerprint this often (ticks) to catch a desync immediately. */
  CHECK_INTERVAL: 20
};

export interface LockstepOpts {
  inputDelay?: number;
  checkInterval?: number;
  /** local-team command just executed — drives local UI cues (fly-chips, sfx). */
  onApplyLocal?: (cmd: NetCommand, result: ApplyResult) => void;
  /** the two sims diverged: same tick, different fingerprint. Unrecoverable. */
  onDesync?: (tick: number, local: number, remote: number) => void;
  /** the peer disconnected. */
  onClose?: () => void;
}

/**
 * Deterministic lockstep driver for one Sim.
 *
 * The protocol, in one breath: a command issued now is scheduled `inputDelay`
 * ticks ahead and broadcast; each peer can only execute tick T once it holds the
 * remote peer's command set for T; both peers apply (local + remote) commands in
 * the same team-order, then step. Same seed + same commands + same order ⇒ the
 * two sims evolve identically, forever. Fingerprints are swapped periodically so
 * any divergence is caught the instant it appears.
 */
export class LockstepNet {
  readonly sim: Sim;
  readonly localTeam: TeamId;
  readonly remoteTeam: TeamId;
  private readonly inputDelay: number;
  private readonly checkInterval: number;
  /** number of ticks already executed (== sim.tick) */
  tick = 0;
  /** local commands awaiting execution, keyed by their execution tick */
  private localQ = new Map<number, NetCommand[]>();
  /** remote commands received, keyed by execution tick (presence == "ready") */
  private remoteQ = new Map<number, NetCommand[]>();
  /** our fingerprints, kept until the peer's matching `sum` arrives */
  private localHash = new Map<number, number>();
  /** peer fingerprints that arrived before we reached that tick */
  private pendingRemoteHash = new Map<number, number>();
  private closed = false;
  private desynced = false;

  constructor(sim: Sim, localTeam: TeamId, private transport: Transport, private opts: LockstepOpts = {}) {
    this.sim = sim;
    this.localTeam = localTeam;
    this.remoteTeam = localTeam === 0 ? 1 : 0;
    this.inputDelay = opts.inputDelay ?? NET.INPUT_DELAY;
    this.checkInterval = opts.checkInterval ?? NET.CHECK_INTERVAL;
    // the first `inputDelay` ticks can hold no command (nothing can be scheduled
    // before tick `inputDelay`), so both peers know they're empty without a message
    for (let t = 0; t < this.inputDelay; t++) this.remoteQ.set(t, []);
    transport.onMessage((d) => this.onMessage(d));
    transport.onClose(() => {
      this.closed = true;
      this.opts.onClose?.();
    });
  }

  /** Queue a local action; it executes `inputDelay` ticks from now on both peers. */
  submitLocal(cmd: NetCommand): void {
    const execTick = this.tick + this.inputDelay;
    const list = this.localQ.get(execTick);
    if (list) list.push(cmd);
    else this.localQ.set(execTick, [cmd]);
  }

  /** True once we hold the remote command set for the current tick (and may step). */
  canStep(): boolean {
    if (this.closed || this.desynced || this.sim.result) return false;
    return this.remoteQ.has(this.tick);
  }

  /** Advance exactly one tick: apply this tick's commands (both peers), then step. */
  step(): void {
    if (!this.canStep()) return;
    const t = this.tick;
    const local = this.localQ.get(t) ?? [];
    const remote = this.remoteQ.get(t) ?? [];

    // deterministic application order: team 0's commands, then team 1's. Each
    // team's own list preserves issue order; both peers build the same sequence.
    const ordered =
      this.localTeam === 0 ? [...local, ...remote] : [...remote, ...local];
    ordered.sort((a, b) => a.team - b.team);
    for (const cmd of ordered) {
      const result = applyCommand(this.sim, cmd);
      if (cmd.team === this.localTeam) this.opts.onApplyLocal?.(cmd, result);
    }

    this.sim.step();
    this.tick = t + 1;
    this.localQ.delete(t);
    this.remoteQ.delete(t);

    // finalize & broadcast the command set for the tick that just became sealed
    // (issue tick t ⇒ exec tick t+inputDelay; no further input can target it now)
    const sealed = t + this.inputDelay;
    this.sendMsg({ t: 'cmd', tick: sealed, cmds: this.localQ.get(sealed) ?? [] });

    // periodic determinism handshake
    if (this.tick % this.checkInterval === 0) {
      const hash = simHash(this.sim);
      const peer = this.pendingRemoteHash.get(this.tick);
      if (peer !== undefined) {
        this.pendingRemoteHash.delete(this.tick);
        this.checkHash(this.tick, hash, peer);
      } else {
        this.localHash.set(this.tick, hash);
      }
      this.sendMsg({ t: 'sum', tick: this.tick, hash });
    }
  }

  /** Step as far as the available remote input allows. Returns ticks executed. */
  pump(maxTicks = Infinity): number {
    let n = 0;
    while (n < maxTicks && this.canStep()) {
      this.step();
      n++;
    }
    return n;
  }

  get isClosed(): boolean {
    return this.closed;
  }
  get isDesynced(): boolean {
    return this.desynced;
  }

  /** Notify the peer we're leaving (surrender / window close), then drop the pipe. */
  close(reason?: string): void {
    if (this.closed) return;
    this.sendMsg({ t: 'bye', reason });
    this.closed = true;
    this.transport.close();
  }

  private sendMsg(msg: NetMessage): void {
    if (this.closed) return;
    this.transport.send(encode(msg));
  }

  private onMessage(data: string): void {
    let msg: NetMessage;
    try {
      msg = decode(data);
    } catch {
      return; // ignore garbage on the wire
    }
    switch (msg.t) {
      case 'cmd': {
        // trust only commands stamped with the remote team — never let a peer
        // drive your units, even by accident
        const cmds = msg.cmds.filter((c) => c.team === this.remoteTeam);
        this.remoteQ.set(msg.tick, cmds);
        break;
      }
      case 'sum': {
        const mine = this.localHash.get(msg.tick);
        if (mine !== undefined) {
          this.localHash.delete(msg.tick);
          this.checkHash(msg.tick, mine, msg.hash);
        } else {
          this.pendingRemoteHash.set(msg.tick, msg.hash);
        }
        break;
      }
      case 'bye':
        this.closed = true;
        this.opts.onClose?.();
        break;
      default:
        break; // 'start' / 'hello' belong to the lobby handshake
    }
  }

  private checkHash(tick: number, local: number, remote: number): void {
    if (local === remote || this.desynced) return;
    this.desynced = true;
    this.opts.onDesync?.(tick, local, remote);
  }
}
