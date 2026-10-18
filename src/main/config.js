'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/** Folders we look in when the user hasn't configured anything yet. */
function defaultScanRoots() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents', 'Ableton'),
    path.join(home, 'Music'),
  ];
  return candidates.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Where the app keeps its MP3 listening copies - one per song, for every
 * preview the user adds by dropping a file onto a project (or via
 * "Add audio…"). Kept in Documents so it is easy to find.
 */
function defaultCapturesDir() {
  return path.join(os.homedir(), 'Documents', 'Setlist Captures');
}

/**
 * The usual places an export lands when it isn't saved inside the project:
 * Desktop and Downloads especially, because Live remembers the last export
 * folder. Only these folders' *root* is searched (never recursively), and only
 * files whose name matches a set - so sample packs and reference tracks that
 * happen to sit in a subfolder can't be mistaken for a bounce.
 */
function defaultExportDirs() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Music'),
    path.join(home, 'Documents'),
  ];
  return candidates.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Directory names never worth descending into while scanning. */const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '$RECYCLE.BIN',
  'System Volume Information',
  'Samples', // project source material, not sets
  'Backup', // handled explicitly
  'Ableton Project Info',
  'Ableton Folder Info',
]);

const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.flac', '.ogg', '.wv']);
const MAX_SCAN_DEPTH = 5;

module.exports = { defaultScanRoots, defaultCapturesDir, defaultExportDirs, SKIP_DIRS, AUDIO_EXT, MAX_SCAN_DEPTH };
