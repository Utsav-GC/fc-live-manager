'use strict';

/**
 * Diagnostic: for every project that has a preview render, decide whether that
 * audio file is *source material inside the set* (i.e. the .als references it
 * as a clip sample) or an *export* (not referenced anywhere in the XML).
 *
 * Method: stream-gunzip the primary .als and search the inflated bytes for the
 * candidate's file name. A file the set loads as a clip appears in a
 * <FilePath Value="..."/> node; an export/mixdown does not.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const storePath = path.join(process.env.APPDATA, require('../package.json').productName, 'library.json');
const state = JSON.parse(fs.readFileSync(storePath, 'utf8'));

const AUDIO = /\.(wav|aif|aiff|mp3|m4a|flac|ogg)$/i;

async function findInAls(alsPath, needles) {
  const found = new Set();
  const lower = needles.map((n) => n.toLowerCase());
  const source = fs.createReadStream(alsPath);
  const gunzip = zlib.createGunzip();
  source.pipe(gunzip);
  let keep = '';
  let bytes = 0;
  let wavCount = 0;
  let sawAbleton = false;
  let firstWav = null;
  for await (const chunk of gunzip) {
    bytes += chunk.length;
    // latin1 keeps every byte 1:1, so lowercasing is a safe ASCII-fold
    const text = keep + chunk.toString('latin1').toLowerCase();
    wavCount += (text.match(/\.wav/g) || []).length;
    if (!sawAbleton) sawAbleton = text.includes('ableton');
    if (!firstWav) {
      const m = text.match(/[^"<>\\/]{3,60}\.wav/g);
      if (m) firstWav = m[0];
    }
    for (let i = 0; i < lower.length; i++) {
      if (!found.has(i) && text.includes(lower[i])) found.add(i);
    }
    keep = text.slice(-512); // overlap so a name split across chunks is still found
  }
  return { found, bytes, wavCount, sawAbleton, firstWav: firstWav ? firstWav.slice(-40) : null };
}

(async () => {
  for (const p of Object.values(state.projects)) {
    if (!p.proxy) continue;
    const set = p.sets[p.primarySetIndex] || p.sets[0];
    if (!set) continue;

    // every audio file sitting loose in the project (Samples/ is not scanned)
    const loose = [];
    const scan = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isFile() && AUDIO.test(e.name)) {
          const full = path.join(dir, e.name);
          const st = fs.statSync(full);
          loose.push({ name: e.name, full, size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    scan(p.dir);
    scan(path.join(p.dir, 'Renders'));
    if (!loose.length) continue;

    const setStat = fs.statSync(set.path);
    const { found: hit, bytes, wavCount, sawAbleton, firstWav } = await findInAls(
      set.path,
      loose.map((l) => l.name),
    );
    loose.forEach((l, i) => {
      l.referenced = hit.has(i);
      l.chosen = l.full === p.proxy.audioPath;
    });
    loose.sort((a, b) => b.size - a.size);

    console.log(
      `\n${p.name}   [primary set: ${path.basename(set.path)} · ${(setStat.size / 1e6).toFixed(1)} MB` +
        ` · set mtime ${new Date(setStat.mtimeMs).toISOString().slice(0, 16)}]`,
    );
    console.log(
      `   control: inflated ${(bytes / 1e6).toFixed(1)} MB · "ableton" ${sawAbleton ? 'found' : 'MISSING!'}` +
        ` · ".wav" x${wavCount}${firstWav ? ` (e.g. ...${firstWav})` : ''}`,
    );
    for (const l of loose) {
      console.log(
        `   ${l.referenced ? 'REFERENCED-BY-SET' : 'not referenced   '}  ${l.name}` +
          `  [${(l.size / 1e6).toFixed(1)} MB · ${new Date(l.mtime).toISOString().slice(0, 16)}]` +
          `${l.chosen ? '   <== used as preview' : ''}`,
      );
    }
  }
})();
