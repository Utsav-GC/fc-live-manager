'use strict';

/**
 * Waveform peaks for the preview player.
 *
 * We only need a visual envelope, so this decodes uncompressed PCM (WAV / AIFF)
 * with no third-party dependencies and reduces it to `bucketCount` min/max
 * pairs. Compressed formats return null: they still play, they just get no
 * waveform unless a WAV render exists - which is the common case for Live
 * exports.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_BUCKETS = 1600;

function readSample(view, bytes, bits, offset, littleEndian, isFloat) {
  if (isFloat) return bits === 64 ? view.getFloat64(offset, littleEndian) : view.getFloat32(offset, littleEndian);
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, littleEndian) / 32768;
  if (bits === 24) {
    const b0 = view.getUint8(offset + (littleEndian ? 0 : 2));
    const b1 = view.getUint8(offset + 1);
    const b2 = view.getUint8(offset + (littleEndian ? 2 : 0));
    const v = littleEndian ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
    const signed = v & 0x800000 ? v - 0x1000000 : v;
    return signed / 8388608;
  }
  if (bits === 32) return view.getInt32(offset, littleEndian) / 2147483648;
  return 0;
}

function decodeWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true);
      fmt = { format, channels, sampleRate, bits, float: format === 3 };
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = Math.min(size, buf.length - body);
      if (fmt) break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataOffset < 0 || !fmt.channels) return null;
  return { ...fmt, dataOffset, dataLength, littleEndian: true };
}

function readExtended80(buf, offset) {
  const expon = ((buf[offset] & 0x7f) << 8) | buf[offset + 1];
  const hi = buf.readUInt32BE(offset + 2);
  const lo = buf.readUInt32BE(offset + 6);
  if (expon === 0 && hi === 0 && lo === 0) return 0;
  const sign = buf[offset] & 0x80 ? -1 : 1;
  return sign * (hi * 2 ** (expon - 16383 - 31) + lo * 2 ** (expon - 16383 - 63));
}

function decodeAiff(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'FORM') return null;
  const form = buf.toString('ascii', 8, 12);
  if (form !== 'AIFF' && form !== 'AIFC') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 12;
  const comm = {};
  let ssnd = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, false);
    const body = offset + 8;
    if (id === 'COMM') {
      comm.channels = view.getUint16(body, false);
      comm.frames = view.getUint32(body + 2, false);
      comm.bits = view.getUint16(body + 6, false);
      comm.sampleRate = readExtended80(buf, body + 8);
      const comp = form === 'AIFC' && size >= 22 ? buf.toString('ascii', body + 18, body + 22) : 'NONE';
      comm.float = comp === 'fl32' || comp === 'FL32' || comp === 'fl64';
      comm.compressType = comp;
    } else if (id === 'SSND') {
      ssnd = { dataOffset: body + 8, size: size - 8 };
      if (comm.channels) break;
    }
    offset = body + size + (size % 2);
  }
  if (!comm.channels || !ssnd) return null;
  // 'sowt' is byte-swapped (little-endian) PCM.
  const littleEndian = comm.compressType === 'sowt' || comm.compressType === 'SOWT';
  return {
    channels: comm.channels,
    sampleRate: comm.sampleRate,
    bits: comm.bits,
    float: comm.float,
    dataOffset: ssnd.dataOffset,
    dataLength: Math.min(ssnd.size, buf.length - ssnd.dataOffset),
    littleEndian,
  };
}

function computePeaks(info, buf, bucketCount) {
  const { channels, bits, float, dataOffset, dataLength, littleEndian } = info;
  const bytesPerSample = bits / 8;
  const frameSize = bytesPerSample * channels;
  const frames = Math.floor(dataLength / frameSize);
  if (!frames) return null;
  const view = new DataView(buf.buffer, buf.byteOffset + dataOffset, dataLength);
  const buckets = Math.max(1, Math.min(bucketCount, frames));
  const perBucket = frames / buckets;
  const peaks = new Float32Array(buckets * 2);

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frameSize;
    for (let c = 0; c < channels; c++) {
      sum += readSample(view, bytesPerSample, bits, base + c * bytesPerSample, littleEndian, float);
    }
    const v = channels > 1 ? sum / channels : sum;
    const b = Math.min(buckets - 1, Math.floor(f / perBucket));
    const lo = b * 2;
    if (v < peaks[lo]) peaks[lo] = v;
    if (v > peaks[lo + 1]) peaks[lo + 1] = v;
  }

  // Round to 3 decimals so the JSON stays small.
  const out = new Array(buckets * 2);
  for (let i = 0; i < peaks.length; i++) out[i] = Math.round(peaks[i] * 1000) / 1000;
  return {
    bucketCount: buckets,
    durationSeconds: info.sampleRate ? frames / info.sampleRate : null,
    sampleRate: info.sampleRate,
    channels,
    peaks: out,
  };
}

/** Compute peaks for a PCM file. Returns null for anything undecodable. */
function peaksForFile(filePath, bucketCount = DEFAULT_BUCKETS) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  const header = buf.toString('ascii', 0, 4);
  let info = null;
  if (header === 'RIFF') info = decodeWav(buf);
  else if (header === 'FORM') info = decodeAiff(buf);
  if (!info) return null;
  return computePeaks(info, buf, bucketCount);
}

function proxyKey(filePath) {
  return crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16);
}

/**
 * Peaks are cached on disk keyed by absolute path + mtime so re-scans are free.
 * @returns {{ peaks: object|null, cachePath: string }}
 */
function getCachedPeaks(filePath, cacheDir) {
  const key = proxyKey(filePath);
  const cachePath = path.join(cacheDir, `${key}.json`);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { peaks: null, cachePath };
  }
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { peaks: cached, cachePath };
    }
  } catch {
    /* miss */
  }
  const peaks = peaksForFile(filePath);
  if (!peaks) return { peaks: null, cachePath };
  const record = { ...peaks, mtimeMs: stat.mtimeMs, size: stat.size, source: filePath };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(record));
  return { peaks: record, cachePath };
}

module.exports = { peaksForFile, getCachedPeaks, proxyKey, decodeWav, DEFAULT_BUCKETS };
