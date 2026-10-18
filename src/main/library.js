'use strict';

/**
 * Library scanner.
 *
 * A "project" is any folder that directly contains one or more `.als` files
 * (Live writes `<name> Project/<name>.als` and keeps history in `Backup/`).
 * Each `.als` directly in the folder is a "set"; anything in `Backup/` is a
 * version we only count.
 *
 * Parsing is sequential on purpose: a single set can decompress to >100 MB, so
 * running several at once risks blowing the heap for little real speed-up.
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseAls } = require('./als');
const { getCachedPeaks, proxyKey } = require('./peaks');
const { SKIP_DIRS, AUDIO_EXT, MAX_SCAN_DEPTH } = require('./config');

const ALS = '.als';

function isAudio(name) {
  return AUDIO_EXT.has(path.extname(name).toLowerCase());
}

function isAls(name) {
  return path.extname(name).toLowerCase() === ALS;
}

/** Stray `_rendering.*` leftovers on disk are never previews. */
function isStagingName(name) {
  return /_rendering\.[a-z0-9.]+$/i.test(name); // `.wav`, `.state`, `.state.json`
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** Walk roots and return every folder that directly contains a `.als`. */
function findProjects(roots) {
  const found = [];

  function walk(dir, depth) {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const alsFiles = [];
    const subdirs = [];
    for (const e of entries) {
      if (e.isFile() && isAls(e.name)) alsFiles.push(path.join(dir, e.name));
      else if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) {
        subdirs.push(path.join(dir, e.name));
      }
    }

    if (alsFiles.length) {
      found.push({ dir, sets: alsFiles });
      return; // a project's subfolders are source material / backups, not projects
    }
    for (const sub of subdirs) walk(sub, depth + 1);
  }

  for (const root of roots) {
    const st = statSafe(root);
    if (st && st.isDirectory()) walk(root, 1);
  }
  return found;
}

/** List `Backup/*.als` versions for a project folder. */
function listBackups(projectDir) {
  const backupDir = path.join(projectDir, 'Backup');
  let entries;
  try {
    entries = fs.readdirSync(backupDir, { withFileTypes: true });
  } catch {
    return { count: 0, lastMtimeMs: null, path: null };
  }
  let count = 0;
  let last = 0;
  for (const e of entries) {
    if (!e.isFile() || !isAls(e.name)) continue;
    count++;
    const st = statSafe(path.join(backupDir, e.name));
    if (st && st.mtimeMs > last) last = st.mtimeMs;
  }
  return { count, lastMtimeMs: last || null, path: backupDir };
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const LOC_WEIGHT = { project: 30, captures: 20, export: 10 };

/**
 * How well an audio file name matches the set it would preview:
 *   3  identical            (`demo 10.wav`  for `demo 10.als`)
 *   2  file starts with set (`Ash Rap Beat_95BPM_…` for `ash rap beat.als`)
 *   1  set starts with file (`untitled.wav` for `Untitled-1.als` - weak, and
 *                            two Untitled projects could both want it)
 *   0  no relationship      (a slowed edit, a promo cut, a stray file)
 */
function matchRank(setName, fileName) {
  const wanted = normName(setName);
  const base = normName(path.basename(fileName, path.extname(fileName)));
  if (!wanted || !base) return 0;
  if (base === wanted) return 3;
  if (base.startsWith(wanted)) return 2;
  if (wanted.startsWith(base) && base.length >= 4) return 1;
  return 0;
}

/** Best rank across several candidate names (the set's, and its folder's). */
function bestRank(names, fileName) {
  let r = 0;
  for (const n of names) r = Math.max(r, matchRank(n, fileName));
  return r;
}

/**
 * The names a preview file might legitimately carry. A project folder is often
 * a bucket ("demo 10") while the set inside is the song ("ep 2") - and users
 * export as often under one as the other, so both are accepted. `matchedOn`
 * records which one actually matched, and the UI says so.
 */
function previewNames(primarySetName, projectName) {
  const folder = String(projectName || '').trim();
  const cleanFolder = folder.replace(/\s*project$/i, '').trim();
  const out = [];
  if (primarySetName) out.push({ name: primarySetName, kind: 'set' });
  if (cleanFolder && normName(cleanFolder) !== normName(primarySetName)) {
    out.push({ name: cleanFolder, kind: 'folder' });
  }
  return out;
}

/**
 * Rank every audio file that could serve as this project's preview, best first.
 * Preference: a name match always beats a non-match; within the same quality of
 * match, a file inside the project beats the captures folder, which beats a
 * loose file found in an export location (Desktop, Downloads, …).
 *
 * Files under `Samples/` are source material and are never used.
 * Export locations are searched at their root only - never recursively.
 */
function rankProxies(projectDir, primarySetName, capturesDir, exportFiles = [], projectName = '') {
  const names = previewNames(primarySetName, projectName || path.basename(projectDir));
  const candidates = [];
  const addFrom = (dir, location, nameFilter) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isFile() || !isAudio(e.name)) continue;
      if (isStagingName(e.name)) continue;
      if (nameFilter && !nameFilter(e.name)) continue;
      const full = path.join(dir, e.name);
      const st = statSafe(full);
      if (!st) continue;
      candidates.push(candidate(full, e.name, st, location, dir, names));
    }
  };

  addFrom(path.join(projectDir, 'Renders'), 'project');
  addFrom(path.join(projectDir, 'Export'), 'project');
  addFrom(path.join(projectDir, 'Exports'), 'project');
  addFrom(projectDir, 'project');

  if (capturesDir) {
    addFrom(capturesDir, 'captures', (name) => names.length === 0 || bestRank(names.map((n) => n.name), name) >= 2);
  }

  // Export folders are the one place a *non-matching* file must be ignored
  // entirely: a stray `dialog.wav` on the Desktop says nothing about this set.
  // Inside a project folder a loose file is at least part of that project.
  for (const f of exportFiles) {
    const c = candidate(f.path, f.name, f, 'export', f.foundIn, names);
    if (c.rank >= 2) candidates.push(c);
  }

  // The app's own MP3 listening copies win ties against the WAVs they were
  // made from - both can sit side by side in the captures folder.
  const score = (c) =>
    c.rank * 1000 +
    LOC_WEIGHT[c.location] +
    Math.min(200, c.size / (20 * 1024 * 1024)) +
    (path.extname(c.path).toLowerCase() === '.mp3' ? 2 : 0);
  candidates.sort((a, b) => score(b) - score(a) || b.mtimeMs - a.mtimeMs);
  return candidates;
}

