import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { DEFAULT_LOADOUT, CARDS, CATEGORY_SLOTS } from '../src/sim/cards';
import { validPlacementTiles } from '../src/sim/placement';
import type { SimOptions, TeamId } from '../src/sim/types';
import { LockstepNet } from '../src/net/lockstep';
import { LineFramer, LoopbackTransport, type Transport } from '../src/net/transport';
import { simHash, simSnapshot } from '../src/net/checksum';
import { applyCommand, decode, encode, type NetCommand } from '../src/net/protocol';
import { hostSession, joinSession } from '../src/net/session';

/**
 * Mock multiplayer tests. Two LockstepNet peers are wired through an in-memory
 * LoopbackTransport — the exact same engine the Electron TCP transport feeds —
 * and driven tick-by-tick. The whole point of deterministic lockstep is that the
 * two independent sims must stay BYTE-IDENTICAL, so most assertions reduce to
 * "snapshot(A) deepEquals snapshot(B)" and "hash(A) === hash(B)".
 */

const LOADOUTS: [string[], string[]] = [DEFAULT_LOADOUT, DEFAULT_LOADOUT];

function makeSim(seed: number, opts: SimOptions = {}): Sim {
  return new Sim(seed, LOADOUTS, opts);
}

/** A bot decision that is a pure function of the (shared, identical) sim state. */
function decideFirstPlayable(net: LockstepNet): NetCommand | null {
  const sim = net.sim;
  const team = net.localTeam;
  const p = sim.players[team];
  for (let slot = 0; slot < p.hand.length; slot++) {
    const s = p.hand[slot];
    if (!s) continue;
    const card = CARDS[s.card.id];
    const check = sim.canPlay(team, slot);
    if (check.ok) return { k: 'play', team, slot };
    if (check.reason === 'needs target') {
      const tiles = validPlacementTiles(sim, team, card);
      if (tiles.length > 0) return { k: 'play', team, slot, tile: tiles[0] };
    }
  }
  // nothing to play — bank a desk reshuffle if we can afford it
  if (p.gold >= sim.refreshCost(team, 'action')) return { k: 'refresh', team, cat: 'action' };
  return null;
}

/** An offense-first bot: field units before buildings so the lane actually moves. */
function decidePush(net: LockstepNet): NetCommand | null {
  const sim = net.sim;
  const team = net.localTeam;
  const p = sim.players[team];
  const order = [...CATEGORY_SLOTS.unit, ...CATEGORY_SLOTS.building, ...CATEGORY_SLOTS.action];
  for (const slot of order) {
    const s = p.hand[slot];
    if (!s) continue;
    const card = CARDS[s.card.id];
    const check = sim.canPlay(team, slot);
    if (check.ok) return { k: 'play', team, slot };
    if (check.reason === 'needs target') {
      const tiles = validPlacementTiles(sim, team, card);
      if (tiles.length > 0) return { k: 'play', team, slot, tile: tiles[0] };
    }
  }
  return null;
}

interface Peer {
  net: LockstepNet;
  port: LoopbackTransport;
  desyncs: Array<{ tick: number; local: number; remote: number }>;
}

function makePeer(seed: number, team: TeamId, port: LoopbackTransport, opts: SimOptions, checkInterval: number): Peer {
  const desyncs: Peer['desyncs'] = [];
  const net = new LockstepNet(makeSim(seed, opts), team, port, {
    checkInterval,
    onDesync: (tick, local, remote) => desyncs.push({ tick, local, remote })
  });
  return { net, port, desyncs };
}

interface MatchOpts {
  maxTicks: number;
  everyK?: number;
  decide?: (net: LockstepNet) => NetCommand | null;
  /** called whenever both peers have executed the same number of ticks */
  onMatchedTick?: (a: Sim, b: Sim) => void;
}

/** Drive two peers in near-lockstep until both hit maxTicks or a sim ends. */
function runMatch(a: Peer, b: Peer, o: MatchOpts): void {
  const everyK = o.everyK ?? 7;
  const issued: [Set<number>, Set<number>] = [new Set(), new Set()];
  const peers = [a, b] as const;
  let guard = 0;
  const limit = o.maxTicks * 8 + 1000;
  const live = () =>
    a.net.tick < o.maxTicks && b.net.tick < o.maxTicks &&
    !a.net.sim.result && !b.net.sim.result &&
    !a.net.isDesynced && !b.net.isDesynced && !a.net.isClosed && !b.net.isClosed;
  while (live()) {
    a.port.flush();
    b.port.flush();
    if (o.decide) {
      for (let i = 0; i < 2; i++) {
        const { net } = peers[i];
        if (net.tick % everyK === 0 && !issued[i].has(net.tick) && !net.sim.result) {
          issued[i].add(net.tick);
          const cmd = o.decide(net);
          if (cmd) net.submitLocal(cmd);
        }
      }
    }
    const pa = a.net.canStep() ? (a.net.step(), 1) : 0;
    const pb = b.net.canStep() ? (b.net.step(), 1) : 0;
    if (a.net.tick === b.net.tick && o.onMatchedTick) o.onMatchedTick(a.net.sim, b.net.sim);
    if (++guard > limit) throw new Error(`lockstep stuck at a=${a.net.tick} b=${b.net.tick} (pa=${pa} pb=${pb})`);
  }
}

