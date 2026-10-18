import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

/** How long the "a new preview just landed" flash stays on a card. */
export const JUST_RENDERED_MS = 4000;

/**
 * The app's whole data layer: library payloads, scan progress, settings and
 * the just-rendered flash. Mirrors the original renderer's behaviour exactly -
 * including the rule that the first payload never flashes (app startup is not
 * a render).
 */
export function useLibrary() {
  const [projects, setProjects] = useState([]);
  const [settings, setSettings] = useState({ scanRoots: [], autoScan: true, startWithWindows: true });
  const [scannedAt, setScannedAt] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total } while scanning
  const [progressError, setProgressError] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [justRendered, setJustRendered] = useState(new Map());
  const [version, setVersion] = useState(0); // bumps per library payload

  const projectsRef = useRef([]);
  const initialized = useRef(false);
  const errorTimer = useRef(null);

  const applyLibrary = useCallback((data) => {
    const prevByKey = new Map(projectsRef.current.map((p) => [p.key, p]));
    const next = data.projects || [];
    if (initialized.current) {
      const minted = [];
      for (const p of next) {
        const oldMs = prevByKey.get(p.key)?.proxy?.mtimeMs || 0;
        const newMs = p.proxy?.mtimeMs || 0;
        // +5 s: an imported WAV is converted and re-scanned within seconds -
        // that second bump is the same import, not a new preview.
        if (newMs && newMs > oldMs + 5000) minted.push(p);
      }
      if (minted.length) {
        setJustRendered((m) => {
          const copy = new Map(m);
          for (const p of minted) copy.set(p.key, Date.now());
          return copy;
        });
        for (const p of minted) {
          toast.success('New preview ready', {
            description: `${p.name} - your new preview is live.`,
          });
        }
      }
    } else {
      initialized.current = true;
    }
    projectsRef.current = next;
    setProjects(next);
    if (data.settings) setSettings(data.settings);
    setScannedAt(data.scannedAt || null);
    setStatusNote(''); // a fresh index replaces transient notes, like the old grid re-render did
    setProgress(null);
    setLoaded(true);
    setVersion((v) => v + 1);
  }, []);

  const refresh = useCallback(
    async ({ rescan = false } = {}) => {
      const data = rescan ? await api.scan() : await api.getLibrary();
      applyLibrary(data);
      return data;
    },
    [applyLibrary],
  );

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const offProgress = api.onProgress((p) => {
      const { phase, current, total, message } = p;
      switch (phase) {
        case 'note':
          setStatusNote(message || '');
          return;
        case 'start':
          setScanning(true);
          if (message) setStatusNote(message);
          return;
        case 'scan':
          if (current && total) {
            setScanning(true);
            setProgress({ current, total });
          }
          return;
        case 'done':
          setScanning(false);
          setProgress(null);
          if (message && total == null) setStatusNote(message);
          return;
        case 'watch':
          setScanning(false);
          setProgress(null);
          return;
        case 'error':
          setScanning(false);
          setProgress(null);
          setProgressError(message || 'Scan failed');
          clearTimeout(errorTimer.current);
          errorTimer.current = setTimeout(() => setProgressError(''), 4000);
          return;
        default:
          return;
      }
    });
    const offChanged = api.onLibraryChanged((payload) => applyLibrary(payload));
    return () => {
      offProgress();
      offChanged();
      clearTimeout(errorTimer.current);
    };
  }, [applyLibrary]);

  // Retire the flash ring once its window has passed.
  useEffect(() => {
    if (!justRendered.size) return undefined;
    const t = setTimeout(() => {
      setJustRendered((m) => {
        const now = Date.now();
        const copy = new Map();
        for (const [k, at] of m) if (now - at < JUST_RENDERED_MS) copy.set(k, at);
        return copy;
      });
    }, JUST_RENDERED_MS + 250);
    return () => clearTimeout(t);
  }, [justRendered]);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      await refresh({ rescan: true });
    } finally {
      setScanning(false);
    }
  }, [refresh]);

  const addFolder = useCallback(async () => {
    const s = await api.addFolder();
    if (!s) return;
    setSettings(s);
    await refresh({ rescan: true });
  }, [refresh]);

  const removeFolder = useCallback(
    async (folder) => {
      const s = await api.removeFolder(folder);
      if (s) setSettings(s);
      await refresh({ rescan: true });
    },
    [refresh],
  );

  const setAutoScan = useCallback(async (value) => {
    const s = await api.setSettings({ autoScan: value });
    if (s) setSettings(s);
  }, []);

  /** Persist a settings patch: mirror it instantly, then take the server copy. */
  const patchSettings = useCallback(async (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    const s = await api.setSettings(patch);
    if (s) setSettings(s);
    return s;
  }, []);

  return {
    projects,
    settings,
    scannedAt,
    loaded,
    scanning,
    progress,
    progressError,
    statusNote,
    justRendered,
    version,
    watching: settings.autoScan !== false,
    rescan,
    addFolder,
    removeFolder,
    setAutoScan,
    patchSettings,
  };
}
