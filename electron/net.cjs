// FRONTLINE LAN link — the Electron main-process side of multiplayer.
// One TCP connection between two desktop instances carries newline-delimited
// JSON messages (the lockstep protocol). The renderer never touches sockets; it
// drives this over IPC (see preload.cjs) and the deterministic netcode lives in
// src/net. Exactly one opponent at a time — this is 1v1.
const net = require('node:net');
const os = require('node:os');

class NetLink {
  constructor() {
    this.server = null;
    this.socket = null;
    this.win = null;
    this.buf = '';
  }

  attach(win) {
    this.win = win;
  }

  _status(s) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('net:status', s);
  }

  _message(line) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('net:message', line);
  }

  _bindSocket(sock) {
    this.socket = sock;
    sock.setNoDelay(true); // small lockstep packets must not wait on Nagle
    this.buf = '';
    sock.on('data', (chunk) => {
      this.buf += chunk.toString('utf8');
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.length > 0) this._message(line);
      }
    });
    sock.on('close', () => {
      if (this.socket === sock) this.socket = null;
      this._status({ type: 'closed' });
    });
    sock.on('error', (e) => this._status({ type: 'error', error: String((e && e.message) || e) }));
  }

  host(port) {
    return new Promise((resolve) => {
      this.close();
      let settled = false;
      const server = net.createServer((sock) => {
        if (this.socket) {
          sock.destroy(); // a game is already paired — refuse the third wheel
          return;
        }
        this._bindSocket(sock);
        this._status({ type: 'connected', role: 'host' });
      });
      server.on('error', (e) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: String((e && e.message) || e) });
      });
      server.listen(port, () => {
        this.server = server;
        settled = true;
        // report the ACTUAL bound port (matters when port 0 lets the OS pick one)
        const addr = server.address();
        const boundPort = addr && typeof addr === 'object' ? addr.port : port;
        this._status({ type: 'listening', port: boundPort });
        resolve({ ok: true, port: boundPort });
      });
    });
  }

  join(host, port) {
    return new Promise((resolve) => {
      this.close();
      let settled = false;
      const sock = net.connect({ host, port }, () => {
        settled = true;
        this._bindSocket(sock);
        this._status({ type: 'connected', role: 'join' });
        resolve({ ok: true });
      });
      sock.on('error', (e) => {
        if (settled) return; // post-connect errors flow through _bindSocket
        settled = true;
        resolve({ ok: false, error: String((e && e.message) || e) });
      });
    });
  }

  send(data) {
    if (this.socket) {
      try {
        this.socket.write(data + '\n');
      } catch {
        /* socket dying — the close/error event will surface it */
      }
    }
  }

  close() {
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* already gone */ }
      this.socket = null;
    }
    if (this.server) {
      try { this.server.close(); } catch { /* already gone */ }
      this.server = null;
    }
    this.buf = '';
  }

  /** This machine's LAN IPv4 addresses, to show the host who to tell the joiner. */
  ips() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const i of ifs[name] || []) {
        if (i.family === 'IPv4' && !i.internal) out.push(i.address);
      }
    }
    return out;
  }
}

module.exports = { NetLink };
