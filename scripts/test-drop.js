'use strict';

/**
 * Drop-import test: a dragged WAV/MP3 becomes `<Set Name>.mp3` in the
 * captures folder - the exact name the app publishes previews under. Runs in
 * plain node (no Electron):  npm run test:drop
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { importDroppedPreview } = require('../src/main/previews');

let failed = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${extra ? ' - ' + extra : ''}`);
  if (!ok) failed++;
}

/** Minimal PCM WAV writer (16-bit / 24-bit int, or 32-bit float). */
function makeWav({ bits = 16, float = false, channels = 2, sampleRate = 44100, seconds = 0.4 }) {
  const frames = Math.round(sampleRate * seconds);
  const bytesPer = bits / 8;
  const dataLen = frames * channels * bytesPer;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(float ? 3 : 1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPer, 28);
  buf.writeUInt16LE(channels * bytesPer, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let f = 0; f < frames; f++) {
    const v = Math.sin((2 * Math.PI * 440 * f) / sampleRate) * 0.5;
    for (let c = 0; c < channels; c++) {
      const o = 44 + (f * channels + c) * bytesPer;
      if (float) buf.writeFloatLE(v, o);
      else if (bits === 16) buf.writeInt16LE(Math.round(v * 32767), o);
      else if (bits === 24) {
        const x = Math.round(v * 8388607) & 0xffffff;
        buf.writeUInt8(x & 0xff, o);
        buf.writeUInt8((x >> 8) & 0xff, o + 1);
        buf.writeUInt8((x >> 16) & 0xff, o + 2);
      }
    }
  }
  return buf;
}

const isMp3 = (file) => {
  const b = fs.readFileSync(file);
  if (b.length < 200) return false;
  const sync = b[0] === 0xff && (b[1] & 0xe0) === 0xe0; // raw MPEG frames
  const id3 = b.subarray(0, 3).toString('latin1') === 'ID3'; // or a tag first
  return sync || id3;
};

const leftovers = (dir) => fs.readdirSync(dir).filter((f) => !f.endsWith('.mp3'));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setlist-drop-'));
  const caps = path.join(tmp, 'caps');
  fs.mkdirSync(caps);

  const wav16 = path.join(tmp, 'bounce16.wav');
  const wav24 = path.join(tmp, 'bounce24.wav');
  const wavF = path.join(tmp, 'bounceF.wav');
  fs.writeFileSync(wav16, makeWav({ bits: 16 }));
  fs.writeFileSync(wav24, makeWav({ bits: 24 }));
  fs.writeFileSync(wavF, makeWav({ bits: 32, float: true }));

  const res16 = await importDroppedPreview(caps, 'My Set', wav16);
  const dest = path.join(caps, 'My Set.mp3');
  check('16-bit WAV converts to "<Set Name>.mp3"', res16.dest === dest && fs.existsSync(dest));
  check('converted file is real MP3', isMp3(dest), `${fs.statSync(dest).size} bytes`);
  check('no leftovers after WAV import', leftovers(caps).length === 0, leftovers(caps).join(', '));

  await importDroppedPreview(caps, 'My Set', wav24);
  check('24-bit WAV (Live default export) converts', isMp3(dest));
  await importDroppedPreview(caps, 'My Set', wavF);
  check('32-bit float WAV converts', isMp3(dest));

  const mp3src = path.join(tmp, 'already.mp3');
  fs.writeFileSync(mp3src, Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(4096, 7)]));
  await importDroppedPreview(caps, 'My Set', mp3src);
  check('MP3 is copied byte-for-byte', fs.readFileSync(dest).equals(fs.readFileSync(mp3src)));
  check('no leftovers after MP3 import', leftovers(caps).length === 0, leftovers(caps).join(', '));

  const unchanged = await importDroppedPreview(caps, 'My Set', dest);
  check('dropping the file already in use is a no-op', unchanged.unchanged === true);

  let refused = false;
  try {
    await importDroppedPreview(caps, 'My Set', path.join(tmp, 'notes.txt'));
  } catch {
    refused = true;
  }
  check('non-audio file refused', refused === true);

  let missing = false;
  try {
    await importDroppedPreview(caps, 'My Set', path.join(tmp, 'nope.wav'));
  } catch {
    missing = true;
  }
  check('ghost path refused', missing === true);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\ntest:drop FAILED (${failed})` : '\ntest:drop OK');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
