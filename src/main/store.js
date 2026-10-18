'use strict';

/**
 * Tiny persistence layer. The whole library is a few hundred KB of JSON, so a
 * single file store beats a database here: no native modules, trivial backups,
 * and easy to inspect/fix by hand.
 */

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;

function emptyState() {
  return {
    version: VERSION,
    settings: {
      scanRoots: [],
      proxyDir: null,
      capturesDir: null,
      autoScan: true,
      // The OS startup entry - on by default, switch in Settings.
      startWithWindows: true,
    },
    projects: {},
    scannedAt: null,
  };
}

function createStore(filePath) {
  let state = emptyState();

  function load() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      state = { ...emptyState(), ...parsed };
      state.settings = { ...emptyState().settings, ...(parsed.settings || {}) };
      state.projects = parsed.projects || {};
    } catch {
      state = emptyState();
    }
    return state;
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 0));
    fs.renameSync(tmp, filePath);
  }

  return {
    get state() {
      return state;
    },
    load,
    save,
  };
}

module.exports = { createStore, emptyState, VERSION };
