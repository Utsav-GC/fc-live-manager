'use strict';

/**
 * File-watcher: keeps the library honest while Live is open.
 *
 * `Backup/` changes fire on every save, so we debounce and then let the scanner
 * decide what actually changed (it re-parses only sets whose mtime moved).
 */

const path = require('node:path');
const chokidar = require('chokidar');

const WATCH_EXT = /\.(als|wav|aif|aiff|mp3|m4a|flac|ogg)$/i;
const SKIP_SEGMENTS = ['node_modules', '.git', `${path.sep}Samples${path.sep}`, `${path.sep}Backup${path.sep}`];

function shouldIgnore(p) {
  const lower = p;
  if (lower.startsWith('.') && lower.length === 1) return true;
  return SKIP_SEGMENTS.some((s) => lower.includes(s));
}

function createWatcher({ roots, shallowRoots = [], onChange, debounceMs = 2500 }) {
  if (!roots.length && !shallowRoots.length) return { close: async () => {} };

  let timer = null;
  let pending = null;

  const schedule = (event, file) => {
    if (!WATCH_EXT.test(file)) return;
    pending = { event, file };
    clearTimeout(timer);
    timer = setTimeout(() => {
      const payload = pending;
      pending = null;
      onChange(payload);
    }, debounceMs);
  };

  const attach = (watcher) => {
    watcher
      .on('add', (f) => schedule('add', f))
      .on('change', (f) => schedule('change', f))
      .on('unlink', (f) => schedule('unlink', f))
      .on('error', () => {});
    return watcher;
  };

  const watchers = [];
  if (roots.length) {
    watchers.push(
      attach(
        chokidar.watch(roots, {
          ignoreInitial: true,
          depth: 4,
          ignored: (p) => shouldIgnore(p),
          awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
        }),
      ),
    );
  }
  // Export folders (Desktop, Downloads, …) are only ever searched at their
  // root, so watch them at depth 0 - no reason to walk whole folders.
  if (shallowRoots.length) {
    watchers.push(
      attach(
        chokidar.watch(shallowRoots, {
          ignoreInitial: true,
          depth: 0,
          ignored: (p) => shouldIgnore(p),
          awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
        }),
      ),
    );
  }

  return {
    close: () => Promise.all(watchers.map((w) => w.close())),
  };
}

module.exports = { createWatcher };
