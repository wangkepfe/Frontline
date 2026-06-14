/* One-off asset prep: turn the four generated officer portraits
 * (resources/<Role>.png, 2048², ~4MB each) into bundle-ready art:
 *   - flood-key a baked-in "fake transparency" checkerboard if present
 *     (the Strategy Advisor shipped with one; real alpha passes through)
 *   - erase the AI watermark sparkle (strategy only, light pixels in the
 *     bottom-right corner)
 *   - tight-crop to the alpha bounding box, squared, 3% pad
 *   - resize to 256² and write src/ui/officers/<role>.png
 *   npx electron electron/prep-officers.cjs
 */
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'resources');
const OUT = path.join(__dirname, '..', 'src', 'ui', 'officers');
const FILES = [
  ['Statistics Officer.png', 'stats', false],
  ['Infrastructure Officer.png', 'infra', false],
  ['Frontline Commander.png', 'frontline', false],
  ['Strategy Advisor.png', 'strategy', true] // true = scrub the corner watermark
];

function processOne(file, role, scrubCorner) {
  const img = nativeImage.createFromPath(path.join(SRC, file));
  const { width: w, height: h } = img.getSize();
  const buf = Buffer.from(img.toBitmap()); // BGRA, premultiplied
  const px = (x, y) => (y * w + x) * 4;
  const alphaAt = (x, y) => buf[px(x, y) + 3];

  // ── background keying: only when the corners are opaque (baked checker) ──
  const cornersOpaque =
    alphaAt(2, 2) > 200 && alphaAt(w - 3, 2) > 200 &&
    alphaAt(2, h - 3) > 200 && alphaAt(w - 3, h - 3) > 200;
  if (cornersOpaque) {
    const c1 = [buf[px(2, 2)], buf[px(2, 2) + 1], buf[px(2, 2) + 2]];
    let c2 = c1;
    for (let x = 3; x < w; x++) {
      const o = px(x, 2);
      const d = Math.abs(buf[o] - c1[0]) + Math.abs(buf[o + 1] - c1[1]) + Math.abs(buf[o + 2] - c1[2]);
      if (d > 24) { c2 = [buf[o], buf[o + 1], buf[o + 2]]; break; }
    }
    const TOL = 16;
    const isBg = (o) => {
      const b = buf[o], g = buf[o + 1], r = buf[o + 2];
      const near = (c) => Math.abs(b - c[0]) <= TOL && Math.abs(g - c[1]) <= TOL && Math.abs(r - c[2]) <= TOL;
      return near(c1) || near(c2);
    };
    // BFS from every border pixel so interior darks (outlines, pipe) survive
    const seen = new Uint8Array(w * h);
    const queue = [];
    for (let x = 0; x < w; x++) { queue.push(x, x + (h - 1) * w); }
    for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
    while (queue.length > 0) {
      const i = queue.pop();
      if (seen[i]) continue;
      seen[i] = 1;
      const o = i * 4;
      if (!isBg(o)) continue;
      buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) queue.push(i - 1);
      if (x < w - 1) queue.push(i + 1);
      if (y > 0) queue.push(i - w);
      if (y < h - 1) queue.push(i + w);
    }
    console.log(`${role}: keyed baked background (tones ${c1} / ${c2})`);
  } else {
    console.log(`${role}: real alpha, no keying needed`);
  }

  // ── watermark scrub: light leftovers in the bottom-right corner ──
  if (scrubCorner) {
    let cleared = 0;
    for (let y = Math.floor(h * 0.86); y < h; y++) {
      for (let x = Math.floor(w * 0.86); x < w; x++) {
        const o = px(x, y);
        if (buf[o + 3] > 0 && Math.max(buf[o], buf[o + 1], buf[o + 2]) > 110) {
          buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0;
          cleared++;
        }
      }
    }
    console.log(`${role}: scrubbed ${cleared}px of corner watermark`);
  }

  // ── tight-crop to the alpha bbox, squared with 3% pad ──
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[px(x, y) + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  let cw = maxX - minX + 1, ch = maxY - minY + 1;
  // square it: widen the smaller axis, clamped to the frame
  if (cw < ch) {
    const grow = ch - cw;
    minX = Math.max(0, minX - (grow >> 1));
    cw = Math.min(w - minX, ch);
  } else if (ch < cw) {
    const grow = cw - ch;
    minY = Math.max(0, minY - (grow >> 1));
    ch = Math.min(h - minY, cw);
  }

  const cropped = nativeImage
    .createFromBitmap(buf, { width: w, height: h })
    .crop({ x: minX, y: minY, width: cw, height: ch })
    .resize({ width: 256, height: 256, quality: 'best' });
  fs.writeFileSync(path.join(OUT, `${role}.png`), cropped.toPNG());
  console.log(`${role}: ${cw}x${ch} crop -> 256x256, ${fs.statSync(path.join(OUT, `${role}.png`)).size} bytes`);
}

app.whenReady().then(() => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, role, scrub] of FILES) processOne(file, role, scrub);
  console.log('officer portraits ready ->', OUT);
  app.quit();
});
