'use strict';

/**
 * Parser for Ableton Live `.als` files.
 *
 * An `.als` is gzip-compressed XML (~118 MB uncompressed for a big project),
 * so we deliberately avoid a DOM. Instead we decompress once and run targeted
 * offset scans. Measured on a 45 MB / 118 MB project: ~470 ms gunzip + ~60 ms scan.
 *
 * Layout facts this relies on (verified against Live 12.3 sets):
 *   - `<Tempo><Manual Value="120"/>` appears exactly once, inside `<MainTrack>`
 *     near the very end of the document.
 *   - Time signature is stored twice: the song's initial signature is the first
 *     `<RemoteableTimeSignature>` (`<Numerator>`/`<Denominator>`, `<Time Value="0">`).
 *     `<TimeSignature><Manual Value="201"/>` is an index into a lookup table, so it
 *     is NOT the signature and must not be used.
 *   - Each track's own `<Name>` is the 6th child, immediately after `<TrackDelay>`,
 *     which makes "first `<Name>` after the track tag" correct.
 *   - Arrangement clips live under `<ArrangerAutomation>`; `<CurrentEnd>` elsewhere
 *     (session clip slots) must not count toward song length.
 */

const fs = require('node:fs');
const zlib = require('node:zlib');

const TRACK_START_RE = /<(AudioTrack|MidiTrack|GroupTrack|ReturnTrack)\s([^>]*)>/g;
// A track's name lives in its own `<Name>` block (6th child, after `<TrackDelay>`):
//   <Name><EffectiveName Value="1-MIDI"/><UserName Value="Drums"/>...</Name>
// Live displays UserName when set, otherwise the auto-generated EffectiveName.
// We match the *first* Effective/UserName pair in a track slice, which is always
// the track's own block because it precedes the DeviceChain.
const EFFECTIVE_NAME_RE = /<EffectiveName Value="([^"]*)"/;
const USER_NAME_RE = /<UserName Value="([^"]*)"/;

const TRACK_TYPE = {
  AudioTrack: 'audio',
  MidiTrack: 'midi',
  GroupTrack: 'group',
  ReturnTrack: 'return',
};

function unescapeXml(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function firstMatch(xml, re, group = 1) {
  const m = re.exec(xml);
  return m ? m[group] : null;
}

function parseTempo(xml) {
  const i = xml.indexOf('<Tempo>');
  if (i < 0) return null;
  const m = /<Manual Value="([\d.]+)"/.exec(xml.slice(i, i + 500));
  // Live stores the manual tempo as a float with representation noise
  // (e.g. 84.0000839), so snap it to 2 decimals.
  return m ? Math.round(Number(m[1]) * 100) / 100 : null;
}

function parseTimeSignature(xml) {
  const i = xml.indexOf('<RemoteableTimeSignature');
  if (i < 0) return null;
  const seg = xml.slice(i, i + 500);
  const num = /<Numerator Value="(\d+)"/.exec(seg);
  const den = /<Denominator Value="(\d+)"/.exec(seg);
  if (!num || !den) return null;
  return { numerator: Number(num[1]), denominator: Number(den[1]) };
}

function parseLocators(xml) {
  const start = xml.indexOf('<Locators>');
  if (start < 0) return [];
  // The container ends at the first `</Locators>` closing the outer element.
  const end = xml.indexOf('</Locators>', start);
  const body = xml.slice(start, end < 0 ? start + 20000 : end);
  const out = [];
  const locRe = /<Locator Id="(-?\d+)">([\s\S]*?)<\/Locator>/g;
  let m;
  while ((m = locRe.exec(body))) {
    const inner = m[2];
    const name = firstMatch(inner, /<Name Value="([^"]*)"/) || '';
    const time = firstMatch(inner, /<Time Value="([\d.]+)"/);
    out.push({ name: unescapeXml(name), time: time == null ? null : Number(time) });
  }
  return out;
}

