import { describe, expect, it } from 'vitest';
// the real Electron main-process TCP transport (a CommonJS module)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NetLink } = require('../electron/net.cjs') as {
  NetLink: new () => {
    attach(win: unknown): void;
    host(port: number): Promise<{ ok: boolean; port?: number; error?: string }>;
    join(host: string, port: number): Promise<{ ok: boolean; error?: string }>;
    send(data: string): void;
    close(): void;
    ips(): string[];
  };
};

/** A stand-in for an Electron BrowserWindow that records what the link sends to
 *  the renderer, so we can assert framing/lifecycle without a real Electron run. */
function mockWin() {
  const messages: string[] = [];
  const statuses: Array<{ type: string; [k: string]: unknown }> = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        if (channel === 'net:message') messages.push(payload as string);
        else if (channel === 'net:status') statuses.push(payload as { type: string });
      }
    }
  };
  return { win, messages, statuses };
}

const until = (cond: () => boolean, ms = 3000): Promise<void> =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('condition not met in time'));
      }
    }, 5);
  });

describe('electron NetLink (real TCP, no Electron runtime)', () => {
  it('exposes this machine LAN IPv4 list', () => {
    const link = new (NetLink as any)();
    expect(Array.isArray(link.ips())).toBe(true); // may be empty on an offline CI box
  });

  it('pairs host+join over loopback and round-trips framed messages', async () => {
    const host = new (NetLink as any)();
    const join = new (NetLink as any)();
    const h = mockWin();
    const j = mockWin();
    host.attach(h.win);
    join.attach(j.win);

    const listened = await host.host(0); // 0 → OS picks a free port
    expect(listened.ok).toBe(true);
    await until(() => h.statuses.some((s) => s.type === 'listening'));
    const port = h.statuses.find((s) => s.type === 'listening')!.port as number;

    const joined = await join.join('127.0.0.1', port);
    expect(joined.ok).toBe(true);
    await until(() => h.statuses.some((s) => s.type === 'connected') && j.statuses.some((s) => s.type === 'connected'));

    // joiner → host: two messages, framing must split them into two lines
    join.send('{"t":"hello","loadout":["rifle"]}');
    join.send('{"t":"cmd","tick":3,"cmds":[]}');
    await until(() => h.messages.length >= 2);
    expect(h.messages[0]).toBe('{"t":"hello","loadout":["rifle"]}');
    expect(h.messages[1]).toBe('{"t":"cmd","tick":3,"cmds":[]}');

    // host → joiner
    host.send('{"t":"start","seed":7}');
    await until(() => j.messages.length >= 1);
    expect(j.messages[0]).toBe('{"t":"start","seed":7}');

    // closing one end fires a 'closed' status on the other
    host.close();
    await until(() => j.statuses.some((s) => s.type === 'closed'));
    join.close();
  });

  it('refuses a second opponent (1v1 only)', async () => {
    const host = new (NetLink as any)();
    const h = mockWin();
    host.attach(h.win);
    const listened = await host.host(0);
    const port = listened.port as number;

    const first = new (NetLink as any)();
    const second = new (NetLink as any)();
    await first.join('127.0.0.1', port);
    await until(() => h.statuses.some((s) => s.type === 'connected'));
    h.messages.length = 0;

    await second.join('127.0.0.1', port); // accepted at TCP, then dropped by the server
    // the first connection stays usable; the second never becomes the active socket
    first.send('{"t":"hello","loadout":[]}');
    await until(() => h.messages.includes('{"t":"hello","loadout":[]}'));
    expect(h.messages).toContain('{"t":"hello","loadout":[]}');

    host.close();
    first.close();
    second.close();
  });
});
