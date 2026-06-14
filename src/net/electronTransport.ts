import type { Transport } from './transport';

/** The preload bridge (electron/preload.cjs) — present only in the desktop app. */
export interface FrontlineNetBridge {
  host(port: number): Promise<{ ok: boolean; port?: number; error?: string }>;
  join(host: string, port: number): Promise<{ ok: boolean; error?: string }>;
  ips(): Promise<string[]>;
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onStatus(cb: (s: { type: string; [k: string]: unknown }) => void): void;
}

declare global {
  interface Window {
    frontlineNet?: FrontlineNetBridge;
  }
}

/** Multiplayer needs the desktop shell's sockets — false in a plain browser. */
export function netBridge(): FrontlineNetBridge | null {
  return typeof window !== 'undefined' && window.frontlineNet ? window.frontlineNet : null;
}

/**
 * Transport over the Electron LAN bridge. Messages that arrive before a handler
 * is attached are buffered and replayed, so the lobby handshake can't drop the
 * peer's first packet during the brief window before it starts listening.
 */
export class ElectronTransport implements Transport {
  private bridge: FrontlineNetBridge;
  private cb: ((data: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  private buffer: string[] = [];

  constructor() {
    const b = netBridge();
    if (!b) throw new Error('frontlineNet bridge unavailable (desktop app only)');
    this.bridge = b;
    b.onMessage((data) => {
      if (this.cb) this.cb(data);
      else this.buffer.push(data);
    });
    b.onStatus((s) => {
      if (s.type === 'closed' || s.type === 'error') this.closeCb?.();
    });
  }

  send(data: string): void {
    this.bridge.send(data);
  }

  onMessage(cb: (data: string) => void): void {
    this.cb = cb;
    if (this.buffer.length > 0) {
      const queued = this.buffer;
      this.buffer = [];
      for (const d of queued) cb(d);
    }
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.bridge.close();
  }
}
