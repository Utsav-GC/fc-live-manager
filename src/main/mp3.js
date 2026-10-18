'use strict';

/**
 * Listening-copy encoder: turns an uncompressed WAV preview into a small MP3.
 *
 * WAV previews arrive uncompressed, so the shrink happens here, on the app
 * side, with a pure-JS LAME build (lamejs). ~320 kbps stereo is a full-quality
 * listening copy: a 4-minute song lands at roughly 10 MB instead of ~42 MB.
 *
 * Encoding runs in slices with an `await` between them, so a multi-minute
 * file never blocks scans, IPC or the window while it converts.
 */

const fs = require('node:fs');

const { decodeWav } = require('./peaks');

const FRAMES_PER_SLICE = 50; // MP3 frames (1152 samples each) per event-loop slice
const MP3_KBPS = 320;

/** One sample of any PCM flavor, scaled to signed 16-bit. */
function readPcm16(view, stride, bits, offset, littleEndian, isFloat) {
  if (isFloat) {
    const v =
      stride === 8 ? view.getFloat64(offset, littleEndian) : view.getFloat32(offset, littleEndian);
    return Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  if (bits === 8) return (view.getUint8(offset) - 128) << 8;
  if (bits === 24) {
    // RIFF is little-endian; 24-bit big-endian files don't exist in practice.
    let v =
      (view.getUint8(offset + 2) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset);
    if (v & 0x800000) v -= 0x1000000;
    return v >> 8;
  }
  if (bits === 32) return view.getInt32(offset, littleEndian) >> 16;
  return view.getInt16(offset, littleEndian);
}

let Mp3Encoder = null;
function getEncoder() {
  if (!Mp3Encoder) {
    // lamejs 1.2.0 expects its internals on globals when required from Node
    // (its Lame.js references bare MPEGMode/BitStream at call time). Set them
    // before pulling the package - this is the long-standing Node workaround.
    global.MPEGMode = require('lamejs/src/js/MPEGMode');
    global.Lame = require('lamejs/src/js/Lame');
    global.BitStream = require('lamejs/src/js/BitStream');
    Mp3Encoder = require('lamejs').Mp3Encoder;
  }
  return Mp3Encoder;
}

/**
 * Encode `wavPath` to `mp3Path`. Any PCM flavor is accepted - 16-bit is fed
 * to the encoder zero-copy, 24-bit and float renders (Live's default export
 * formats) are scaled to signed 16-bit up front. Writes to `<mp3Path>.part`
 * first and renames on success, so a half-encoded file never gets picked up.
 * @returns {Promise<{frames:number, sampleRate:number, channels:number, kbps:number, bytes:number, seconds:number}>}
 */
async function encodeWavToMp3(wavPath, mp3Path, kbps = MP3_KBPS) {
  const buf = fs.readFileSync(wavPath);
  const info = decodeWav(buf);
  if (!info) throw new Error('not a PCM WAV');
  const stride = info.bits / 8;
  const frames = Math.floor(info.dataLength / (stride * info.channels));
  if (!frames) throw new Error('empty WAV');

  let samples;
  if (!info.float && info.bits === 16 && info.littleEndian) {
    samples = new Int16Array(buf.buffer, buf.byteOffset + info.dataOffset, frames * info.channels);
  } else {
    samples = new Int16Array(frames * info.channels);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = readPcm16(
        view,
        stride,
        info.bits,
        info.dataOffset + i * stride,
        info.littleEndian,
        info.float,
      );
    }
  }
  const frameSize = 2 * info.channels;
  const enc = new (getEncoder())(info.channels, info.sampleRate, kbps);
  const chunks = [];
  const step = FRAMES_PER_SLICE * 1152;

  for (let f = 0; f < frames; f += step) {
    const n = Math.min(step, frames - f);
    let out;
    if (info.channels === 2) {
      const left = new Int16Array(n);
      const right = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        left[i] = samples[(f + i) * 2];
        right[i] = samples[(f + i) * 2 + 1];
      }
      out = enc.encodeBuffer(left, right);
    } else {
      out = enc.encodeBuffer(samples.subarray(f, f + n));
    }
    if (out.length) chunks.push(Buffer.from(out));
    await new Promise((r) => setImmediate(r)); // keep the app responsive
  }

  const tail = enc.flush();
  if (tail.length) chunks.push(Buffer.from(tail));

  const tmpPath = `${mp3Path}.part`;
  fs.writeFileSync(tmpPath, Buffer.concat(chunks));
  fs.renameSync(tmpPath, mp3Path);

  return {
    frames,
    sampleRate: info.sampleRate,
    channels: info.channels,
    kbps,
    bytes: fs.statSync(mp3Path).size,
    seconds: frames / info.sampleRate,
  };
}

module.exports = { encodeWavToMp3, MP3_KBPS };
