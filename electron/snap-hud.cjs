/* Focused battle-HUD capture (post layout iteration): full frame + the four
 * staff posts at the user's window size.
 *   npx electron electron/snap-hud.cjs [url]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1992,
    height: 1126,
    useContentSize: true,
    show: true,
    webPreferences: { backgroundThrottling: false }
  });
  win.webContents.setAudioMuted(true);
  const js = (code) => win.webContents.executeJavaScript(code, true).catch((e) => String(e));
  const cap = async (name, rect) => {
    for (let i = 0; i < 5; i++) {
      try {
        const img = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
        if (img.isEmpty()) throw new Error('empty');
        fs.writeFileSync(path.join(OUT, `snap-${name}.png`), img.toPNG());
        console.log('captured', name);
        return;
      } catch (e) {
        await sleep(450);
      }
    }
    console.log('FAILED capture', name);
  };
  const capEl = async (name, selector, pad = 8) => {
    const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
    if (!r || typeof r !== 'object') { console.log('no element for', name); return; }
    await cap(name, {
      x: Math.max(0, Math.round(r.x - pad)),
      y: Math.max(0, Math.round(r.y - pad)),
      width: Math.round(r.width + pad * 2),
      height: Math.round(r.height + pad * 2)
    });
  };

  try {
    await win.loadURL(`${BASE}/`);
    await js('document.fonts.ready.then(() => 1)');
    await sleep(1200);
    await js(`document.getElementById('btn-deploy').click()`);
    await sleep(3400);
    await cap('hud-open');
    await js(`window.__game.fastForward(30)`);
    await sleep(1000);
    await cap('hud-mid');
    await capEl('hud-post-stats', '#post-stats', 6);
    await capEl('hud-post-build', '#post-build', 6);
    await capEl('hud-post-units', '#post-units', 6);
    await capEl('hud-post-actions', '#post-actions', 6);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))`);
    await sleep(500);
    console.log('armed state:', await js(`JSON.stringify({ armed: window.__game.armedSlot, cls: document.querySelector('#hand-building .card')?.className, toast: document.getElementById('toast')?.textContent })`));
    await capEl('hud-armed', '#post-build', 24);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    // force a standing order to verify the readout in the TR grid
    await js(`(() => { const s = window.__game.sim; s.players[0].order = { kind: 'attack', until: s.time + 42 }; return 1; })()`);
    await sleep(400);
    await capEl('hud-order', '#post-actions', 6);

    // ── 4K emulation: --uiscale must bring the chrome up to size ──
    win.webContents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width: 3840, height: 2160 },
      viewPosition: { x: 0, y: 0 },
      viewSize: { width: 3840, height: 2160 },
      deviceScaleFactor: 0,
      scale: 0.5
    });
    await sleep(1000);
    console.log('4k:', await js(`getComputedStyle(document.documentElement).getPropertyValue('--uiscale') + ' @ ' + innerWidth + 'x' + innerHeight`));
    await cap('hud-4k');
  } catch (e) {
    console.error('harness error:', e);
  }
  console.log('all captures done ->', OUT);
  app.quit();
});