// ── transport plumbing ────────────────────────────────────────────────────────

describe('transport', () => {
  it('LineFramer reassembles messages split across chunks', () => {
    const f = new LineFramer();
    expect(f.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(f.push('2}\n')).toEqual(['{"b":2}']);
    expect(f.push('partial')).toEqual([]); // no newline yet — buffered
    expect(f.push(' more\n')).toEqual(['partial more']); // newline completes it
  });

  it('LineFramer yields a full line once its newline arrives', () => {
    const f = new LineFramer();
    f.push('hello');
    expect(f.push(' world\n')).toEqual(['hello world']);
    expect(LineFramer.frame('x')).toBe('x\n');
  });

  it('LoopbackTransport delivers sent messages to the partner on flush', () => {
    const [a, b] = LoopbackTransport.pair();
    const got: string[] = [];
    b.onMessage((d) => got.push(d));
    a.send('one');
    a.send('two');
    expect(got).toEqual([]); // nothing until flush
    b.flush();
    expect(got).toEqual(['one', 'two']);
  });

  it('LoopbackTransport honors a latency delay', () => {
    const [a, b] = LoopbackTransport.pair(2);
    const got: string[] = [];
    b.onMessage((d) => got.push(d));
    a.send('x');
    b.flush(); // 1 of 2
    expect(got).toEqual([]);
    b.flush(); // 2 of 2 — now it lands
    expect(got).toEqual(['x']);
  });

  it('protocol encode/decode round-trips every command shape', () => {
    const cmds: NetCommand[] = [
      { k: 'play', team: 0, slot: 2 },
      { k: 'play', team: 1, slot: 0, tile: { c: 5, r: 7 } },
      { k: 'collect', team: 0, id: 42 },
      { k: 'refresh', team: 1, cat: 'building' }
    ];
    for (const c of cmds) {
      expect(decode(encode({ t: 'cmd', tick: 9, cmds: [c] }))).toEqual({ t: 'cmd', tick: 9, cmds: [c] });
    }
  });
});

// ── the sim itself is deterministic (the foundation lockstep stands on) ────────

describe('sim determinism', () => {
  it('two sims from the same seed evolve identically with no input', () => {
    const a = makeSim(12345);
    const b = makeSim(12345);
    for (let i = 0; i < 400; i++) {
      a.step();
      b.step();
    }
    expect(simSnapshot(a)).toEqual(simSnapshot(b));
    expect(simHash(a)).toBe(simHash(b));
  });

  it('different seeds produce different state (the hash actually discriminates)', () => {
    const a = makeSim(1);
    const b = makeSim(2);
    for (let i = 0; i < 200; i++) {
      a.step();
      b.step();
    }
    expect(simHash(a)).not.toBe(simHash(b));
  });
});

// ── lockstep over the mock network ─────────────────────────────────────────────

describe('lockstep', () => {
  it('stays in sync with no commands, matching a plain stepped sim', () => {
    const [pa, pb] = LoopbackTransport.pair();
    const a = makePeer(7, 0, pa, {}, 20);
    const b = makePeer(7, 1, pb, {}, 20);
    runMatch(a, b, { maxTicks: 120, onMatchedTick: (x, y) => expect(simHash(x)).toBe(simHash(y)) });
    expect(a.net.tick).toBe(120);
    expect(b.net.tick).toBe(120);
    expect(simSnapshot(a.net.sim)).toEqual(simSnapshot(b.net.sim));

    // and lockstep with no input must equal a sim stepped the same number of times
    const control = makeSim(7);
    for (let i = 0; i < 120; i++) control.step();
    expect(simHash(a.net.sim)).toBe(simHash(control));
    expect(a.desyncs).toHaveLength(0);
    expect(b.desyncs).toHaveLength(0);
  });

  it('keeps two sims identical while BOTH commanders issue real orders', () => {
    const [pa, pb] = LoopbackTransport.pair();
    const a = makePeer(99, 0, pa, {}, 20);
    const b = makePeer(99, 1, pb, {}, 20);
    runMatch(a, b, {
      maxTicks: 240,
      everyK: 6,
      decide: decideFirstPlayable,
      onMatchedTick: (x, y) => expect(simHash(x)).toBe(simHash(y))
    });
    expect(simSnapshot(a.net.sim)).toEqual(simSnapshot(b.net.sim));
    // intent fidelity: the play commands actually built things on BOTH sims
    // (each side starts with one HQ; anything beyond that came from a command)
    expect(a.net.sim.buildings.length).toBeGreaterThan(2);
    expect(a.net.sim.buildings.length).toBe(b.net.sim.buildings.length);
    expect(a.desyncs).toHaveLength(0);
    expect(b.desyncs).toHaveLength(0);
  });

  it('tolerates network latency without desyncing', () => {
    const [pa, pb] = LoopbackTransport.pair(4); // 4 flush-ticks of lag each way
    const a = makePeer(99, 0, pa, {}, 20);
    const b = makePeer(99, 1, pb, {}, 20);
    runMatch(a, b, {
      maxTicks: 240,
      everyK: 6,
      decide: decideFirstPlayable,
      onMatchedTick: (x, y) => expect(simHash(x)).toBe(simHash(y))
    });
    expect(simSnapshot(a.net.sim)).toEqual(simSnapshot(b.net.sim));

    // identical to the zero-latency run from the same seed/script: latency must
    // change WHEN things happen on the wire, never the resulting game state
    const [qa, qb] = LoopbackTransport.pair(0);
    const c = makePeer(99, 0, qa, {}, 20);
    const d = makePeer(99, 1, qb, {}, 20);
    runMatch(c, d, { maxTicks: 240, everyK: 6, decide: decideFirstPlayable });
    expect(simHash(a.net.sim)).toBe(simHash(c.net.sim));
  });

  it('a command issued over the net has the same effect as calling the sim directly', () => {
    // peer issues a refresh; a control sim applies the identical command at the
    // identical tick by hand — the two must match exactly.
    const [pa, pb] = LoopbackTransport.pair();
    const a = makePeer(55, 0, pa, {}, 1000);
    const b = makePeer(55, 1, pb, {}, 1000);
    const control = makeSim(55);

    const refreshAt = 5;
    const cmd: NetCommand = { k: 'refresh', team: 0, cat: 'action' };
    runMatch(a, b, {
      maxTicks: 60,
      decide: (net) => (net.localTeam === 0 && net.tick === refreshAt ? cmd : null),
      everyK: 1
    });
    // replay on the control sim: command executes at refreshAt + INPUT_DELAY
    const execTick = refreshAt + 3;
    for (let t = 0; t < 60; t++) {
      if (t === execTick) applyCommand(control, cmd);
      control.step();
    }
    expect(simHash(a.net.sim)).toBe(simHash(control));
    expect(simSnapshot(a.net.sim)).toEqual(simSnapshot(control));
    // the refresh really happened: 150 starting gold minus the 10 reissue fee
    expect(a.net.sim.players[0].gold).toBeCloseTo(control.players[0].gold, 6);
    expect(a.net.sim.players[0].gold).toBeLessThan(150);
  });

  it('detects a desync the moment one sim is tampered with', () => {
    const [pa, pb] = LoopbackTransport.pair();
    const a = makePeer(3, 0, pa, {}, 5); // fingerprint every 5 ticks
    const b = makePeer(3, 1, pb, {}, 5);
    let tampered = false;
    runMatch(a, b, {
      maxTicks: 200,
      onMatchedTick: (x) => {
        if (!tampered && x.tick === 12) {
          tampered = true;
          x.players[0].gold += 1000; // a divergence only one peer's sim sees
        }
      }
    });
    const all = [...a.desyncs, ...b.desyncs];
    expect(all.length).toBeGreaterThan(0);
    // caught at the first checksum boundary at/after the tamper (tick 15)
    expect(all[0].tick).toBe(15);
  });

  it('plays a full match to a winner with both peers in perfect agreement', () => {
    const [pa, pb] = LoopbackTransport.pair(2);
    // a deterministic income edge for team 0 (identical on both peers) breaks the
    // mirror-match stalemate so a decisive winner emerges inside the tick cap
    const opts: SimOptions = { rules: { manualCollect: false, incomeMult: [1.5, 1.0] } };
    const a = makePeer(2024, 0, pa, opts, 20);
    const b = makePeer(2024, 1, pb, opts, 20);
    let checks = 0;
    runMatch(a, b, {
      maxTicks: 12000,
      everyK: 4,
      decide: decidePush,
      onMatchedTick: (x, y) => {
        checks++;
        expect(simHash(x)).toBe(simHash(y));
      }
    });
    expect(checks).toBeGreaterThan(100); // we really did march through the match
    // both peers agree on the outcome (or on the capped mid-state), exactly
    expect(a.net.sim.result).toEqual(b.net.sim.result);
    expect(simSnapshot(a.net.sim)).toEqual(simSnapshot(b.net.sim));
    expect(a.desyncs).toHaveLength(0);
    expect(b.desyncs).toHaveLength(0);
    // a decisive PvP game should actually end inside the cap
    expect(a.net.sim.result).not.toBeNull();
  });
});

// ── over a real TCP socket (the Electron LAN path, minus Electron) ─────────────

/** Transport over a raw TCP socket with the exact newline framing net.cjs uses. */
class SocketTransport implements Transport {
  private framer = new LineFramer();
  private cb: ((d: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  constructor(private sock: net.Socket) {
    sock.setNoDelay(true);
    sock.on('data', (chunk) => {
      for (const line of this.framer.push(chunk.toString('utf8'))) this.cb?.(line);
    });
    sock.on('close', () => this.closeCb?.());
  }
  send(data: string): void {
    this.sock.write(LineFramer.frame(data));
  }
  onMessage(cb: (d: string) => void): void {
    this.cb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
  close(): void {
    this.sock.destroy();
  }
}

function tcpPair(): Promise<[net.Socket, net.Socket]> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serverSock) => {
      server.close();
      resolve([serverSock, client]);
    });
    let client: net.Socket;
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      client = net.connect(port, '127.0.0.1');
      client.on('error', reject);
    });
  });
}

