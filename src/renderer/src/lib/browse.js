/** Client-side browse helpers - filtering + sorting the in-memory library. */

/**
 * Natural name compare - "demo 2" before "demo 10" - so the grid reads the
 * way a human would order it, not the way bytes happen to sort.
 */
export function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/** What picking a sort key defaults to - the order that is most useful first. */
export const SORT_DEFAULT_DIR = {
  name: 'asc',
  bpm: 'asc',
  length: 'desc',
  modified: 'desc',
  tracks: 'desc',
  versions: 'desc',
  size: 'desc',
  preview: 'asc',
};

/**
 * How close a project is to "listenable right now", most attention needed
 * first: no render yet (0), render out of date (1), audio whose name doesn't
 * match the set (2), matched preview (3).
 */
export function previewRank(p) {
  if (!p.proxy) return 0;
  if (p.proxy.stale) return 1;
  if (!p.proxy.nameMatched) return 2;
  return 3;
}

/** Numbers in the chosen direction; projects missing a value sink to the bottom. */
function numCmp(x, y, asc) {
  const xn = x == null;
  const yn = y == null;
  if (xn && yn) return 0;
  if (xn) return 1;
  if (yn) return -1;
  return asc ? x - y : y - x;
}

export function matchesFilters(p, { search, audioOnly, pinnedOnly, pinned }) {
  if (audioOnly && !p.proxy) return false;
  if (pinnedOnly && !(pinned && pinned.has(p.key))) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  if (p.name.toLowerCase().includes(q)) return true;
  if (p.setNames.some((s) => s.toLowerCase().includes(q))) return true;
  if (p.trackNames.some((n) => n.toLowerCase().includes(q))) return true;
  if (p.bpm != null && String(p.bpm).includes(q)) return true;
  return false;
}

export function sortProjects(list, by, dir) {
  const asc = (dir || SORT_DEFAULT_DIR[by] || 'asc') === 'asc';
  const field = (x, y) => numCmp(x, y, asc);
  return [...list].sort((a, b) => {
    switch (by) {
      case 'bpm':
        return field(a.bpm, b.bpm) || byName(a, b);
      case 'length':
        return field(a.lengthSeconds, b.lengthSeconds) || byName(a, b);
      case 'modified':
        return field(a.mtimeMs, b.mtimeMs) || byName(a, b);
      case 'tracks':
        return field(a.trackCount, b.trackCount) || byName(a, b);
      case 'versions':
        return field(a.backups ? a.backups.count : null, b.backups ? b.backups.count : null) || byName(a, b);
      case 'size':
        return field(a.fileSizeBytes, b.fileSizeBytes) || byName(a, b);
      case 'preview':
        return field(previewRank(a), previewRank(b)) || byName(a, b);
      default:
        return asc ? byName(a, b) : byName(b, a);
    }
  });
}