/**
 * Extract arrangement clip spans from a track slice.
 * Clips are serialized under `<ArrangerAutomation>`; each is a `<MidiClip>` or
 * `<AudioClip>` with `<CurrentStart>`/`<CurrentEnd>` in timeline units.
 */
function extractClips(body) {
  const ai = body.indexOf('<ArrangerAutomation>');
  if (ai < 0) return [];
  const section = body.slice(ai);
  const starts = [];
  const re = /<(MidiClip|AudioClip)\s([^>]*)>/g;
  let m;
  while ((m = re.exec(section))) starts.push(m.index);
  const clips = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : section.length;
    const b = section.slice(starts[i], end);
    const cs = /<CurrentStart Value="([\d.]+)"/.exec(b);
    const ce = /<CurrentEnd Value="([\d.]+)"/.exec(b);
    if (!cs || !ce) continue;
    clips.push({ start: Number(cs[1]), end: Number(ce[1]) });
  }
  return clips;
}

function parseTracks(xml) {
  const starts = [];
  TRACK_START_RE.lastIndex = 0;
  let m;
  while ((m = TRACK_START_RE.exec(xml))) {
    const idM = /Id="(-?\d+)"/.exec(m[2]);
    starts.push({ tag: m[1], index: m.index, id: idM ? Number(idM[1]) : null });
  }

  const tracks = [];
  let arrangementEndBeats = 0;

  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    const sliceEnd = i + 1 < starts.length ? starts[i + 1].index : xml.length;
    const body = xml.slice(cur.index, sliceEnd);

    const effM = EFFECTIVE_NAME_RE.exec(body);
    const userM = USER_NAME_RE.exec(body);
    const name = (userM && userM[1]) || (effM && effM[1]) || '';

    const clips = extractClips(body);
    for (const c of clips) {
      if (c.end > arrangementEndBeats) arrangementEndBeats = c.end;
    }

    tracks.push({
      id: cur.id,
      type: TRACK_TYPE[cur.tag],
      name: unescapeXml(name),
      clips,
    });
  }

  return { tracks, arrangementEndBeats };
}

function parseAbletonHeader(xml) {
  const m = /<Ableton\s([^>]*)>/.exec(xml.slice(0, 1000));
  if (!m) return {};
  const attrs = m[1];
  const pick = (k) => {
    const r = new RegExp(k + '="([^"]*)"').exec(attrs);
    return r ? r[1] : null;
  };
  return {
    creator: pick('Creator'),
    majorVersion: pick('MajorVersion'),
    minorVersion: pick('MinorVersion'),
    schemaChangeCount: pick('SchemaChangeCount'),
  };
}

/**
 * Parse one `.als` file into library metadata.
 * @param {string} filePath
 * @returns {Promise<object>}
 */
async function parseAls(filePath) {
  const stat = await fs.promises.stat(filePath);
  const gz = await fs.promises.readFile(filePath);
  let xml;
  try {
    xml = zlib.gunzipSync(gz).toString('utf8');
  } catch (err) {
    throw new Error(`Not a readable .als (gzip failed): ${err.message}`);
  }

  const header = parseAbletonHeader(xml);
  const bpm = parseTempo(xml);
  const timeSignature = parseTimeSignature(xml);
  const { tracks, arrangementEndBeats } = parseTracks(xml);
  const locators = parseLocators(xml);

  // Timeline positions are counted in the signature's denominator unit, so one
  // unit is (4 / denominator) of a quarter note. 4/4 -> 1, 6/8 -> 0.5.
  const beq = timeSignature && timeSignature.denominator ? 4 / timeSignature.denominator : 1;
  const lengthSeconds = bpm && bpm > 0 ? (arrangementEndBeats * beq * 60) / bpm : null;

  return {
    bpm,
    timeSignature,
    lengthSeconds,
    arrangementEndBeats,
    locators,
    tracks,
    trackCount: tracks.length,
    ableton: header,
    fileSizeBytes: stat.size,
    fileMtime: stat.mtimeMs,
  };
}

module.exports = { parseAls, unescapeXml };