// ── the lobby handshake (session.ts) ──────────────────────────────────────────

describe('lobby handshake', () => {
  it('pairs host + joiner and yields identical match setups', async () => {
    const [ta, tb] = LoopbackTransport.pair();
    const hostP = hostSession(ta, DEFAULT_LOADOUT, 1234);
    const joinP = joinSession(tb, DEFAULT_LOADOUT); // sends 'hello' synchronously

    // shuttle the handshake messages (hello → start) across the loopback
    let h: Awaited<typeof hostP> | undefined;
    let j: Awaited<typeof joinP> | undefined;
    void hostP.then((r) => (h = r));
    void joinP.then((r) => (j = r));
    for (let i = 0; i < 30 && !(h && j); i++) {
      ta.flush();
      tb.flush();
      await Promise.resolve();
    }

    const host = await hostP;
    const join = await joinP;
    expect(host.localTeam).toBe(0);
    expect(join.localTeam).toBe(1);
    expect(join.seed).toBe(1234);
    expect(host.seed).toBe(join.seed);
    expect(join.map).toEqual(host.map);
    expect(join.loadouts).toEqual(host.loadouts);
    expect(join.manualCollect).toBe(host.manualCollect);

    // the whole point: both sides build a byte-identical sim from the setup
    const rules = { manualCollect: host.manualCollect, humanTeams: [true, true] as [boolean, boolean] };
    const simH = new Sim(host.seed, host.loadouts, { mapLayout: host.map, rules });
    const simJ = new Sim(join.seed, join.loadouts, { mapLayout: join.map, rules });
    expect(simSnapshot(simH)).toEqual(simSnapshot(simJ));
  });
});

