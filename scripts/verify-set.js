'use strict';

/**
 * Proof tool - for every value Setlist displays, print the exact bytes inside
 * the .als that it came from, next to what the app's parser returned.
 *
 * The raw side of this file is deliberately dumb: plain string searches, no
 * shared helpers, no regexes from the parser. The point is that a stranger can
 * read ~100 lines of this file and confirm there is nothing clever happening.
 *
 *   node scripts/verify-set.js "ash rap"        # a project by name
 *   node scripts/verify-set.js "D:\x\song.als"  # one set file
 *   node scripts/verify-set.js --all            # primary set of every project
 *   node scripts/verify-set.js --all --quiet    # one line per project
 *
 * Exit code is 1 if anything disagrees with the raw file.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { parseAls } = require('../src/main/als');
const { createStore } = require('../src/main/store');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', off: '\x1b[0m' }
  : { dim: '', b: '', g: '', r: '', y: '', off: '' };

/* ----------------------------------------------------- raw helpers (dumb on purpose) */

const countLiteral = (xml, lit) => {
  let n = 0;
  let i = 0;
  while ((i = xml.indexOf(lit, i)) >= 0) {
    n++;
    i += lit.length;
  }
  return n;
};

const windowAround = (xml, i, n = 100) => {
  if (i < 0) return '(not found)';
  const s = Math.max(0, i - n);
  const e = Math.min(xml.length, i + n);
  const t = xml.slice(s, e).replace(/\s+/g, ' ').trim();
  return `${s > 0 ? '…' : ''}${t}${e < xml.length ? '…' : ''}`;
};

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------------- per-set */

