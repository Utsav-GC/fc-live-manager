'use strict';

/**
 * Headless smoke test. Launches the app with the self-test hook enabled, waits
 * for the report, and exits non-zero if the renderer logged any errors.
 *
 *   npm run selftest
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const electron = require('electron');

const child = spawn(electron, [path.join(__dirname, '..')], {
  env: { ...process.env, SETLIST_SELFTEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (d) => {
  output += d.toString();
  process.stdout.write(d);
});
child.stderr.on('data', (d) => {
  const s = d.toString();
  output += s;
  // Electron is noisy on stderr even when healthy; only surface real failures.
  if (/SELFTEST_FAILED|Uncaught|TypeError|ReferenceError/.test(s)) process.stderr.write(s);
});

child.on('exit', (code) => {
  const errors = /SELFTEST_ERRORS \[\]/.test(output) || !/SELFTEST_ERRORS/.test(output);
  const ran = /SELFTEST \{/.test(output);
  if (!ran) {
    console.error('\nselftest: renderer never reported - app failed to start');
    process.exit(1);
  }
  if (!errors) {
    console.error('\nselftest: renderer reported console errors');
    process.exit(1);
  }
  console.log('\nselftest: OK');
  process.exit(code || 0);
});
