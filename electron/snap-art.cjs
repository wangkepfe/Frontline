/* Art baseline capture: sweeps every atelier asset (close-up, in the FIRE pose)
 * plus the three biome war-maps. Composites DOM over WebGL via capturePage.
 *   npx electron electron/snap-art.cjs [url] [tag]
 * Output: debug/art/<tag><name>.png
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:5173';
// TAG comes via env, NEVER a 2nd positional arg — a second argv to the electron
// binary destabilizes launch (exits 255 before any module code runs).
const TAG = process.env.TAG ? process.env.TAG + '-' : '';
const OUT = path.join(__dirname, '..', 'debug', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSETS = [
  'rifle', 'rocket', 'tank', 'howitzer', 'harvester', 'buggy',
  'hq', 'powerplant', 'barracks', 'factory', 'extractor', 'derrick', 'bunker', 'atturret'
];
const BIOMES = ['temperate', 'desert', 'winter'];

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1100,
    height: 880,
    useContentSize: true,
    show: true,
    webPreferences: { backgroundThrottling: false, offscreen: false }
  });
  win.webContents.setAudioMuted(true);
  const js = (code) => win.webContents.executeJavaScript(code, true).catch((e) => String(e));
  const cap = async (name) => {
    for (let i = 0; i < 6; i++) {
      try {
        const img = await win.webContents.capturePage();
        if (img.isEmpty()) throw new Error('empty');
        fs.writeFileSync(path.join(OUT, `${TAG}${name}.png`), img.toPNG());
        console.log('captured', name);
        return;
      } catch {
        await sleep(450);
      }
    }
    console.log('FAILED capture', name);
  };

  const MODE = process.env.MODE || 'all';
  // the warmap route reuses the in-DOM #cmap, which lives inside #campaign.hidden
  // (display:none → zero layout). Unhide it + give #cmap the viewport so the
  // ResizeObserver fires fit() and the board renders before capture.
  const UNHIDE = `(() => {
    const camp = document.getElementById('campaign');
    if (camp) { camp.classList.remove('hidden'); camp.style.cssText = 'position:fixed;inset:0;z-index:9999;display:block'; }
    const cmap = document.getElementById('cmap');
    if (cmap) cmap.style.cssText = 'position:absolute;inset:0;background:#0c0a07';
    void (cmap && cmap.offsetHeight); // force reflow so clientHeight is the real full-window height
    window.dispatchEvent(new Event('resize'));
    const s = window.__warmap && window.__warmap.scene;
    if (s && s.fit) s.fit();
    return cmap ? cmap.clientWidth + 'x' + cmap.clientHeight : 'no-cmap';
  })()`;
  const REFIT = `(() => { const s = window.__warmap && window.__warmap.scene; if (s && s.fit) s.fit(); return 1; })()`;

  try {
    const LIST = process.env.ASSETS ? process.env.ASSETS.split(',') : ASSETS;
    if (MODE === 'all' || MODE === 'assets') {
      // ── atelier: each asset close-up, landed in the FIRE/aim window (t≈5.2) ──
      for (const a of LIST) {
        await win.loadURL(`${BASE}/?atelier=${a}`);
        await js('document.fonts && document.fonts.ready');
        await sleep(5200); // idle→march→halt+aim→FIRE
        await cap(`asset-${a}`);
      }
      // gallery overview (consistency across the whole roster)
      await win.loadURL(`${BASE}/?atelier=all`);
      await sleep(4400);
      await cap('asset-all');
    }

    if (MODE === 'all' || MODE === 'warmap') {
      // ── war-maps: each biome theater board ──
      for (const b of BIOMES) {
        await win.loadURL(`${BASE}/?warmap=${b}`);
        await sleep(1200);
        const sz = await js(UNHIDE);
        console.log('  cmap size', b, sz);
        await sleep(500);
        await js(REFIT); // re-fit now that layout has flushed to full window height
        await sleep(1200);
        await cap(`warmap-${b}`);
      }
    }
  } catch (e) {
    console.log('ERROR', e);
  }
  await sleep(300);
  app.quit();
});
