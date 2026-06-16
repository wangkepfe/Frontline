/* Dev screenshot harness for the SKIRMISH meta layer: the menu with match
 * modifiers + service record, the pre-deploy briefing, and the graded field
 * report. Captures real Chromium renders to debug/snap-sk-*.png.
 *   npx electron electron/snap-skirmish.cjs [url]
 * The preview sandbox cannot rasterize DOM; Electron can. */
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
        fs.writeFileSync(path.join(OUT, `snap-sk-${name}.png`), img.toPNG());
        console.log('captured', name);
        return;
      } catch (e) {
        await sleep(450);
      }
    }
    console.log('FAILED capture', name);
  };
  const go = async (url) => {
    await win.loadURL(url);
    await js('document.fonts.ready.then(() => 1)');
    await sleep(1200);
  };

  try {
    // seed a believable service record so the menu strip + end deltas render
    await go(`${BASE}/`);
    await js(`localStorage.setItem('frontline.skirmish.record.v1', JSON.stringify({matches:13,wins:9,losses:4,streak:3,bestStreak:5,fastestWin:121,mostDamage:3680}))`);
    await go(`${BASE}/`);
    await sleep(500);

    // turn on two modifiers for a richer menu + briefing
    await js(`document.querySelector('.mut-chip[data-mut="blitz"]').click()`);
    await js(`document.querySelector('.mut-chip[data-mut="suddenDeath"]').click()`);
    await sleep(300);
    await cap('menu');

    // ── pre-deploy briefing ──
    await js(`document.getElementById('btn-deploy').click()`);
    await sleep(900);
    await cap('briefing');

    // ── deploy, then force a quick VICTORY to show the graded report ──
    await js(`document.getElementById('m-deploy').click()`);
    await sleep(3200);
    await js(`window.__game.fastForward(35)`);
    await sleep(700);
    // raze the enemy HQ so the match resolves into the end screen
    await js(`(() => { const hq = window.__game.sim.buildings.find(b => b.kind==='hq' && b.team===1); if (hq) hq.hp = 0; })()`);
    await sleep(2200); // sim resolves + 1.4s end-of-match beat
    await cap('end-victory');

    // ── a DEFEAT report for contrast (surrender the next match) ──
    await js(`document.getElementById('btn-again').click()`);
    await sleep(800);
    await js(`document.getElementById('m-deploy').click()`);
    await sleep(2600);
    await js(`(() => { const hq = window.__game.sim.buildings.find(b => b.kind==='hq' && b.team===0); if (hq) hq.hp = 0; })()`);
    await sleep(2200);
    await cap('end-defeat');
  } catch (e) {
    console.log('snap error', String(e));
  }
  await sleep(300);
  app.quit();
});
