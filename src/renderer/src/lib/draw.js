/* Canvas painters for the arrangement thumbnails and the preview waveform.
   Palette mirrors the theme accents (tailwind 400-series family). */

export const TYPE_COLOR = { audio: '#34d399', midi: '#38bdf8', group: '#a78bfa', return: '#fb923c' };
const FALLBACK = '#71717a';

function sizeCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function marquee(ctx, x, y, w, h) {
  // Diagonal "no render" hatch, like a video editor's blank clip.
  ctx.save();
  ctx.strokeStyle = 'rgba(161, 161, 170, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let sx = -h; sx < w; sx += 7) {
    ctx.moveTo(x + sx, y + h);
    ctx.lineTo(x + sx + h, y);
  }
  ctx.clip();
  ctx.stroke();
  ctx.restore();
}

export function drawThumb(canvas, thumb) {
  const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 240;
  const h = canvas.clientHeight || 52;
  const ctx = sizeCanvas(canvas, w, h);
  ctx.clearRect(0, 0, w, h);
  // Faint timeline grid - reads like a DAW, not a chart.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let gx = 0.5; gx < w; gx += 14) ctx.fillRect(gx, 0, 1, h);
  if (!thumb || !thumb.tracks.length || !thumb.lengthBeats) {
    marquee(ctx, 0, 0, w, h);
    return;
  }
  const rows = thumb.tracks.length;
  const rowH = h / rows;
  const barH = Math.max(1.5, Math.min(rowH - 1.5, 5));
  const scale = w / thumb.lengthBeats;
  for (let i = 0; i < rows; i++) {
    const t = thumb.tracks[i];
    const y = i * rowH + (rowH - barH) / 2;
    ctx.fillStyle = TYPE_COLOR[t.type] || FALLBACK;
    ctx.globalAlpha = 0.9;
    for (const [s, e] of t.spans) {
      const x = s * scale;
      const bw = Math.max(1, (e - s) * scale);
      ctx.fillRect(x, y, bw, barH);
    }
  }
  ctx.globalAlpha = 1;
}

export function drawNoRender(canvas) {
  const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 240;
  const h = canvas.clientHeight || 52;
  const ctx = sizeCanvas(canvas, w, h);
  ctx.clearRect(0, 0, w, h);
  marquee(ctx, 0, 0, w, h);
}

export function drawWaveform(canvas, peaks, progress) {
  const w = canvas.clientWidth || 400;
  const h = canvas.clientHeight || 64;
  const ctx = sizeCanvas(canvas, w, h);
  ctx.clearRect(0, 0, w, h);
  if (!peaks || !peaks.bucketCount) return;
  const mid = h / 2;
  const n = peaks.bucketCount;
  const step = w / n;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let gx = 0.5; gx < w; gx += 24) ctx.fillRect(gx, 0, 1, h);
  ctx.fillStyle = '#3f3f46';
  for (let i = 0; i < n; i++) {
    const lo = peaks.peaks[i * 2];
    const hi = peaks.peaks[i * 2 + 1];
    const x = i * step;
    const y0 = mid - hi * mid * 0.94;
    const y1 = mid - lo * mid * 0.94;
    ctx.fillRect(x, y0, Math.max(1, step * 0.9), Math.max(1, y1 - y0));
  }
  if (progress > 0) {
    ctx.fillStyle = '#fbbf24';
    ctx.globalAlpha = 0.9;
    const pw = progress * w;
    for (let i = 0; i < n; i++) {
      const x = i * step;
      if (x > pw) break;
      const lo = peaks.peaks[i * 2];
      const hi = peaks.peaks[i * 2 + 1];
      const y0 = mid - hi * mid * 0.94;
      const y1 = mid - lo * mid * 0.94;
      ctx.fillRect(x, y0, Math.max(1, step * 0.9), Math.max(1, y1 - y0));
    }
    ctx.globalAlpha = 1;
  }
}
