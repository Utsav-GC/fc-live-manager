'use strict';

/**
 * Preview copies, app side.
 *
 * There is no automatic capture - previews are added by hand. A WAV or MP3
 * dropped onto a project (or picked with "Add audio…") becomes that project's
 * listening copy: `<Set Name>.mp3` in the captures folder - exactly the name
 * the matcher treats as a verified preview. WAVs are converted (any PCM
 * flavor); MP3s are copied byte-for-byte. The file the user chose is never
 * moved or deleted; only the app's own listening copy is written.
 *
 * Writes go through `.part` + rename, so the watcher can never pick up a
 * half-written file.
 */

const fs = require('node:fs');
const path = require('node:path');

const { encodeWavToMp3 } = require('./mp3');

/**
 * Make a dropped/picked file the project's listening copy.
 * @param {string} capturesDir  the app's preview folder
 * @param {string} setName      the primary set's name; the copy is `<setName>.mp3`
 * @param {string} srcPath      the file the user chose (WAV or MP3)
 * @returns {Promise<{dest: string, unchanged?: boolean}>}
 */
async function importDroppedPreview(capturesDir, setName, srcPath) {
  if (!capturesDir || !setName) throw new Error('no preview folder configured');
  const safeName = path.basename(String(setName));
  const ext = path.extname(srcPath || '').toLowerCase();
  if (ext !== '.mp3' && ext !== '.wav') throw new Error('only WAV or MP3 files');
  const st = fs.statSync(srcPath); // throws when the path is gone
  if (!st.isFile()) throw new Error('not a file');
  const dest = path.join(capturesDir, `${safeName}.mp3`);
  if (path.resolve(srcPath).toLowerCase() === path.resolve(dest).toLowerCase()) {
    return { dest, unchanged: true };
  }
  const part = `${dest}.part`;
  try {
    if (ext === '.wav') {
      await encodeWavToMp3(srcPath, dest); // writes <dest>.part itself, then renames
    } else {
      await fs.promises.copyFile(srcPath, part);
      await fs.promises.rename(part, dest);
    }
  } catch (err) {
    try {
      fs.unlinkSync(part);
    } catch {}
    throw err;
  }
  return { dest };
}

module.exports = { importDroppedPreview };