describe('lockstep over TCP', () => {
  it('two peers stay byte-identical across a real socket', async () => {
    const [sockA, sockB] = await tcpPair();
    const desA: Array<unknown> = [];
    const desB: Array<unknown> = [];
    const a = new LockstepNet(makeSim(404), 0, new SocketTransport(sockA), {
      checkInterval: 20, onDesync: (t, l, r) => desA.push({ t, l, r })
    });
    const b = new LockstepNet(makeSim(404), 1, new SocketTransport(sockB), {
      checkInterval: 20, onDesync: (t, l, r) => desB.push({ t, l, r })
    });

    const MAX = 160;
    const everyK = 6;
    const issued: [Set<number>, Set<number>] = [new Set(), new Set()];
    const peers = [a, b] as const;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(timer); reject(new Error(`timeout a=${a.tick} b=${b.tick}`)); }, 8000);
      const advance = (net: LockstepNet, i: number): void => {
        while (net.canStep() && net.tick < MAX) {
          if (net.tick % everyK === 0 && !issued[i].has(net.tick) && !net.sim.result) {
            issued[i].add(net.tick);
            const cmd = decideFirstPlayable(net);
            if (cmd) net.submitLocal(cmd);
          }
          net.step();
        }
      };
      const timer = setInterval(() => {
        try {
          advance(a, 0);
          advance(b, 1);
          if (a.tick >= MAX && b.tick >= MAX) {
            clearInterval(timer);
            clearTimeout(timeout);
            resolve();
          }
        } catch (e) {
          clearInterval(timer);
          clearTimeout(timeout);
          reject(e as Error);
        }
      }, 1);
    });

    expect(a.tick).toBe(MAX);
    expect(b.tick).toBe(MAX);
    expect(simHash(a.sim)).toBe(simHash(b.sim));
    expect(simSnapshot(a.sim)).toEqual(simSnapshot(b.sim));
    expect(desA).toHaveLength(0);
    expect(desB).toHaveLength(0);
    sockA.destroy();
    sockB.destroy();
  });
});
