/* Dev screenshot harness: drives the running vite dev server through every
 * screen and captures real Chromium renders to debug/snap-*.png.
 *   npx electron electron/snap.cjs [url]
 * Used to verify the 2D design system (DESIGN_GUIDEBOOK.md) — the preview
 * sandbox cannot rasterize DOM, Electron can. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1456,
    height: 940,
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
        await sleep(450); // UnknownVizError flake: settle and retry
      }
    }
    console.log('FAILED capture', name);
  };
  const go = async (url) => {
    await win.loadURL(url);
    await js('document.fonts.ready.then(() => 1)');
    await sleep(1200);
  };
  /** capture the bounding box of a selector at native size (+pad) */
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
    // ── design gallery: card-state close-ups at native res ──
    await go(`${BASE}/?gallery`);
    await sleep(1400);
    await js(`document.getElementById('gallery').scrollTop = 1e6`);
    await sleep(500);
    await cap('gallery-cards');
    await capEl('card-resting', '.gal-card:nth-child(1)');
    await capEl('card-armed', '.gal-card:nth-child(2)');
    await capEl('card-unaffordable', '.gal-card:nth-child(3)');
    await capEl('card-locked', '.gal-card:nth-child(4)');
    await capEl('card-bside', '.gal-card:nth-child(7)');
    await capEl('card-medal', '.gal-card:nth-child(8)');

    // ── main menu ──
    await go(`${BASE}/`);
    await sleep(800);
    await cap('menu');
    await capEl('menu-box', '.menu-box', 16);

    // ── tutorial select modal ──
    await js(`document.getElementById('btn-tutorial').click()`);
    await sleep(600);
    await cap('tutorial-select');
    await js(`document.getElementById('m-close')?.click()`);

    // ── loadout editor ──
    await js(`document.getElementById('btn-loadout').click()`);
    await sleep(600);
    await cap('loadout');

    await js(`document.getElementById('btn-back-loadout').click()`);

    // ── campaign map + deck overlay + preview + abandon ──
    await js(`document.getElementById('btn-campaign').click()`);
    await sleep(900);
    await cap('campaign');
    await js(`document.getElementById('btn-camp-deck').click()`);
    await sleep(600);
    await cap('campaign-deck');
    await js(`document.getElementById('m-close')?.click()`);
    await js(`document.querySelector('.cnode.open')?.click()`);
    await sleep(800);
    await cap('battle-preview');
    await js(`document.getElementById('m-cancel')?.click()`);
    await js(`document.getElementById('btn-camp-abandon').click()`);
    await sleep(500);
    await cap('abandon-confirm');
    await js(`document.getElementById('m-yes')?.click()`);
    await sleep(500);

    // ── battle: opening desks, mid-game, the four staff posts, armed card ──
    await js(`document.getElementById('btn-deploy').click()`);
    await sleep(3400);
    await cap('battle-open');
    await js(`window.__game.fastForward(40)`);
    await sleep(1000);
    await cap('battle-mid');
    await capEl('post-stats', '#post-stats', 4);
    await capEl('post-build', '#post-build', 4);
    await capEl('post-units', '#post-units', 4);
    await capEl('post-actions', '#post-actions', 4);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))`);
    await sleep(500);
    await cap('battle-armed');
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

    // ── end screen ──
    await js(`(() => { const g = window.__game; for (let i = 0; i < 30 && !g.sim.result; i++) g.fastForward(30); return g.sim.result ? 'done' : 'no result'; })()`);
    await sleep(2600);
    await cap('end');
  } catch (e) {
    console.error('harness error:', e);
  }
  console.log('all captures done ->', OUT);
  app.quit();
});
