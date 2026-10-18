'use strict';

/**
 * Tests for the manual preview pipeline:
 *
 *   npm run test:previews
 *
 *   1. encodeWavToMp3  - a real WAV becomes a ~320 kbps MP3 via .part → rename.
 *   2. importDroppedPreview + scanLibrary - a dropped WAV lands as
 *      `<Set Name>.mp3` in the captures folder; the scan picks it up as the
 *      project's preview, calls it verified, and never mistakes stray
 *      `_rendering.*` leftovers for audio.
 *   3. the stale flag tracks the .als mtime.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { importDroppedPreview } = require('../src/main/previews');
const { encodeWavToMp3 } = require('../src/main/mp3');
const { scanLibrary, toSummary } = require('../src/main/library');
const { createStore } = require('../src/main/store');

let fails = 0;
function check(ok, label, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) fails++;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setlist-previews-'));

/** Minimal valid 16-bit PCM WAV (sine). */
function makeWav(seconds = 1, sampleRate = 44100, channels = 2, freq = 440) {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000);
    for (let c = 0; c < channels; c++) data.writeInt16LE(v, (i * channels + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

(async () => {
  /* 1 - WAV → MP3 listening copy ----------------------------------------- */
  const wavPath = path.join(root, 'bounce.wav');
  const mp3Path = path.join(root, 'bounce.mp3');
  fs.writeFileSync(wavPath, makeWav(1));
  const enc = await encodeWavToMp3(wavPath, mp3Path);
  const mp3 = fs.readFileSync(mp3Path);
  const headerOk =
    mp3.subarray(0, 3).toString('latin1') === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0);
  check(fs.existsSync(mp3Path) && !fs.existsSync(`${mp3Path}.part`), 'MP3 written via .part → rename (no half files)');
  check(headerOk, 'MP3 has a real MPEG frame header');
  const kbpsActual = (mp3.length * 8) / 1000 / enc.seconds;
  check(kbpsActual > 280 && kbpsActual < 360, `bitrate ~${Math.round(kbpsActual)} kbps (target 320)`);
  check(
    enc.seconds > 0.99 && enc.seconds < 1.01 && enc.sampleRate === 44100 && enc.channels === 2,
    'duration/format read from the WAV header',
  );

  /* 2 - "Add audio…" import + the scan picks it up ------------------------ */
  const lib = path.join(root, 'lib');
  fs.mkdirSync(path.join(lib, 'Demo Song'), { recursive: true });
  const als = path.join(lib, 'Demo Song', 'Demo Song.als');
  fs.writeFileSync(als, Buffer.from('not really gzip'));
  const caps = path.join(root, 'captures');
  fs.mkdirSync(caps);

  const imp = await importDroppedPreview(caps, 'Demo Song', wavPath);
  check(
    imp.dest === path.join(caps, 'Demo Song.mp3') && fs.existsSync(imp.dest),
    'dropped WAV lands as "<Set Name>.mp3" in the captures folder',
  );

  // Stray `_rendering.*` leftovers must never show up as audio - and a WAV
  // sitting next to the MP3 copy must not shadow it.
  fs.writeFileSync(path.join(caps, 'Demo Song_rendering.wav'), makeWav(0.2));
  fs.writeFileSync(path.join(caps, 'Demo Song_rendering.state.json'), JSON.stringify({ state: 'aborted' }));
  fs.writeFileSync(path.join(caps, 'Demo Song.wav'), makeWav(0.2));

  const store = createStore(path.join(root, 'state.json'));
  store.load();
  const opts = { roots: [lib], proxyDir: path.join(root, 'proxies'), capturesDir: caps, exportDirs: [], store };
  fs.mkdirSync(opts.proxyDir, { recursive: true });
  const first = () => Object.values(store.state.projects)[0];

  await scanLibrary(opts);
  check(/^Demo Song\.mp3$/.test(first().proxy.audioName), 'the imported MP3 is the preview (beats the WAV copy beside it)', first().proxy.audioName);
  check(first().proxy.nameMatched === true && first().proxy.matchRank === 3, 'a listening copy named after the set counts as verified');
  check(first().proxy.location === 'captures', 'provenance says it lives in the captures folder');

  /* 3 - the stale flag tracks the .als mtime ------------------------------ */
  const future = (Date.now() + 60 * 1000) / 1000;
  fs.utimesSync(als, future, future);
  await scanLibrary(opts);
  check(first().proxy.stale === true, 'saved-after-preview project is flagged stale');
  const past = (Date.now() - 60 * 1000) / 1000;
  fs.utimesSync(als, past, past);
  await scanLibrary(opts);
  check(!first().proxy.stale, 'preview newer than the last save is not stale');

  const sum = toSummary(first());
  check(
    sum.proxy && sum.proxy.stale === false && typeof sum.proxy.mtimeMs === 'number',
    'toSummary carries the stale flag + preview mtime',
  );

  console.log(fails ? `\n${fails} FAILED` : '\nall preview-pipeline tests passed');
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
