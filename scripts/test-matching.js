'use strict';

/**
 * Guards the preview-matching rules. Two failure modes matter:
 *   - false positives: a sample pack or reference track shown as this
 *     project's song (worse than no preview at all)
 *   - false negatives: a real bounce ignored because its name is slightly off
 *
 *   npm run test:matching
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { matchRank, bestRank, collectExportFiles } = require('../src/main/library');

/** [set name, file name, expected rank] - 3 exact, 2 file-prefixes-set, 1 weak, 0 unrelated */
const CASES = [
  // real files found in this user's folders
  ['demo 10', 'demo 10.wav', 3],
  ['demo 12', 'demo 12.mp3', 3],
  ['Ash Rap Beat', 'Ash Rap Beat_95BPM_D#minor Key Master File.wav', 2],
  ['ash rap beat', 'ashrapbeat.wav', 3], // normalisation makes these identical
  ['wedding new', 'wedding new.mp3', 3],
  ['Untitled', 'Untitled.wav', 3],
  ['Untitled-1', 'Untitled.wav', 1], // weak: two Untitled sets could both want it

  // must NOT match - these are source material, not bounces
  ['score', 'NEW SCORE FOR RELEASE.mp3', 0],
  ['synth', '150bpm_ Synth.wav', 0],
  ['Lofi Sad', 'varaha - magadha.wav', 0],
  ['phon 2', 'super slowed.wav', 0],
  ['trivecta', 'preomo slow.wav', 0],
  ['', 'anything.wav', 0],
];

// A folder is often a bucket (`demo 10`) while the set inside is the song
// (`ep 2`); an export may be named after either, so both are accepted.
const FOLDER_CASES = [
  [['ep 2', 'demo 10'], 'demo 10.wav', 3],
  [['mazor lazer', 'demo 7'], 'demo 7.wav', 3],
  [['Untitled', 'Untitled Project'], 'Untitled.wav', 3],
];

let failed = 0;
for (const [names, file, want] of FOLDER_CASES) {
  const got = bestRank(names, file);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(want)}  "${file}"  vs names [${names.join(', ')}]` + (ok ? '' : `  ->  got ${got}`));
}

for (const [set, file, want] of CASES) {
  const got = matchRank(set, file);
  const ok = got === want;
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${String(want)}  "${file}"  vs set "${set}"` + (ok ? '' : `  ->  got ${got}`),
  );
}

// Export folders must be searched at their root only, audio files only.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setlist-exports-'));
try {
  fs.mkdirSync(path.join(tmp, 'nested'));
  fs.writeFileSync(path.join(tmp, 'demo 10.wav'), 'x');
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(tmp, 'nested', 'deep.wav'), 'x');
  const found = collectExportFiles([tmp]);
  const ok = found.length === 1 && found[0].name === 'demo 10.wav';
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  export scan is root-only and audio-only ` +
      `(found ${found.length}: ${found.map((f) => f.name).join(', ') || 'nothing'})`,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} FAILED` : '\nall matching rules behave as intended');
process.exit(failed ? 1 : 0);
