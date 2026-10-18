'use strict';

/**
 * Independent cross-check: compare the arrangement length derived from each
 * project's .als against the real duration of the audio render found on disk.
 * These are two unrelated measurements (XML clip positions vs decoded PCM
 * sample count), so if they agree, the tempo/length extraction is corroborated.
 */

const fs = require('node:fs');
const path = require('node:path');

const storePath = path.join(process.env.APPDATA, require('../package.json').productName, 'library.json');
const state = JSON.parse(fs.readFileSync(storePath, 'utf8'));

const fmt = (s) =>
  s == null ? '--:--' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const rows = [];
for (const p of Object.values(state.projects)) {
  if (!p.proxy) continue;
  const set = p.sets[p.primarySetIndex] || p.sets[0];
  const alsLen = set && set.meta ? set.meta.lengthSeconds : null;
  const audioLen = p.proxy.durationSeconds;
  if (alsLen == null || audioLen == null) continue;
  const delta = audioLen - alsLen;
  rows.push({
    project: p.name,
    bpm: set.meta.bpm,
    fromAls: fmt(alsLen),
    fromAudio: fmt(audioLen),
    deltaSec: Math.round(delta),
    deltaPct: ((delta / alsLen) * 100).toFixed(1) + '%',
    render: p.proxy.audioName,
  });
}

if (!rows.length) {
  console.log('No project has both an arrangement length and a decodable render.');
} else {
  console.table(rows);
  console.log(
    '\nInterpretation: the two numbers come from completely different places.',
    '\n  fromAls   = last arrangement clip position in the XML, converted via tempo',
    '\n  fromAudio = decoded sample count / sample rate of the render',
    '\nClose values corroborate both. A big gap usually means the render is a',
    '\nshorter edit (or a partial bounce), not that the parse is wrong.',
  );
}