function candidate(full, name, st, location, foundIn, names) {
  let rank = 0;
  let matchedOn = null;
  for (const n of names) {
    const r = matchRank(n.name, name);
    if (r > rank) {
      rank = r;
      matchedOn = n.kind;
    }
  }
  return {
    path: full,
    name,
    size: st.size,
    mtimeMs: st.mtimeMs,
    location,
    foundIn,
    rank,
    matchedOn,
  };
}

/** Audio files sitting loose in the usual export folders (root only). */
function collectExportFiles(dirs) {
  const out = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !isAudio(e.name)) continue;
      if (isStagingName(e.name)) continue;
      const full = path.join(dir, e.name);
      const st = statSafe(full);
      if (!st) continue;
      out.push({ path: full, name: e.name, size: st.size, mtimeMs: st.mtimeMs, location: 'export', foundIn: dir });
    }
  }
  return out;
}

/**
 * One file cannot be the preview of two different projects. Files inside a
 * project belong to it, but a loose file in Desktop/Downloads may be claimed by
 * several (two sets both named `Untitled`, say). The strongest match wins -
 * exact beats prefix, then bigger/more recent file - and the losers fall
 * through to their next candidate rather than sharing the file.
 */
function resolveProxies(entries) {
  const claims = new Map(); // path -> { index, rank, score }
  const attempts = new Map(); // path -> how many projects could claim it
  entries.forEach((entry, index) => {
    for (const c of entry.ranked) {
      if (c.location !== 'export') continue; // files inside a project belong to it
      attempts.set(c.path, (attempts.get(c.path) || 0) + 1);
      // Two exports is never ambiguous; one file matching several projects is.
      // The export is almost always written just after the set was last saved,
      // so prefer the project whose last save is closest in time to the file.
      const proximity = -Math.abs((c.mtimeMs || 0) - (entry.setMtimeMs || 0));
      const score = c.rank * 1000 + proximity / 1e6 + c.size / 1e9;
      const cur = claims.get(c.path);
      const better = !cur || c.rank > cur.rank || (c.rank === cur.rank && score > cur.score);
      if (better) claims.set(c.path, { index, rank: c.rank, score });
      break; // only the best match of each project lays claim
    }
  });

  return entries.map((entry, index) => {
    for (const c of entry.ranked) {
      const claim = claims.get(c.path);
      if (claim && claim.index !== index) continue; // claimed by a better-matched project
      // A matched name can still be shared ("Untitled" three times over), so
      // say so rather than implying certainty.
      return { ...c, contested: (attempts.get(c.path) || 1) > 1, claimants: attempts.get(c.path) || 1 };
    }
    return null;
  });
}

