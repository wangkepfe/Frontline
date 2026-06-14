// FRONTLINE desktop shell — loads the built game for the Steam distribution.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { NetLink } = require('./net.cjs');

// LAN multiplayer link (src/net drives this over the preload bridge)
const link = new NetLink();
ipcMain.handle('net:host', (_e, port) => link.host(port));
ipcMain.handle('net:join', (_e, host, port) => link.join(host, port));
ipcMain.handle('net:ips', () => link.ips());
ipcMain.on('net:send', (_e, data) => link.send(data));
ipcMain.on('net:close', () => link.close());

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
      preload: path.join(__dirname, 'preload.cjs'),
      // the game loads ONLY local bundled content; this lets fetch() read the
      // bundled sfx/*.ogg sample files under the file:// protocol
      webSecurity: false
    }
  });
  win.removeMenu();
  link.attach(win);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  link.close(); // release the LAN port
  app.quit();
});
