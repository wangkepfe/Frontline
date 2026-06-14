/**
 * Transport: the thin pipe the lockstep engine talks through. It moves opaque
 * strings (encoded NetMessages) between two peers and knows nothing about game
 * rules. Concrete transports: a TCP socket in Electron (real LAN play) and an
 * in-memory loopback (deterministic tests / single-process smoke runs).
 */
export interface Transport {
  /** queue one encoded message for delivery to the peer. */
  send(data: string): void;
  /** register the sink for messages arriving from the peer. */
  onMessage(cb: (data: string) => void): void;
  /** register a connection-closed notice (peer dropped / quit). */
  onClose(cb: () => void): void;
  /** tear the pipe down. */
  close(): void;
}

/**
 * Newline-delimited message framing for byte streams (TCP). One encoded message
 * per line; `push` accumulates raw chunks and yields complete messages. Encoded
 * messages are JSON and never contain a raw newline, so '\n' is a safe delimiter.
 */
export class LineFramer {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.length > 0) out.push(line);
    }
    return out;
  }
  static frame(data: string): string {
    return data + '\n';
  }
}

/**
 * In-memory transport pair. A message `send`-ed on one end is delivered to the
 * other end's message sink. Delivery is queued and only happens on `flush()`, so
 * tests drive the exact interleaving of network traffic deterministically. An
 * optional latency (in flush ticks) models a delayed link to prove the engine
 * tolerates lag without desyncing.
 */
export class LoopbackTransport implements Transport {
  private partner!: LoopbackTransport;
  private msgCb: ((data: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  /** messages waiting to be delivered into THIS endpoint, with a release time */
  private inbox: Array<{ data: string; at: number }> = [];
  private clock = 0;
  private closed = false;

  private constructor(private latency: number) {}

  /** Create two linked endpoints. `latency` = flush ticks before a sent message lands. */
  static pair(latency = 0): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport(latency);
    const b = new LoopbackTransport(latency);
    a.partner = b;
    b.partner = a;
    return [a, b];
  }

  send(data: string): void {
    if (this.closed || this.partner.closed) return;
    // landing in the PARTNER's inbox, released after `latency` of its flushes
    this.partner.inbox.push({ data, at: this.partner.clock + this.latency });
  }

  onMessage(cb: (data: string) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  /** Deliver every message whose latency has elapsed; advances this endpoint's clock. */
  flush(): void {
    this.clock++;
    if (!this.msgCb) return;
    const ready = this.inbox.filter((m) => m.at <= this.clock);
    this.inbox = this.inbox.filter((m) => m.at > this.clock);
    for (const m of ready) this.msgCb(m.data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.partner.closeCb) this.partner.closeCb();
  }
}
