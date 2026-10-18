/* Waveform fallback for formats the main process can't decode (MP3, M4A, …).
   Chromium decodes them natively; we reduce the PCM to the same
   {bucketCount, peaks: [lo, hi, …]} shape the cached WAV/AIFF peaks use, so
   the canvas code is unchanged. Results are cached per URL for the session. */

const cache = new Map(); // url → Promise<peaks|null>

export const CLIENT_BUCKETS = 1200;

async function compute(url, bucketCount) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(bytes);
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
    const n = Math.max(1, Math.min(bucketCount, left.length));
    const per = left.length / n;
    const peaks = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * per);
      const end = Math.min(left.length, Math.floor((i + 1) * per) + 1);
      let lo = 0;
      let hi = 0;
      for (let f = start; f < end; f++) {
        const v = right ? (left[f] + right[f]) / 2 : left[f];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      peaks[i * 2] = lo;
      peaks[i * 2 + 1] = hi;
    }
    return { bucketCount: n, peaks, durationSeconds: audio.duration };
  } catch {
    return null;
  } finally {
    try {
      ctx.close();
    } catch {
      /* already closed */
    }
  }
}

/** Decode-and-reduce a preview URL into peaks; cached, never throws. */
export function audioPeaks(url, bucketCount = CLIENT_BUCKETS) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) cache.set(url, compute(url, bucketCount).catch(() => null));
  return cache.get(url);
}
