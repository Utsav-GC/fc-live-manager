export function fmtLength(sec) {
  if (sec == null || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (n == null) return '-';
  const mb = n / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function fmtWhen(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  const day = 86400000;
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))} min ago`;
  if (diff < day) return `${Math.round(diff / 3600000)} h ago`;
  if (diff < day * 30) return `${Math.round(diff / day)} d ago`;
  return new Date(ms).toLocaleDateString();
}

export function fmtDate(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ts(r) {
  return r.timeSignature ? `${r.timeSignature.numerator}/${r.timeSignature.denominator}` : '-';
}
