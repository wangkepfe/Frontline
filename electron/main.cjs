// FRONTLINE desktop shell — loads the built game for the Steam distribution.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

// Steamworks integration point:
// 1. npm i steamworks.js
// 2. const steamworks = require('steamworks.js');
//    const client = steamworks.init(YOUR_APP_ID);   // before app.whenReady
// 3. Achievements/stats: client.achievement.activate(...), client.stats.*
// See steam.md for the full shipping checklist.

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#11140f',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // the game loads ONLY local bundled content; this lets fetch() read the
      // bundled sfx/*.ogg sample files under the file:// protocol
      webSecurity: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
