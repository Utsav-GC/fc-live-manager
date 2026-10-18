'use strict';

/**
 * Headless indexer - same code path the app uses, useful for testing and for
 * power users who want a JSON dump without launching the UI.
 *
 *   node scripts/index-cli.js [root]
 */

const fs = require('node:fs');
const path = require('node:path');

const { createStore } = require('../src/main/store');
const { scanLibrary, toSummary } = require('../src/main/library');
const { defaultScanRoots } = require('../src/main/config');

function fmtTime(s) {
  if (s == null) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

(async () => {
  const arg = process.argv[2];
  const roots = arg ? [path.resolve(arg)] : defaultScanRoots();
  const cacheDir = path.join(__dirname, '..', '.cache');
  const proxyDir = path.join(cacheDir, 'proxies');
  const storePath = path.join(cacheDir, 'library.json');

  fs.mkdirSync(cacheDir, { recursive: true });
  const store = createStore(storePath);
  store.load();

  console.log('roots:', roots.join(', '));
  const t0 = Date.now();
  let last = '';
  const res = await scanLibrary({
    roots,
    proxyDir,
    store,
    onProgress: (p) => {
      if (p.message !== last) {
        last = p.message;
        process.stdout.write(`\r${p.message}                    `);
      }
    },
  });
  process.stdout.write('\r');
  console.log(`\nindexed ${res.projects} projects in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const rows = Object.values(store.state.projects).map(toSummary).sort((a, b) => a.name.localeCompare(b.name));
  console.log(
    ['BPM', 'KEY-TS', 'LEN', 'TRK', 'VER', 'PROXY', 'PROJECT'].map((h, i) => h.padEnd([4, 6, 6, 4, 4, 6, 0][i])).join(' '),
  );
  for (const r of rows) {
    const ts = r.timeSignature ? `${r.timeSignature.numerator}/${r.timeSignature.denominator}` : '?';
    console.log(
      [
        String(r.bpm ?? '--').padEnd(4),
        ts.padEnd(6),
        fmtTime(r.lengthSeconds).padEnd(6),
        String(r.trackCount ?? '--').padEnd(4),
        String(r.backups.count).padEnd(4),
        (r.proxy ? (r.proxy.hasWaveform ? 'wave' : 'audio') : '-').padEnd(6),
        r.name,
      ].join(' '),
    );
  }

  const withProxy = rows.filter((r) => r.proxy).length;
  const withWave = rows.filter((r) => r.proxy && r.proxy.hasWaveform).length;
  console.log(`\nproxies: ${withProxy} audio, ${withWave} with waveform`);
  console.log(`store  : ${storePath} (${(fs.statSync(storePath).size / 1024).toFixed(0)} KB)`);
  if (res.errors.length) {
    console.log(`\n${res.errors.length} set(s) failed to parse:`);
    for (const e of res.errors.slice(0, 10)) console.log('  ', e.path, '-', e.error);
  }
})();
