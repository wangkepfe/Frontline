/* Focused capture: every classification-band variant, one card per shot at
 * 2× zoom from a fixed corner (no rect math) — covers each chip rung
 * (RESTRICTED → EYES ONLY), each form title, each serial ledger, incl. the
 * width-law worst case (extractor).
 *   npx electron electron/snap-band.cjs [url]  →  debug/snap-band-<id>.png */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'debug');
const IDS = ['powerplant', 'extractor', 'rifle', 'tank', 'sabot', 'attackorder', 'airstrike', 'nuke'];
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
        const img = await win.webContents.capturePage(rect);
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
  await win.loadURL(`${BASE}/?gallery`);
  await js('document.fonts.ready.then(() => 1)');
  await sleep(1400);
  for (const id of IDS) {
    await js(`(async () => {
      const { cardFaceHtml } = await import('/src/ui/cardFace.ts');
      let d = document.getElementById('bandsheet');
      if (!d) {
        d = document.createElement('div');
        d.id = 'bandsheet';
        document.body.appendChild(d);
      }
      d.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;' +
        'background:#1f241f;padding:24px;zoom:2';
      d.innerHTML = cardFaceHtml(${JSON.stringify(id)}, false);
      return 1;
    })()`);
    await sleep(300);
    await cap(`band-${id}`, { x: 0, y: 0, width: 620, height: 420 });
  }
  app.quit();
});
