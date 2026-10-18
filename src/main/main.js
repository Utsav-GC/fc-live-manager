'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, protocol, shell, Menu, dialog, net } = require('electron');

const { createStore } = require('./store');
const { scanLibrary, toSummary, listBackups } = require('./library');
const { defaultScanRoots, defaultCapturesDir, defaultExportDirs } = require('./config');
const { createWatcher } = require('./watcher');
const { importDroppedPreview } = require('./previews');

const MEDIA_SCHEME = 'setlist';

let store = null;
let proxyDir = null;
let capturesDir = null;
let mainWindow = null;
let watcher = null;
let scanRunning = false;

// The media scheme is registered as privileged so it behaves like http(s):
// streamable, fetchable, and able to answer Range requests for audio seeking.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

const MIME = {
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
};

function mediaMime(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

/** Only files under a configured scan root (or the peaks cache) are readable. */
function isAllowedPath(p) {
  const target = path.resolve(p).toLowerCase();
  const roots = [...store.state.settings.scanRoots, store.state.settings.capturesDir, proxyDir].filter(Boolean);
  return roots.some((root) => {
    const r = path.resolve(root).toLowerCase();
    return target === r || target.startsWith(r + path.sep);
  });
}

function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    const filePath = url.searchParams.get('path');
    if (!filePath || !isAllowedPath(filePath)) return new Response('forbidden', { status: 403 });

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return new Response('not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('not a file', { status: 404 });

    const type = mediaMime(filePath);
    const range = request.headers.get('range');

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] ? Number(m[1]) : 0;
        let end = m[2] ? Number(m[2]) : stat.size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
          return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        end = Math.min(end, stat.size - 1);
        const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
          },
        });
      }
    }

    const stream = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  });
}

