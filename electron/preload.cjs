// Bridges the renderer to the main-process LAN link (net.cjs) over IPC.
// contextIsolation is on, so the game only ever sees this narrow, audited surface
// on window.frontlineNet — never Node or ipcRenderer directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frontlineNet', {
  /** start listening for one opponent; resolves { ok, port } | { ok:false, error } */
  host: (port) => ipcRenderer.invoke('net:host', port),
  /** dial a host; resolves { ok } | { ok:false, error } */
  join: (host, port) => ipcRenderer.invoke('net:join', host, port),
  /** this machine's LAN IPv4 addresses (for the host to read aloud) */
  ips: () => ipcRenderer.invoke('net:ips'),
  /** send one encoded protocol message to the peer */
  send: (data) => ipcRenderer.send('net:send', data),
  /** tear down server + socket */
  close: () => ipcRenderer.send('net:close'),
  /** a decoded message line arrived from the peer */
  onMessage: (cb) => ipcRenderer.on('net:message', (_e, data) => cb(data)),
  /** connection lifecycle: listening | connected | closed | error */
  onStatus: (cb) => ipcRenderer.on('net:status', (_e, s) => cb(s))
});
