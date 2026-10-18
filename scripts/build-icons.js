'use strict';

/**
 * Builds the app icon (assets/icon.ico + assets/icon.png) from assets/icon.svg.
 *
 *   npm run build:icons
 *
 * Re-runs itself under Electron so Chromium doubles as the SVG rasterizer -
 * no image dependencies. The .ico carries PNG-compressed entries (Vista+
 * reads those natively; Electron and the Windows shell both accept them).
 * Edit the SVG, then run this; the in-app brand mark in top-bar.jsx mirrors
 * the same geometry.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'assets', 'icon.svg');
const ICO_PATH = path.join(ROOT, 'assets', 'icon.ico');
const PNG_PATH = path.join(ROOT, 'assets', 'icon.png');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 1024;

/** Pack PNG payloads into an .ico: 6-byte header + one 16-byte entry each. */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = 6 + directory.length;
  entries.forEach((entry, i) => {
    const b = i * 16;
    const dim = entry.size >= 256 ? 0 : entry.size; // 0 encodes 256
    directory.writeUInt8(dim, b);
    directory.writeUInt8(dim, b + 1);
    directory.writeUInt8(0, b + 2); // palette
    directory.writeUInt8(0, b + 3); // reserved
    directory.writeUInt16LE(1, b + 4); // color planes
    directory.writeUInt16LE(32, b + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, b + 8);
    directory.writeUInt32LE(offset, b + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

// Plain node: hand off to Electron, where the rasterizer lives.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const electron = require('electron');
  const result = spawnSync(electron, [__filename], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');

app.whenReady()
  .then(async () => {
    const svg = fs.readFileSync(SVG_PATH, 'utf8');
    const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    const page = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
      const img = new Image();
      img.src = ${JSON.stringify(svgUrl)};
      window.render = async (size) => {
        await img.decode();
        const c = document.getElementById('c');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        return c.toDataURL('image/png');
      };
    </script></body></html>`;

    const win = new BrowserWindow({ show: false, width: 256, height: 256 });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));

    const grab = async (size) => {
      const dataUrl = await win.webContents.executeJavaScript(`window.render(${size})`);
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    };

    const entries = [];
    for (const size of ICO_SIZES) entries.push({ size, png: await grab(size) });
    const png = await grab(PNG_SIZE);

    fs.writeFileSync(ICO_PATH, packIco(entries));
    fs.writeFileSync(PNG_PATH, png);
    console.log(
      `icons: ${path.relative(ROOT, ICO_PATH)} (${ICO_SIZES.join(', ')}) + ` +
        `${path.relative(ROOT, PNG_PATH)} (${PNG_SIZE}) from ${path.relative(ROOT, SVG_PATH)}`,
    );
    app.quit();
  })
  .catch((err) => {
    console.error('icons: ' + (err && err.message));
    app.exit(1);
  });
