import { defineConfig, Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/** Dev-only endpoint: POST a data-URL to /__shot to dump a frame to debug/shot.jpg. */
function debugShot(): Plugin {
  return {
    name: 'debug-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const base64 = body.replace(/^data:image\/\w+;base64,/, '');
            const dir = path.resolve(__dirname, 'debug');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'shot.jpg'), Buffer.from(base64, 'base64'));
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    }
  };
}

export default defineConfig({
  // relative base so the built bundle works inside Electron (file://) for the Steam build
  base: './',
  plugins: [debugShot()],
  build: {
    outDir: 'dist',
    target: 'es2022'
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