function proveSet(setPath, meta, opts) {
  const gz = fs.readFileSync(setPath);
  const xml = zlib.gunzipSync(gz).toString('utf8');
  const st = fs.statSync(setPath);
  const rows = [];
  const add = (label, appText, proofText, ok, raw, where) =>
    rows.push({ label, appText, proofText, ok, raw, where });

  if (!opts.quiet) {
    console.log(`\n${C.b}${path.basename(setPath)}${C.off}`);
    console.log(
      `  ${C.dim}on disk   ${(st.size / 1e6).toFixed(1)} MB, last saved ${new Date(st.mtimeMs).toLocaleString()}` +
        ` - this is Windows file info, not read from the .als${C.off}`,
    );
    console.log(
      `  ${C.dim}inside    ${(xml.length / 1e6).toFixed(1)} MB of text once the gzip wrapper is removed${C.off}`,
    );
  }

  // ---- tempo
  const ti = xml.indexOf('<Tempo>');
  const rawTempo = ti < 0 ? null : (/<Manual Value="([\d.]+)"/.exec(xml.slice(ti, ti + 500)) || [])[1];
  add(
    'Tempo',
    `${meta.bpm}`,
    rawTempo == null ? 'not found' : `${round2(Number(rawTempo))} (raw text "${rawTempo}")`,
    rawTempo != null && Math.abs(round2(Number(rawTempo)) - meta.bpm) < 1e-9,
    ti < 0 ? '(no <Tempo> element)' : windowAround(xml, ti, 60),
    `byte ${ti.toLocaleString()} of the decompressed file`,
  );

  // ---- time signature
  const si = xml.indexOf('<RemoteableTimeSignature');
  const seg = si < 0 ? '' : xml.slice(si, si + 500);
  const rNum = (/<Numerator Value="(\d+)"/.exec(seg) || [])[1];
  const rDen = (/<Denominator Value="(\d+)"/.exec(seg) || [])[1];
  add(
    'Signature',
    meta.timeSignature ? `${meta.timeSignature.numerator}/${meta.timeSignature.denominator}` : '-',
    rNum == null || rDen == null ? 'not found' : `${rNum}/${rDen}`,
    !!meta.timeSignature && Number(rNum) === meta.timeSignature.numerator && Number(rDen) === meta.timeSignature.denominator,
    si < 0 ? '(no <RemoteableTimeSignature>)' : windowAround(xml, si, 40),
    `byte ${si.toLocaleString()}`,
  );

  // ---- tracks, counted by literal tag text
  const byTag = {
    MidiTrack: countLiteral(xml, '<MidiTrack '),
    AudioTrack: countLiteral(xml, '<AudioTrack '),
    GroupTrack: countLiteral(xml, '<GroupTrack '),
    ReturnTrack: countLiteral(xml, '<ReturnTrack '),
  };
  const tagTotal = byTag.MidiTrack + byTag.AudioTrack + byTag.GroupTrack + byTag.ReturnTrack;
  const appByType = meta.tracks.reduce((acc, t) => ((acc[t.type] = (acc[t.type] || 0) + 1), acc), {});
  add(
    'Track count',
    `${meta.trackCount}`,
    `${tagTotal}  (MIDI ${byTag.MidiTrack} · audio ${byTag.AudioTrack} · group ${byTag.GroupTrack} · return ${byTag.ReturnTrack})`,
    tagTotal === meta.trackCount,
    `counted literal occurrences of "<MidiTrack ", "<AudioTrack ", "<GroupTrack ", "<ReturnTrack "`,
    'whole file',
  );
  add(
    'Track types',
    Object.entries(appByType).map(([k, v]) => `${k} ${v}`).join(' · '),
    `${byTag.MidiTrack ? `midi ${byTag.MidiTrack}` : ''}${byTag.AudioTrack ? ` · audio ${byTag.AudioTrack}` : ''}` +
      `${byTag.GroupTrack ? ` · group ${byTag.GroupTrack}` : ''}${byTag.ReturnTrack ? ` · return ${byTag.ReturnTrack}` : ''}`,
    (appByType.midi || 0) === byTag.MidiTrack &&
      (appByType.audio || 0) === byTag.AudioTrack &&
      (appByType.group || 0) === byTag.GroupTrack &&
      (appByType.return || 0) === byTag.ReturnTrack,
    'same counts, split by track type',
    '',
  );

  // ---- every track name must exist in the file as a serialized value
  const names = meta.tracks.map((t) => t.name).filter(Boolean);
  const missing = names.filter((n) => xml.indexOf(`Value="${n}"`) < 0 && xml.indexOf(`Value="${escapeXml(n)}"`) < 0);
  const sample = names.slice(0, 5).join(' · ');
  add(
    'Track names',
    `${names.length} names`, 
    `${names.length - missing.length} of ${names.length} found verbatim in the text`,
    missing.length === 0,
    missing.length ? `missing: ${missing.slice(0, 3).join(' · ')}` : `e.g. ${sample}`,
    '<EffectiveName Value="…"> / <UserName Value="…">',
  );

  // ---- locators
  const rawLoc = countLiteral(xml, '<Locator Id=');
  add(
    'Locators',
    `${meta.locators.length}`,
    `${rawLoc}`,
    rawLoc === meta.locators.length,
    rawLoc ? meta.locators.slice(0, 4).map((l) => l.name || '(unnamed)').join(' · ') : 'none in this set',
    'counted literal occurrences of "<Locator Id="',
  );

  // ---- arrangement structure (what the little map on each card is drawn from)
  const startVals = new Set();
  const endVals = new Set();
  for (const m of xml.matchAll(/<CurrentStart Value="([\d.]+)"/g)) startVals.add(Number(m[1]));
  for (const m of xml.matchAll(/<CurrentEnd Value="([\d.]+)"/g)) endVals.add(Number(m[1]));
  const countRe = (re) => (xml.match(re) || []).length;
  const clipElements = countRe(/<MidiClip[\s>]/g) + countRe(/<AudioClip[\s>]/g);
  const appClips = meta.tracks.reduce((n, t) => n + (t.clips || []).length, 0);
  const bad = [];
  for (const t of meta.tracks) {
    for (const c of t.clips || []) {
      if (!startVals.has(c.start)) bad.push(`${t.name || t.type} start ${c.start}`);
      if (!endVals.has(c.end)) bad.push(`${t.name || t.type} end ${c.end}`);
    }
  }
  // A track's body lists Session slots first, then the arrangement. Clips before
  // the first <ArrangerAutomation> marker are Session clips; the map draws only
  // what comes after it, because it is a picture of the arrangement.
  let sessionClips = 0;
  {
    const TRACK = /<(AudioTrack|MidiTrack|GroupTrack|ReturnTrack)\s([^>]*)>/g;
    let mm;
    const marks = [];
    while ((mm = TRACK.exec(xml))) marks.push({ index: mm.index, len: mm[0].length });
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].index : xml.length;
      const body = xml.slice(marks[i].index, end);
      const ai = body.indexOf('<ArrangerAutomation>');
      if (ai < 0) continue;
      sessionClips += (body.slice(0, ai).match(/<(MidiClip|AudioClip)[\s>]/g) || []).length;
    }
  }
  const tracksWithClips = meta.tracks.filter((t) => t.clips && t.clips.length).length;
  add(
    'Arrangement map',
    `${appClips} clips across ${tracksWithClips} tracks`,
    bad.length
      ? `${bad.length} bar positions NOT found in the file, e.g. ${bad[0]}`
      : `every bar position exists in the file (${appClips} starts + ${appClips} ends checked verbatim)`,
    bad.length === 0,
    `file holds ${clipElements} clips in total: ${clipElements - sessionClips} in the arrangement, ` +
      `${sessionClips} in Session-view slots (deliberately not drawn)`,
    `the card draws ${Math.min(tracksWithClips, 28)} rows of up to 120 bars, in file order; x is time in beats`,
  );

  // ---- not in the file at all: length
  add(
    'Length',
    meta.lengthSeconds == null ? '-' : `${Math.floor(meta.lengthSeconds / 60)}:${String(Math.round(meta.lengthSeconds % 60)).padStart(2, '0')}`,
    'DERIVED - no such value exists in an .als',
    true,
    `formula: last clip end (${meta.arrangementEndBeats} units) × 4/${meta.timeSignature ? meta.timeSignature.denominator : 4} × 60 ÷ ${meta.bpm} BPM`,
    '',
  );

  if (!opts.quiet) {
    for (const r of rows) {
      const flag = r.ok ? `${C.g}PASS${C.off}` : `${C.r}FAIL${C.off}`;
      console.log(`\n  ${C.b}${r.label}${C.off}  ${C.dim}(app shows: ${r.appText})${C.off}`);
      console.log(`    proof      ${r.proofText}`);
      if (r.where) console.log(`    ${C.dim}${r.where}${C.off}`);
      if (r.raw) console.log(`    ${C.dim}raw text   ${r.raw}${C.off}`);
      console.log(`    ${flag}`);
    }
    console.log(`\n  ${C.dim}--- first 220 characters of the file Live wrote ---${C.off}`);
    console.log(`  ${C.dim}${xml.slice(0, 220).replace(/\s+/g, ' ').trim()}…${C.off}`);
  }

  return { rows, ok: rows.every((r) => r.ok) };
}

