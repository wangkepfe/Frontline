/* Multi-resolution UI sweep: walks every screen state at a set of target
 * resolutions (emulated) and saves full-frame PNGs for visual review.
 *   npx electron electron/snap-res.cjs [url] [w1xh1,w2xh2,...]
 * Output: debug/res-<wxh>-<state>.png  (one composite per screen per res)
 *
 * Emulation note: the page is laid out at the target viewSize then scaled to
 * fit the real window, so capturePage() returns a ~window-sized image showing
 * the target-resolution LAYOUT — exactly what's needed to judge scale/overflow.
 */
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIAG = path.join(__dirname, '..', 'debug', 'res-diag.log');
const diag = (m) => { try { fs.appendFileSync(DIAG, m + '\n'); } catch {} };
try { fs.writeFileSync(DIAG, 'boot ' + new Date().toISOString() + '\n'); } catch {}
process.on('uncaughtException', (e) => { diag('UNCAUGHT ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { diag('UNHANDLED ' + (e && e.stack || e)); });

const BASE = process.argv[2] || 'http://localhost:5173';
// resolutions come via env (RES), never a 2nd CLI arg — a 2nd positional arg to
// the electron binary destabilizes launch (it exits 255 before running the app)
const RES = (process.env.RES || '1280x720,1920x1080,2560x1440,3840x2160,844x390')
  .split(',')
  .map((s) => s.trim().split('x').map(Number))
  .map(([w, h]) => ({ w, h }));
const OUT = path.join(__dirname, '..', 'debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  diag('whenReady');
  fs.mkdirSync(OUT, { recursive: true });
  const work = screen.getPrimaryDisplay().workAreaSize;
  diag('workArea ' + JSON.stringify(work));
  const winW = Math.min(1900, work.width - 40);
  const winH = Math.min(1060, work.height - 60);
  const win = new BrowserWindow({
    width: winW,
    height: winH,
    useContentSize: true,
    show: true,
    webPreferences: { backgroundThrottling: false, offscreen: false }
  });
  win.webContents.setAudioMuted(true);
  const js = (code) => win.webContents.executeJavaScript(code, true).catch((e) => String(e));

  const setRes = async (w, h) => {
    const scale = Math.min(winW / w, winH / h);
    win.webContents.disableDeviceEmulation();
    win.webContents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width: w, height: h },
      viewPosition: { x: 0, y: 0 },
      viewSize: { width: w, height: h },
      deviceScaleFactor: 0,
      scale
    });
    // enableDeviceEmulation doesn't always fire a resize when transitioning
    // between emulated sizes — force fitUiScale to recompute, then verify
    await sleep(250);
    await js('window.dispatchEvent(new Event("resize")); 1');
    await sleep(250);
    const s = await js(`innerWidth+'x'+innerHeight+' ui='+getComputedStyle(document.documentElement).getPropertyValue('--uiscale').trim()+' menu='+getComputedStyle(document.documentElement).getPropertyValue('--menuscale').trim()`);
    diag(`setRes ${w}x${h} -> ${s}`);
  };

  const cap = async (name) => {
    for (let i = 0; i < 6; i++) {
      try {
        const img = await win.webContents.capturePage();
        if (img.isEmpty()) throw new Error('empty');
        fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
        console.log('captured', name);
        return;
      } catch {
        await sleep(400);
      }
    }
    console.log('FAILED', name);
  };

  await win.loadURL(`${BASE}/`);
  await js('document.fonts.ready.then(() => 1)');

  for (const { w, h } of RES) {
    const tag = `res-${w}x${h}`;
    try {
      // fresh menu state for each resolution
      await win.loadURL(`${BASE}/`);
      await js('document.fonts.ready.then(() => 1)');
      await setRes(w, h);
      await sleep(500);
      await cap(`${tag}-menu`);

      // loadout editor
      await js(`document.getElementById('btn-loadout').click()`);
      await sleep(500);
      await cap(`${tag}-loadout`);
      await js(`document.getElementById('btn-back-loadout').click()`);
      await sleep(200);

      // campaign: fresh run → act splash over the map
      await js(`localStorage.removeItem('frontline.campaign.v1');localStorage.removeItem('frontline.campaign.v2');1`);
      await js(`document.getElementById('btn-campaign').click()`);
      await sleep(1700);
      await cap(`${tag}-campaign-splash`);
      await js(`document.getElementById('as-begin').click()`);
      await sleep(1400);
      await cap(`${tag}-campaign-map`);
      await js(`document.querySelector('.cnode.open')?.click()`);
      await sleep(900);
      await cap(`${tag}-campaign-preview`);
      await js(`document.getElementById('m-cancel')?.click()`);
      await sleep(300);
      // deck overlay (force loadout grid)
      await js(`document.getElementById('btn-camp-deck')?.click()`);
      await sleep(500);
      await cap(`${tag}-deck-overlay`);
      await js(`document.getElementById('m-close')?.click()`);
      await sleep(200);

      // battle HUD (skirmish)
      await win.loadURL(`${BASE}/`);
      await js('document.fonts.ready.then(() => 1)');
      await setRes(w, h);
      await sleep(300);
      await js(`document.getElementById('btn-deploy').click()`);
      await sleep(3200);
      await js(`window.__game && window.__game.fastForward(30)`);
      await sleep(900);
      await cap(`${tag}-hud`);
      // deck inspector overlay
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))`);
      await sleep(500);
      await cap(`${tag}-hud-deck`);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))`);
      await sleep(200);
      // pause menu
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(400);
      await cap(`${tag}-hud-pause`);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(200);
      // end screen (force the DOM state)
      await js(`(()=>{const e=document.getElementById('end');e.classList.remove('hidden');document.getElementById('hud').classList.add('hidden');return 1})()`);
      await sleep(400);
      await cap(`${tag}-end`);
    } catch (e) {
      console.log('ERROR', tag, String(e));
    }
  }

  console.log('sweep done ->', OUT);
  await sleep(300);
  app.quit();
});