function mediaUrl(absPath) {
  return `${MEDIA_SCHEME}://media/?path=${encodeURIComponent(absPath)}`;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function restoreOrScanSettings() {
  const state = store.state;
  if (!state.settings.scanRoots || !state.settings.scanRoots.length) {
    state.settings.scanRoots = defaultScanRoots();
  }
  if (!state.settings.proxyDir) state.settings.proxyDir = proxyDir;
  if (!state.settings.capturesDir) state.settings.capturesDir = capturesDir;
  if (!Array.isArray(state.settings.exportDirs)) state.settings.exportDirs = defaultExportDirs();
  store.save();
}

async function runScan(reason = 'manual') {
  if (scanRunning) return { skipped: true };
  scanRunning = true;
  const started = Date.now();
  send('library:progress', { phase: 'start', reason, message: 'Scanning…' });
  try {
    const res = await scanLibrary({
      roots: store.state.settings.scanRoots,
      proxyDir,
      capturesDir: store.state.settings.capturesDir,
      exportDirs: store.state.settings.exportDirs,
      store,
      onProgress: (p) => send('library:progress', p),
    });
    const payload = {
      phase: 'done',
      reason,
      elapsedMs: Date.now() - started,
      projects: res.projects,
      errors: res.errors.slice(0, 20),
      message: `Indexed ${res.projects} projects`,
    };
    send('library:progress', payload);
    broadcastLibrary();
    return res;
  } catch (err) {
    send('library:progress', { phase: 'error', message: err.message });
    throw err;
  } finally {
    scanRunning = false;
  }
}

/** runScan, but retried briefly if a scan was already in flight. */
function runScanSoon(reason, tries = 4) {
  runScan(reason)
    .then((r) => {
      if (r && r.skipped && tries > 0) setTimeout(() => runScanSoon(reason, tries - 1), 1500);
    })
    .catch(() => {});
}

function summariseAll() {
  const out = [];
  for (const project of Object.values(store.state.projects)) {
    try {
      out.push(toSummary(project));
    } catch (err) {
      out.push({ key: project.key, name: project.name, dir: project.dir, error: err.message });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function broadcastLibrary() {
  send('library:changed', {
    projects: summariseAll(),
    settings: store.state.settings,
    scannedAt: store.state.scannedAt,
  });
}

function restartWatcher() {
  if (watcher) watcher.close();
  const s = store.state.settings;
  const roots = [...s.scanRoots];
  if (s.capturesDir) roots.push(s.capturesDir);
  // Export folders are searched at their root, so watch them shallowly - but
  // only the ones a scan root doesn't already cover.
  const covered = new Set(roots.map((p) => path.resolve(p).toLowerCase()));
  const shallowRoots = (s.exportDirs || []).filter((p) => !covered.has(path.resolve(p).toLowerCase()));
  watcher = createWatcher({
    roots,
    shallowRoots,
    onChange: (payload) => {
      send('library:progress', { phase: 'watch', message: 'Change detected - updating…', detail: payload });
      runScan('watch').catch(() => {});
    },
  });
}

function registerIpc() {
  ipcMain.handle('library:get', () => ({
    projects: summariseAll(),
    settings: store.state.settings,
    scannedAt: store.state.scannedAt,
  }));

  ipcMain.handle('library:scan', async () => {
    await runScan('manual');
    return { projects: summariseAll(), settings: store.state.settings, scannedAt: store.state.scannedAt };
  });

  ipcMain.handle('library:detail', (_e, { key, setIndex }) => {
    const project = store.state.projects[key];
    if (!project) return null;
    const requested = Number.isInteger(setIndex) ? setIndex : project.primarySetIndex;
    const idx = project.sets[requested] ? requested : 0;
    const set = project.sets[idx];
    const hiddenPreviews = store.state.settings.hiddenPreviews || {};
    return {
      key,
      name: project.name,
      dir: project.dir,
      setIndex: idx,
      proxy: project.proxy,
      previewHidden: !project.proxy && !!hiddenPreviews[key],
      proxyUrl: project.proxy ? mediaUrl(project.proxy.audioPath) : null,
      peaksUrl: project.proxy && project.proxy.peaksFile ? mediaUrl(project.proxy.peaksFile) : null,
      backups: project.backups,
      sets: project.sets.map((s, i) => ({
        index: i,
        name: path.basename(s.path, path.extname(s.path)),
        path: s.path,
        mtimeMs: s.mtimeMs,
        sizeBytes: s.sizeBytes,
        error: s.error || null,
        bpm: s.meta ? s.meta.bpm : null,
        timeSignature: s.meta ? s.meta.timeSignature : null,
        lengthSeconds: s.meta ? s.meta.lengthSeconds : null,
        trackCount: s.meta ? s.meta.trackCount : null,
        ableton: s.meta ? s.meta.ableton : null,
        locators: s.meta ? s.meta.locators : [],
        tracks: s.meta
          ? s.meta.tracks.map((t) => ({
              id: t.id,
              type: t.type,
              name: t.name,
              clipCount: t.clips ? t.clips.length : 0,
              spans: t.clips ? t.clips.map((c) => [Math.round(c.start * 10) / 10, Math.round(c.end * 10) / 10]) : [],
            }))
          : [],
      })),
    };
  });

  ipcMain.handle('library:versions', (_e, { key }) => {
    const project = store.state.projects[key];
    if (!project) return [];
    const dir = project.backups.path;
    if (!dir) return [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === '.als')
      .map((e) => {
        const full = path.join(dir, e.name);
        let st = null;
        try {
          st = fs.statSync(full);
        } catch {
          /* ignore */
        }
        const m = /\[(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\]/.exec(e.name);
        const when = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : st?.mtimeMs ?? null;
        return { name: e.name.replace(/\.als$/i, ''), path: full, mtimeMs: when, sizeBytes: st?.size ?? null };
      })
      .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  });

  ipcMain.handle('settings:set', async (_e, patch) => {
    const s = store.state.settings;
    let rootsChanged = false;
    if (Array.isArray(patch.scanRoots)) {
      s.scanRoots = patch.scanRoots.filter((p) => typeof p === 'string');
      rootsChanged = true;
    }
    if (typeof patch.autoScan === 'boolean') s.autoScan = patch.autoScan;
    let startupChanged = false;
    if (typeof patch.startWithWindows === 'boolean') {
      s.startWithWindows = patch.startWithWindows;
      startupChanged = true;
    }
    if (typeof patch.sort === 'string') s.sort = patch.sort;
    if (patch.sortDir === 'asc' || patch.sortDir === 'desc') s.sortDir = patch.sortDir;
    if (patch.view === 'grid' || patch.view === 'list') s.view = patch.view;
    if (Array.isArray(patch.pinned)) {
      s.pinned = patch.pinned.filter((k) => typeof k === 'string').slice(0, 2000);
    }
    store.save();
    // Only the watched folders affect the watcher - sort/view/pins must stay
    // instant, and restarting chokidar on every click is anything but.
    if (rootsChanged) restartWatcher();
    // …and only the Windows-startup toggle touches the OS startup entry.
    if (startupChanged) applyStartWithWindows();
    return s;
  });

  ipcMain.handle('dialog:addFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Add project folder',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (res.canceled) return null;
    const existing = new Set(store.state.settings.scanRoots.map((p) => path.resolve(p).toLowerCase()));
    for (const p of res.filePaths) {
      if (!existing.has(path.resolve(p).toLowerCase())) store.state.settings.scanRoots.push(p);
    }
    store.save();
    restartWatcher();
    return store.state.settings;
  });

  ipcMain.handle('dialog:removeFolder', (_e, folder) => {
    store.state.settings.scanRoots = store.state.settings.scanRoots.filter(
      (p) => p !== folder,
    );
    store.save();
    restartWatcher();
    return store.state.settings;
  });

  // "Add audio…" - pick an MP3/WAV in a file dialog. The renderer then calls
  // preview:drop with the chosen path, so picking and dragging share one
  // import flow (and one set of toasts).
  ipcMain.handle('dialog:addPreview', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Add preview audio',
      buttonLabel: 'Use this file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio (MP3, WAV)', extensions: ['mp3', 'wav'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { srcPath: res.filePaths[0] };
  });

  ipcMain.handle('shell:reveal', (_e, target) => shell.showItemInFolder(target));

  ipcMain.handle('shell:openInLive', async (_e, alsPath) => {
    const err = await shell.openPath(alsPath);
    return err || null;
  });

  ipcMain.handle('shell:openFolder', async (_e, folder) => {
    const err = await shell.openPath(folder);
    return err || null;
  });

  ipcMain.handle('media:url', (_e, absPath) => mediaUrl(absPath));

  // A file dropped onto a card (or chosen with "Add audio…") becomes that
  // project's listening copy.
  ipcMain.handle('preview:drop', async (_e, { key, srcPath } = {}) => {
    try {
      const project = store.state.projects[key];
      if (!project) return { error: 'That project is no longer in the index.' };
      const primary = project.sets[project.primarySetIndex] || project.sets[0];
      if (!primary) return { error: 'No set file to name the preview after.' };
      const setName = path.basename(primary.path, path.extname(primary.path));
      if (path.extname(srcPath || '').toLowerCase() === '.wav') {
        send('library:progress', { phase: 'note', message: 'Converting your file to MP3…' });
      }
      const res = await importDroppedPreview(store.state.settings.capturesDir, setName, srcPath);
      runScan('drop').catch(() => {});
      return { ok: true, previewName: `${setName}.mp3`, unchanged: !!res.unchanged };
    } catch (err) {
      return { error: err.message };
    }
  });

  // "Remove preview" detaches the listening copy without touching the file:
  // everything older than this moment stops matching for this project, so a
  // fresh render (or a dropped file) takes over again by itself.
  ipcMain.handle('preview:hide', (_e, { key } = {}) => {
    const project = store.state.projects[key];
    if (!project) return { error: 'That project is no longer in the index.' };
    const s = store.state.settings;
    if (!s.hiddenPreviews || typeof s.hiddenPreviews !== 'object') s.hiddenPreviews = {};
    s.hiddenPreviews[key] = Date.now();
    store.save();
    runScanSoon('hide-preview');
    return { ok: true };
  });

  ipcMain.handle('preview:unhide', (_e, { key } = {}) => {
    const s = store.state.settings;
    if (s.hiddenPreviews && typeof s.hiddenPreviews === 'object' && key in s.hiddenPreviews) {
      delete s.hiddenPreviews[key];
      store.save();
      runScanSoon('unhide-preview');
    }
    return { ok: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#09090b',
    show: false,
    autoHideMenuBar: true,
    title: 'FC Live Manager 2026',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // The harnesses always start in grid view, whatever the user last chose.
  const harness = Boolean(process.env.SETLIST_SELFTEST || process.env.SETLIST_SHOT);
  mainWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'index.html'),
    harness ? { query: { view: 'grid' } } : undefined,
  );

  if (process.argv.includes('--devtools')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (process.env.SETLIST_SELFTEST) runSelfTest();
  if (process.env.SETLIST_SHOT) runShots(process.env.SETLIST_SHOT);
}

/**
 * Headless smoke test: loads the UI, inspects the rendered DOM, reports any
 * renderer console errors, then exits. Used to verify builds without eyeballing.
 */
function runSelfTest() {
  const rendererErrors = [];
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) rendererErrors.push(`${message} (${source}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('SELFTEST render-process-gone', JSON.stringify(details));
  });

  const probe = `(() => {
    const cards = document.querySelectorAll('[data-testid="project-card"]');
    const first = cards[0];
    const q = (el, sel) => el.querySelector(sel);
    return {
      title: document.title,
      cards: cards.length,
      hasApi: typeof window.setlist === 'object',
      statusLeft: document.querySelector('[data-testid="status-left"]')?.textContent,
      statusRight: document.querySelector('[data-testid="status-right"]')?.textContent,
      watching: !!document.querySelector('[data-testid="watch-state"]'),
      firstCard: first ? {
        name: q(first, '[data-testid="card-title"]')?.textContent,
        bpm: q(first, '[data-testid="card-bpm"]')?.textContent,
        meta: q(first, '[data-testid="card-meta"]')?.textContent.replace(/\\s+/g,' ').trim(),
        thumbPixels: (() => {
          const c = first.querySelector('canvas');
          if (!c) return 0;
          const ctx = c.getContext('2d');
          const d = ctx.getImageData(0,0,c.width,c.height).data;
          let n = 0; for (let i=3;i<d.length;i+=4) if (d[i] > 0) n++;
          return n;
        })(),
      } : null,
      emptyVisible: !!document.querySelector('[data-testid="empty-state"]'),
      previewBadges: {
        matched: document.querySelectorAll('[data-testid="card-badge-play"]:not([data-loose])').length,
        unmatched: document.querySelectorAll('[data-testid="card-badge-play"][data-loose="true"]').length,
      },
    };
  })()`;

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      // Verify the media protocol end-to-end, including Range (needed to seek).
      const withProxy = Object.values(store.state.projects).find((p) => p.proxy);
      console.log(
        'SELFTEST_PROXIES ' +
          JSON.stringify(
            Object.values(store.state.projects)
              .filter((p) => p.proxy)
              .map((p) => ({ project: p.name, audio: p.proxy.audioName, nameMatched: !!p.proxy.nameMatched })),
            null,
            2,
          ),
      );
      if (withProxy) {
        const url = mediaUrl(withProxy.proxy.audioPath);
        const full = await net.fetch(url);
        const ranged = await net.fetch(url, { headers: { Range: 'bytes=0-1023' } });
        const rangedLen = (await ranged.arrayBuffer()).byteLength;
        const forbidden = await net.fetch(mediaUrl('C:\\Windows\\win.ini'));
        console.log(
          'SELFTEST_MEDIA ' +
            JSON.stringify({
              project: withProxy.name,
              file: withProxy.proxy.audioName,
              full: { status: full.status, type: full.headers.get('content-type'), length: full.headers.get('content-length') },
              ranged: {
                status: ranged.status,
                contentRange: ranged.headers.get('content-range'),
                bodyBytes: rangedLen,
              },
              outsideRoot: forbidden.status,
            }),
        );
      }
      // Wait for the async getLibrary() init to paint.
      await new Promise((r) => setTimeout(r, 3500));
      const result = await mainWindow.webContents.executeJavaScript(probe);
      result.rendererErrors = rendererErrors;
      console.log('SELFTEST ' + JSON.stringify(result, null, 2));

      // Also exercise the detail panel for the first card.
      const detail = await mainWindow.webContents.executeJavaScript(`(async () => {
        const card = document.querySelector('[data-testid="project-card"]:has([data-testid="card-badge-play"][data-loose="true"])') || document.querySelector('[data-testid="project-card"]:has([data-testid="card-badge-play"])') || document.querySelector('[data-testid="project-card"]');
        if (!card) return { ok: false };
        card.click();
        await new Promise(r => setTimeout(r, 1800));
        const d = document.querySelector('[data-testid="detail-sheet"]');
        if (!d) return { ok: false };
        const wave = d.querySelector('[data-testid="wave-canvas"]');
        let wavePixels = 0;
        if (wave) {
          const ctx = wave.getContext('2d');
          const px = ctx.getImageData(0, 0, wave.width, wave.height).data;
          for (let i = 3; i < px.length; i += 4) if (px[i] > 0) wavePixels++;
        }
        const audio = document.querySelector('audio') || null;
        return {
          ok: true,
          open: true,
          heading: d.querySelector('[data-testid="detail-title"]')?.textContent,
          hadPlayBadge: !!card.querySelector('[data-testid="card-badge-play"]'),
          stats: [...d.querySelectorAll('[data-testid="stat"]')].map(s => s.querySelector('[data-testid="stat-k"]').textContent + '=' + s.querySelector('[data-testid="stat-v"]').textContent),
          trackRows: d.querySelectorAll('[data-testid="track-row"]').length,
          playerEnabled: d.querySelector('[data-testid="play-btn"]') ? !d.querySelector('[data-testid="play-btn"]').disabled : null,
          wavePixels,
          sections: [...d.querySelectorAll('[data-testid="section-title"]')].map(h => h.textContent),
          renderBadgeLoose: card.querySelector('[data-testid="card-badge-play"]')?.getAttribute('data-loose') ?? null,
          provenance: d.querySelector('[data-testid="provenance"]')?.textContent || null,
          footer: d.querySelector('[data-testid="detail-footer"]')?.textContent || null,
        };
      })()`);
      console.log('SELFTEST_DETAIL ' + JSON.stringify(detail, null, 2));

      // Settings sheet: swings open only on demand now, so open it to inspect.
      const settingsProbe = await mainWindow.webContents.executeJavaScript(`(async () => {
        const close = document.querySelector('[data-testid="detail-close"]');
        if (close) close.click();
        await new Promise(r => setTimeout(r, 600));
        document.querySelector('[data-testid="settings-button"]')?.click();
        await new Promise(r => setTimeout(r, 700));
        const sheet = document.querySelector('[data-testid="settings-sheet"]');
        const out = {
          open: !!sheet,
          rootRows: document.querySelectorAll('[data-testid="roots"] [data-testid="root-row"]').length,
          capturesRows: document.querySelectorAll('[data-testid="captures"] li').length,
          exportRows: document.querySelectorAll('[data-testid="export-dirs"] li').length,
          stats: document.querySelector('[data-testid="stats"]')?.textContent,
          autoScan: document.querySelector('[data-testid="auto-scan"]')?.getAttribute('data-state'),
        };
        document.querySelector('[data-testid="settings-close"]')?.click();
        return out;
      })()`);
      console.log('SELFTEST_SETTINGS ' + JSON.stringify(settingsProbe, null, 2));

      // Sort menu: key list + direction radios present, a real reorder works,
      // and ESC closes it again. Restores Name/A→Z before exiting.
      const sortProbe = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const openMenu = () => {
          const t = document.querySelector('[data-testid="sort-button"]');
          if (t) t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
        };
        const radios = () => [...document.querySelectorAll('[role="menuitemradio"]')].map(i => i.textContent.trim());
        const pick = (label) => {
          const item = [...document.querySelectorAll('[role="menuitemradio"]')].find(i => i.textContent.trim() === label);
          if (item) item.click();
          return !!item;
        };
        const titles = (n) => [...document.querySelectorAll('[data-testid="card-title"]')].slice(0, n).map(t => t.textContent.trim());

        await wait(400);
        openMenu();
        await wait(450);
        const items = radios();
        const pickedVersions = pick('Versions');
        await wait(400);
        const byVersions = titles(3);
        openMenu();
        await wait(450);
        const pickedName = pick('Name');
        await wait(400);
        const byName = titles(3);
        openMenu();
        await wait(450);
        const el = document.activeElement || document.body;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await wait(300);
        return { ok: true, items, pickedVersions, pickedName, byVersions, byName, openAfterEscape: !!document.querySelector('[role="menuitemradio"]') };
      })()`);
      console.log('SELFTEST_SORT ' + JSON.stringify(sortProbe, null, 2));

      // List view: same data as sortable rows, then back to grid (net-zero).
      const listProbe = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const count = (sel) => document.querySelectorAll(sel).length;
        const before = count('[data-testid="project-card"]');
        document.querySelector('[data-testid="view-toggle"]')?.click();
        await wait(700);
        const headers = [...document.querySelectorAll('[data-testid="list-head"] th')].map(h => h.textContent.trim()).filter(Boolean);
        const rows = count('[data-testid="project-row"]');
        const firstPlays = !!document.querySelector('[data-testid="project-row"] [data-testid="row-play"]');
        document.querySelector('[data-testid="view-toggle"]')?.click();
        await wait(700);
        return { before, rows, headers, firstPlays, backToGrid: count('[data-testid="project-card"]') === before };
      })()`);
      console.log('SELFTEST_LIST ' + JSON.stringify(listProbe, null, 2));

      // Pinning: star flips, chip exists, then unpinned again (net-zero).
      const pinProbe = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const star = () => document.querySelector('[data-testid="project-card"] [data-testid="pin-toggle"]');
        const chip = !!document.querySelector('[data-testid="filter-pinned"]');
        if (!star()) return { ok: false, chip };
        star().click();
        await wait(400);
        const on = star()?.getAttribute('data-pinned') === 'true';
        star()?.click();
        await wait(400);
        const off = star()?.getAttribute('data-pinned') !== 'true';
        return { ok: true, chip, on, off };
      })()`);
      console.log('SELFTEST_PIN ' + JSON.stringify(pinProbe, null, 2));

      // Drop IPC: summaries carry the preview's path (grid play needs it), and
      // a refused file comes back with a plain-words error without any writes.
      const dropProbe = await mainWindow.webContents.executeJavaScript(`(async () => {
        const lib = await window.setlist.getLibrary();
        const withProxy = lib.projects.find((p) => p.proxy);
        const key = document.querySelector('[data-testid="project-card"]')?.getAttribute('data-key');
        const res = key ? await window.setlist.dropPreview(key, 'C:/Windows/win.ini') : null;
        return {
          audioPathInSummary: !!(withProxy && withProxy.proxy && withProxy.proxy.audioPath),
          refusedError: res && res.error,
        };
      })()`);
      console.log('SELFTEST_DROP ' + JSON.stringify(dropProbe, null, 2));

      // Remove-preview round trip: hiding takes the audio off a project without
      // touching the file; unhide brings it straight back (net-zero).
      const hideProbe = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const lib = await window.setlist.getLibrary();
        const target = lib.projects.find((p) => p.proxy);
        if (!target) return { ok: false, reason: 'no project with a preview' };
        const hasProxy = async () => {
          const l = await window.setlist.getLibrary();
          const p = l.projects.find((x) => x.key === target.key);
          return !!(p && p.proxy);
        };
        const poll = async (want) => {
          for (let i = 0; i < 15; i++) {
            if ((await hasProxy()) === want) return true;
            await wait(400);
          }
          return false;
        };
        const hideRes = await window.setlist.hidePreview(target.key);
        const hidden = await poll(false);
        const d1 = await window.setlist.detail(target.key, null);
        const unhideRes = await window.setlist.unhidePreview(target.key);
        const restored = await poll(true);
        const d2 = await window.setlist.detail(target.key, null);
        return {
          ok: !!(hideRes && hideRes.ok && unhideRes && unhideRes.ok),
          audioName: target.proxy.audioName,
          hidden,
          restored,
          hiddenFlag: !!(d1 && d1.previewHidden && !d1.proxy),
          restoredFlag: !!(d2 && !d2.previewHidden && d2.proxy),
        };
      })()`);
      console.log('SELFTEST_HIDE ' + JSON.stringify(hideProbe, null, 2));

      console.log('SELFTEST_ERRORS ' + JSON.stringify(rendererErrors));
    } catch (err) {
      console.log('SELFTEST_FAILED ' + err.message);
    } finally {
      setTimeout(() => app.quit(), 300);
    }
  });
}

/**
 * Screenshot pass for design review: captures the grid, one project's detail
 * pane and the folders drawer, then exits. Visual QA only - never runs by
 * itself, only when SETLIST_SHOT points at an output directory.
 */
async function runShots(outDir) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await mainWindow.webContents.capturePage();
    const file = path.join(outDir, name + '.png');
    fs.writeFileSync(file, img.toPNG());
    console.log('SHOT ' + file);
  };
  try {
    fs.mkdirSync(outDir, { recursive: true });
    await sleep(5000); // first scan lands + cards paint
    await shot('grid');
    await mainWindow.webContents.executeJavaScript(
      '(() => { const c = document.querySelector(\'[data-testid="project-card"]:has([data-testid="card-badge-play"])\') || document.querySelector(\'[data-testid="project-card"]\'); if (c) c.click(); })()',
    );
    await sleep(2600); // detail fetch + peaks load
    await shot('detail');
    await mainWindow.webContents.executeJavaScript(
      '(() => { const x = document.querySelector(\'[data-testid="detail-close"]\'); if (x) x.click(); })()',
    );
    await sleep(600); // sheet exit animation
    await mainWindow.webContents.executeJavaScript(
      '(() => { document.querySelector(\'[data-testid="settings-button"]\')?.click(); })()',
    );
    await sleep(1600);
    await shot('settings');
    await mainWindow.webContents.executeJavaScript(
      '(() => { document.querySelector(\'[data-testid="settings-close"]\')?.click(); })()',
    );
    await sleep(600);
    await mainWindow.webContents.executeJavaScript(
      `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); })()`,
    );
    await sleep(1500);
    await shot('palette');
    // Close the palette, then show the sort menu (keys + direction radios).
    await mainWindow.webContents.executeJavaScript(
      '(() => { const el = document.activeElement || document.body; el.dispatchEvent(new KeyboardEvent(\'keydown\', { key: \'Escape\', bubbles: true, cancelable: true })); })()',
    );
    await sleep(700);
    await mainWindow.webContents.executeJavaScript(
      '(() => { const t = document.querySelector(\'[data-testid="sort-button"]\'); if (t) t.dispatchEvent(new PointerEvent(\'pointerdown\', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType: \'mouse\' })); })()',
    );
    await sleep(900);
    await shot('sortmenu');
    // Close the menu, then show the list view with a pinned row on top;
    // both are restored afterwards so the user's state is untouched.
    await mainWindow.webContents.executeJavaScript(
      '(() => { const el = document.activeElement || document.body; el.dispatchEvent(new KeyboardEvent(\'keydown\', { key: \'Escape\', bubbles: true, cancelable: true })); })()',
    );
    await sleep(600);
    await mainWindow.webContents.executeJavaScript(
      '(() => { document.querySelector(\'[data-testid="view-toggle"]\')?.click(); })()',
    );
    await sleep(700);
    await mainWindow.webContents.executeJavaScript(
      '(() => { document.querySelector(\'[data-testid="project-row"] [data-testid="pin-toggle"]\')?.click(); })()',
    );
    await sleep(600);
    await shot('list');
    await mainWindow.webContents.executeJavaScript(
      '(() => { document.querySelector(\'[data-testid="project-row"] [data-testid="pin-toggle"]\')?.click(); })()',
    );
    await sleep(400);
    await mainWindow.webContents.executeJavaScript(
      '(() => { document.querySelector(\'[data-testid="view-toggle"]\')?.click(); })()',
    );
    await sleep(400);
  } catch (err) {
    console.error('SHOTS failed: ' + (err && err.message));
  }
  app.quit();
}

/**
 * The app shipped as "Setlist" before the rename - carry that profile over on
 * the first launch under the new name so the index and preview caches don't
 * rebuild from scratch. Existing files are never overwritten.
 */
function migrateLegacyUserData() {
  try {
    const userData = app.getPath('userData');
    if (fs.existsSync(path.join(userData, 'library.json'))) return;
    const legacy = path.join(app.getPath('appData'), 'Setlist');
    if (!fs.existsSync(path.join(legacy, 'library.json'))) return;
    fs.mkdirSync(userData, { recursive: true });
    fs.cpSync(legacy, userData, { recursive: true, force: false, errorOnExist: false });
  } catch {
    /* non-fatal - worst case the next scan rebuilds everything */
  }
}

/**
 * The "start with Windows" entry (Windows: HKCU Run; macOS: Login Items).
 * On by default - the switch in Settings turns it off. When running from
 * source, the entry launches Electron with this project as its argument, so
 * `npm start` users get the same behaviour as the installed build.
 */
const STARTUP_ENTRY_NAME = 'FC Live Manager 2026';

function applyStartWithWindows() {
  const desired = store.state.settings.startWithWindows !== false;
  const config = app.isPackaged
    ? { path: process.execPath, args: [] }
    : { path: process.execPath, args: [app.getAppPath()] };
  try {
    app.setLoginItemSettings({ openAtLogin: desired, name: STARTUP_ENTRY_NAME, ...config });
  } catch {
    /* platform without startup entries - nothing to do */
  }
}

app.whenReady().then(() => {
  migrateLegacyUserData();
  proxyDir = path.join(app.getPath('userData'), 'proxies');
  capturesDir = defaultCapturesDir();
  fs.mkdirSync(proxyDir, { recursive: true });
  try {
    fs.mkdirSync(capturesDir, { recursive: true });
  } catch {
    /* non-fatal */
  }

  store = createStore(path.join(app.getPath('userData'), 'library.json'));
  store.load();
  // Earlier builds spelled this setting "startOnLogin" - carry the choice over.
  {
    const s = store.state.settings;
    if (s.startOnLogin !== undefined) {
      if (s.startWithWindows === undefined) s.startWithWindows = s.startOnLogin;
      delete s.startOnLogin;
    }
  }
  restoreOrScanSettings();
  applyStartWithWindows(); // keep the OS startup entry in sync with the setting

  registerMediaProtocol();
  registerIpc();
  Menu.setApplicationMenu(null);
  createWindow();
  restartWatcher();

  // First run (no index yet) scans immediately; otherwise show the cache and
  // refresh in the background.
  if (!Object.keys(store.state.projects).length) {
    mainWindow.webContents.once('did-finish-load', () => runScan('first-run').catch(() => {}));
  } else {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => runScan('startup').catch(() => {}), 400);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  if (process.platform !== 'darwin') app.quit();
});