/* ------------------------------------------------------------------------- driver */

function resolveTargets(args, all) {
  const storePath = path.join(
    process.env.APPDATA || '',
    require('../package.json').productName,
    'library.json',
  );
  let state = { projects: {} };
  try {
    const store = createStore(storePath);
    store.load();
    state = store.state;
  } catch {
    /* fall through to path-only mode */
  }
  const projects = Object.values(state.projects);

  const asFile = args.find((a) => a.toLowerCase().endsWith('.als') && fs.existsSync(a));
  if (asFile) return [{ label: path.basename(asFile), setPath: asFile, project: null }];

  const asDir = args.find((a) => fs.existsSync(a) && fs.statSync(a).isDirectory());
  if (asDir) {
    const proj = projects.find((p) => path.resolve(p.dir) === path.resolve(asDir));
    const set = proj ? proj.sets[proj.primarySetIndex] || proj.sets[0] : null;
    if (set) return [{ label: proj.name, setPath: set.path, project: proj }];
    throw new Error(`No indexed project at ${asDir} - run the app or npm run index first.`);
  }

  const frag = args.find((a) => !a.startsWith('--')) || '';
  const matches = projects.filter((p) => !frag || p.name.toLowerCase().includes(frag.toLowerCase()));
  const list = frag || all ? matches : matches.slice(0, 1);
  if (!list.length) throw new Error(`No project matches "${frag}". Try: node scripts/index-cli.js`);
  return list.map((p) => {
    const s = p.sets[p.primarySetIndex] || p.sets[0];
    return { label: p.name, setPath: s.path, project: p };
  });
}

(async () => {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const quiet = args.includes('--all') || args.includes('--quiet');
  const opts = { quiet };
  const targets = resolveTargets(args.filter((a) => a !== '--all'), all);
  const chosen = all ? targets : targets.slice(0, 1);

  const t0 = Date.now();
  let failed = 0;
  let asked = 0;
  let sets = 0;
  const failures = [];

  for (const t of chosen) {
    let meta;
    try {
      meta = await parseAls(t.setPath);
    } catch (err) {
      console.log(`${C.r}SKIP${C.off} ${t.label}: ${err.message}`);
      failed++;
      continue;
    }
    let res;
    try {
      res = proveSet(t.setPath, meta, opts);
    } catch (err) {
      console.log(`${C.r}SKIP${C.off} ${t.label}: ${err.message}`);
      failed++;
      continue;
    }
    sets++;
    asked += res.rows.length;
    if (res.ok) {
      if (quiet) {
        console.log(
          `  ${C.g}ok${C.off}   ${t.label.padEnd(34)} ${meta.bpm} BPM · ` +
            `${meta.timeSignature ? `${meta.timeSignature.numerator}/${meta.timeSignature.denominator}` : '?'} · ` +
            `${meta.trackCount} tracks`,
        );
      }
    } else {
      failed++;
      const bad = res.rows.filter((r) => !r.ok).map((r) => r.label);
      failures.push(`${t.label}: ${bad.join(', ')}`);
    }
  }

  console.log(
    `\n${C.b}${sets} set${sets === 1 ? '' : 's'} checked${C.off} · ${asked} values compared against the raw XML · ` +
      `${failures.length ? `${C.r}${failures.length} disagreements${C.off}` : `${C.g}all agree${C.off}`} · ` +
      `${C.dim}${((Date.now() - t0) / 1000).toFixed(1)}s${C.off}`,
  );
  for (const f of failures) console.log(`  ${C.r}✗${C.off} ${f}`);
  console.log(
    `${C.dim}Read-only: nothing here (or in the app) writes to a project file. ` +
      `The one value that cannot be checked against the file is Length, because no length is stored in it.${C.off}`,
  );
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(`${C.r}error:${C.off} ${err.message}`);
  process.exit(1);
});
