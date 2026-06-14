// One half of the live two-process multiplayer smoke test. Boots the real app,
// drives the lobby DOM to host or join, then watches the netted game run. Each
// process has its OWN NetLink (separate Electron instances = separate sockets),
// exactly like two players on a LAN. Reports its observed match state as JSON.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { NetLink } = require('./net.cjs');

const ROLE = process.env.MP_ROLE || 'host';
const PORT = process.env.MP_SMOKE_PORT || '47615';
const link = new NetLink();

// same IPC wiring as the real main.cjs (this harness has its own main process)
ipcMain.handle('net:host', (_e, port) => link.host(port));
ipcMain.handle('net:join', (_e, host, port) => link.join(host, port));
ipcMain.handle('net:ips', () => link.ips());
ipcMain.on('net:send', (_e, data) => link.send(data));
ipcMain.on('net:close', () => link.close());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// two Electron instances of the same app must NOT share a userData dir, or the
// second one fights the first over the singleton cache/lock
app.setPath('userData', path.join(app.getPath('temp'), 'frontline-mp-' + ROLE));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false, // keep the sim loop at full speed while hidden
      webSecurity: false
    }
  });
  link.attach(win);
  win.webContents.on('console-message', (_e, lvl, msg) => {
    if (lvl >= 2) console.log(`[${ROLE} console] ${msg}`);
  });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await sleep(1200);

  if (ROLE === 'host') {
    await win.webContents.executeJavaScript(
      `document.getElementById('btn-multiplayer').click();
       document.getElementById('mp-host').click(); true`
    );
  } else {
    await win.webContents.executeJavaScript(
      `(() => {
        document.getElementById('btn-multiplayer').click();
        document.getElementById('mp-join').click();
        document.getElementById('mp-ip').value = '127.0.0.1';
        document.getElementById('mp-port').value = '${PORT}';
        document.getElementById('mp-connect').click();
        return true;
      })()`
    );
  }

  const report = { role: ROLE, started: false, last: null };
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    const s = await win.webContents.executeJavaScript(`(() => {
      const g = window.__game;
      const modal = document.getElementById('modal');
      const nw = document.getElementById('netwait');
      return {
        has: !!g,
        tick: g ? g.sim.tick : 0,
        ended: g ? g.isEnded : false,
        localTeam: g ? g.localTeam : -1,
        hq0: g ? Math.round((g.sim.hqOf(0)?.hp) || 0) : 0,
        hq1: g ? Math.round((g.sim.hqOf(1)?.hp) || 0) : 0,
        netwait: nw && !nw.classList.contains('hidden') ? nw.textContent : '',
        status: (document.getElementById('mp-status')?.textContent || '').slice(0, 80),
        modal: modal && !modal.classList.contains('hidden')
          ? (document.getElementById('modal-body')?.textContent || '').slice(0, 40) : ''
      };
    })()`);
    if (s.has) report.started = true;
    report.last = s;
    if (s.tick > 90 || s.modal.includes('DESYNC') || s.modal.includes('LEFT')) break;
  }

  console.log('MP_REPORT ' + JSON.stringify(report));
  app.quit();
}).catch((e) => {
  console.log('MP_REPORT ' + JSON.stringify({ role: ROLE, error: String(e) }));
  app.exit(1);
});