/** Single best pick, no cross-project conflict handling (kept for scripts). */
function pickProxy(projectDir, primarySetName, capturesDir, exportFiles) {
  return rankProxies(projectDir, primarySetName, capturesDir, exportFiles)[0] || null;
}

function primarySetIndex(sets, projectName) {
  const clean = projectName.replace(/\s*project$/i, '').trim().toLowerCase();
  let best = 0;
  let bestScore = -1;
  sets.forEach((s, i) => {
    const base = path.basename(s.path, path.extname(s.path)).trim().toLowerCase();
    let score = 0;
    if (base === clean) score += 100;
    else if (clean && base.startsWith(clean)) score += 50;
    if (!/^untitled/i.test(base)) score += 5;
    score += i === 0 ? 1 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

async function parseSetCached(setPath, previous) {
  const st = statSafe(setPath);
  if (!st) return { error: 'missing' };
  if (previous && previous.mtimeMs === st.mtimeMs && previous.sizeBytes === st.size && previous.meta) {
    return previous;
  }
  try {
    const meta = await parseAls(setPath);
    return { path: setPath, mtimeMs: st.mtimeMs, sizeBytes: st.size, meta };
  } catch (err) {
    return { path: setPath, mtimeMs: st.mtimeMs, sizeBytes: st.size, meta: null, error: err.message };
  }
}

/**
 * Scan roots and refresh the store in place.
 * @param {object} opts
 * @param {string[]} opts.roots
 * @param {string} opts.proxyDir   where peaks JSON caches live
 * @param {string} [opts.capturesDir]  shared folder of bounce/capture previews
 * @param {string[]} [opts.exportDirs]  usual export locations, searched at root only
 * @param {object} opts.store
 * @param {(p: object) => void} [opts.onProgress]
 */
async function scanLibrary({ roots, proxyDir, capturesDir, exportDirs, store, onProgress }) {
  const state = store.state;
  const discovered = findProjects(roots);
  const seen = new Set();
  const total = discovered.length;
  let index = 0;
  const errors = [];
  const exportFiles = collectExportFiles(exportDirs || []);
  const pending = [];

  for (const { dir, sets } of discovered) {
    index++;
    const key = path.resolve(dir);
    seen.add(key);
    const previous = state.projects[key];
    const prevSetsByPath = new Map((previous?.sets || []).map((s) => [s.path, s]));

    const setRecords = [];
    for (const setPath of sets) {
      const rec = await parseSetCached(setPath, prevSetsByPath.get(setPath));
      if (rec.error && !rec.meta) errors.push({ path: setPath, error: rec.error });
      setRecords.push(rec);
    }
    setRecords.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

    const name = path.basename(dir);
    const primary = primarySetIndex(setRecords, name);
    const primarySet = setRecords[primary];
    const primaryName = primarySet ? path.basename(primarySet.path, path.extname(primarySet.path)) : name;

    // A "removed" preview stays removed: anything older than the moment of
    // removal is skipped, wherever it lives. Fresh files - a new render, a
    // dropped bounce - carry newer timestamps and match again by themselves.
    const hiddenAt = (state.settings.hiddenPreviews || {})[key] || 0;

    pending.push({
      key,
      dir,
      name,
      setRecords,
      primary,
      setMtimeMs: primarySet ? primarySet.mtimeMs : 0,
      ranked: rankProxies(dir, primaryName, capturesDir, exportFiles, name).filter(
        (c) => !hiddenAt || c.mtimeMs > hiddenAt,
      ),
    });

    if (onProgress) {
      onProgress({
        phase: 'scan',
        current: index,
        total,
        project: name,
        message: `Indexed ${index}/${total} · ${name}`,
      });
    }
  }

  // Assign previews only after every project is known, so two projects can't
  // claim the same loose file from Desktop/Downloads.
  const chosen = resolveProxies(pending);

  pending.forEach((p, i) => {
    const pick = chosen[i];
    let proxy = null;
    if (pick) {
      const { peaks } = getCachedPeaks(pick.path, proxyDir);
      proxy = {
        audioPath: pick.path,
        audioName: pick.name,
        nameMatched: pick.rank >= 2,
        matchRank: pick.rank,
        matchedOn: pick.matchedOn,
        contested: !!pick.contested,
        claimants: pick.claimants || 1,
        stale: !!(pick.mtimeMs && p.setMtimeMs && pick.mtimeMs + 1000 < p.setMtimeMs),
        location: pick.location,
        foundIn: pick.foundIn,
        sizeBytes: pick.size,
        mtimeMs: pick.mtimeMs,
        hasWaveform: !!peaks,
        bucketCount: peaks ? peaks.bucketCount : 0,
        durationSeconds: peaks ? peaks.durationSeconds : null,
        peaksFile: peaks ? path.join(proxyDir, `${proxyKey(pick.path)}.json`) : null,
      };
    }

    state.projects[p.key] = {
      key: p.key,
      name: p.name,
      dir: p.dir,
      sets: p.setRecords,
      primarySetIndex: p.primary,
      backups: listBackups(p.dir),
      proxy,
      updatedAt: Date.now(),
    };
  });

  // Drop projects that no longer exist.
  for (const key of Object.keys(state.projects)) {
    if (!seen.has(key)) delete state.projects[key];
  }

  state.scannedAt = Date.now();
  state.settings.scanRoots = roots;
  store.save();
  return { projects: Object.keys(state.projects).length, errors };
}

/** Small arrangement thumbnail: up to `maxRows` non-empty tracks of clip spans. */
function buildThumb(set, maxRows = 28, maxClips = 120) {
  if (!set || !set.meta) return null;
  const tracks = [];
  for (const t of set.meta.tracks) {
    if (!t.clips || !t.clips.length) continue;
    tracks.push({
      type: t.type,
      spans: t.clips.slice(0, maxClips).map((c) => [Math.round(c.start * 10) / 10, Math.round(c.end * 10) / 10]),
    });
    if (tracks.length >= maxRows) break;
  }
  return {
    lengthBeats: set.meta.arrangementEndBeats || 0,
    tracks,
    totalTracks: set.meta.trackCount,
    filledTracks: set.meta.tracks.filter((t) => t.clips && t.clips.length).length,
  };
}

/** Flatten a project to what the list view needs. */
function toSummary(project) {
  const primary = project.sets[project.primarySetIndex] || project.sets[0] || null;
  const meta = primary && primary.meta;
  return {
    key: project.key,
    name: project.name,
    dir: project.dir,
    setName: primary ? path.basename(primary.path, path.extname(primary.path)) : project.name,
    setPath: primary ? primary.path : null,
    setCount: project.sets.length,
    setNames: project.sets.map((s) => path.basename(s.path, path.extname(s.path))),
    bpm: meta ? meta.bpm : null,
    timeSignature: meta ? meta.timeSignature : null,
    lengthSeconds: meta ? meta.lengthSeconds : null,
    trackCount: meta ? meta.trackCount : null,
    arrangementEndBeats: meta ? meta.arrangementEndBeats : null,
    locatorCount: meta ? meta.locators.length : 0,
    ableton: meta ? meta.ableton : null,
    error: primary && primary.error ? primary.error : null,
    fileSizeBytes: primary ? primary.sizeBytes : null,
    mtimeMs: primary ? primary.mtimeMs : null,
    backups: project.backups,
    trackNames: meta
      ? [...new Set(meta.tracks.map((t) => t.name).filter(Boolean))].slice(0, 80)
      : [],
    proxy: project.proxy
      ? {
          audioName: project.proxy.audioName,
          audioPath: project.proxy.audioPath,
          nameMatched: !!project.proxy.nameMatched,
          location: project.proxy.location || 'project',
          foundIn: project.proxy.foundIn || null,
          matchedOn: project.proxy.matchedOn || null,
          contested: !!project.proxy.contested,
          claimants: project.proxy.claimants || 1,
          stale: !!project.proxy.stale,
          mtimeMs: project.proxy.mtimeMs,
          durationSeconds: project.proxy.durationSeconds,
          sizeBytes: project.proxy.sizeBytes,
          hasWaveform: project.proxy.hasWaveform,
        }
      : null,
    thumb: buildThumb(primary),
  };
}

module.exports = {
  scanLibrary,
  findProjects,
  toSummary,
  buildThumb,
  pickProxy,
  rankProxies,
  resolveProxies,
  collectExportFiles,
  matchRank,
  bestRank,
  previewNames,
  listBackups,
};
