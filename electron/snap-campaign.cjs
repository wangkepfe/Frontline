/* Focused campaign-map capture: the 3D war-table diorama + DOM hotspots + the
 * act-transition splash. Composites DOM over WebGL (the preview sandbox can't).
 *   npx electron electron/snap-campaign.cjs [url]
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
    width: 1456,
    height: 940,
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
        fs.writeFileSync(path.join(OUT, `snap-${name}.png`), img.toPNG());
        console.log('captured', name);
        return;
      } catch {
        await sleep(450);
      }
    }
    console.log('FAILED capture', name);
  };

  try {
    await win.loadURL(BASE);
    await js('document.fonts.ready.then(() => 1)');
    await sleep(1000);
    // fresh run → Act I splash over the green-front map
    await js(`localStorage.removeItem('frontline.campaign.v1'); localStorage.removeItem('frontline.campaign.v2'); 1`);
    await js(`document.getElementById('btn-campaign').click()`);
    await sleep(1800);
    await cap('campaign-splash');
    // dismiss → clean war-table map with hotspots
    await js(`document.getElementById('as-begin').click()`);
    await sleep(1600);
    await cap('campaign-map');
    // open a battle node → preview
    await js(`document.querySelector('.cnode.battle.open, .cnode.open')?.click()`);
    await sleep(1000);
    await cap('campaign-preview');
    await js(`document.getElementById('m-cancel')?.click()`);
  } catch (e) {
    console.log('ERROR', e);
  }
  await sleep(300);
  app.quit();
});
