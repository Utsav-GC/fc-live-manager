import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { CommandPalette } from '@/components/command-palette';
import { DetailSheet } from '@/components/detail-sheet';
import { ProjectList } from '@/components/project-list';
import { EmptyState, GridSkeleton, ProjectGrid } from '@/components/project-grid';
import { SettingsSheet } from '@/components/settings-sheet';
import { ProgressStrip, StatusBar } from '@/components/status-bar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TopBar } from '@/components/top-bar';
import { useLibrary } from '@/hooks/use-library';
import { usePreviewPlayer } from '@/hooks/use-preview-player';
import { api } from '@/lib/api';
import { attachPreview } from '@/lib/attach-preview';
import { matchesFilters, sortProjects, SORT_DEFAULT_DIR } from '@/lib/browse';
import { fmtWhen } from '@/lib/format';

export default function App() {
  const lib = useLibrary();
  const player = usePreviewPlayer();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [view, setView] = useState('grid');
  const [audioOnly, setAudioOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sortHydrated = useRef(false);

  const forcedView = useMemo(() => new URLSearchParams(window.location.search).get('view'), []);
  const pinnedSet = useMemo(() => new Set(lib.settings.pinned || []), [lib.settings.pinned]);

  // Restore the saved sort/view choices once the first payload lands.
  useEffect(() => {
    if (sortHydrated.current || !lib.loaded) return;
    sortHydrated.current = true;
    const s = lib.settings || {};
    if (s.sort && SORT_DEFAULT_DIR[s.sort]) setSort(s.sort);
    if (s.sortDir === 'asc' || s.sortDir === 'desc') setSortDir(s.sortDir);
    if (forcedView === 'grid' || forcedView === 'list') setView(forcedView);
    else if (s.view === 'grid' || s.view === 'list') setView(s.view);
  }, [lib.loaded, lib.settings, forcedView]);

  // A preview that disappears (removed from the detail sheet, deleted on disk)
  // shouldn't keep playing with no card left to control it.
  useEffect(() => {
    if (!player.playingKey) return;
    const p = lib.projects.find((x) => x.key === player.playingKey);
    if (!p || !p.proxy) player.stop();
  }, [lib.projects, player.playingKey, player.stop]);

  // Picking a key applies its most useful direction; the direction radios
  // below the list flip it. Sort, view and pins all stick across restarts.
  const changeSort = (key) => {
    const dir = SORT_DEFAULT_DIR[key] || 'asc';
    setSort(key);
    setSortDir(dir);
    lib.patchSettings({ sort: key, sortDir: dir });
  };
  const changeSortDir = (dir) => {
    setSortDir(dir);
    lib.patchSettings({ sortDir: dir });
  };
  const onSortColumn = (key) => {
    if (key === sort) changeSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else changeSort(key);
  };
  const changeView = (value) => {
    setView(value);
    lib.patchSettings({ view: value });
  };
  const togglePin = (key) => {
    const next = new Set(lib.settings.pinned || []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    lib.patchSettings({ pinned: [...next] });
  };

  /** A file dropped onto a card becomes that project's preview. */
  const onDropFile = async (p, file) => {
    const filePath = api.getPathForFile(file);
    if (!filePath) {
      toast.error('Couldn’t read that file’s location.');
      return;
    }
    await attachPreview(api, p.key, filePath, p.name);
  };

  const visible = useMemo(
    () =>
      sortProjects(
        lib.projects.filter((p) =>
          matchesFilters(p, { search, audioOnly, pinnedOnly, pinned: pinnedSet }),
        ),
        sort,
        sortDir,
      ),
    [lib.projects, search, audioOnly, pinnedOnly, pinnedSet, sort, sortDir],
  );

  // A file dropped anywhere outside a card must not navigate the window.
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  // If a watched rescan drops the open project, close the sheet.
  useEffect(() => {
    if (lib.loaded && selectedKey && !lib.projects.some((p) => p.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [lib.loaded, lib.projects, selectedKey]);

  // "/" focuses the search field, Cmd/Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target;
        const typing =
          t instanceof HTMLElement &&
          (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (!typing) {
          e.preventDefault();
          const input = document.getElementById('search');
          input?.focus();
          input?.select();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const hasAny = lib.projects.length > 0;
  const statusLeft = !lib.loaded
    ? 'Loading…'
    : hasAny
      ? `${visible.length} of ${lib.projects.length} projects`
      : 'No projects';
  const statusRight =
    lib.statusNote ||
    (lib.progress
      ? `${lib.progress.current}/${lib.progress.total}`
      : lib.scannedAt
        ? `Indexed ${fmtWhen(lib.scannedAt)}`
        : '');

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <TopBar
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={changeSort}
          sortDir={sortDir}
          onSortDir={changeSortDir}
          audioOnly={audioOnly}
          onToggleAudio={() => setAudioOnly((v) => !v)}
          pinnedOnly={pinnedOnly}
          onTogglePinned={() => setPinnedOnly((v) => !v)}
          view={view}
          onToggleView={() => changeView(view === 'grid' ? 'list' : 'grid')}
          scanning={lib.scanning}
          onRescan={lib.rescan}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ProgressStrip progress={lib.progress} error={lib.progressError} />

        <main className="min-h-0 flex-1 overflow-y-auto">
          {!lib.loaded ? (
            <GridSkeleton />
          ) : hasAny ? (
            view === 'list' ? (
              <ProjectList
                projects={visible}
                justRendered={lib.justRendered}
                selectedKey={selectedKey}
                pinnedSet={pinnedSet}
                playingKey={player.playingKey}
                sort={sort}
                sortDir={sortDir}
                onSortColumn={onSortColumn}
                onOpen={setSelectedKey}
                onTogglePlay={player.toggle}
                onTogglePin={togglePin}
              />
            ) : (
              <ProjectGrid
                projects={visible}
                justRendered={lib.justRendered}
                selectedKey={selectedKey}
                pinnedSet={pinnedSet}
                playingKey={player.playingKey}
                onOpen={setSelectedKey}
                onTogglePlay={player.toggle}
                onTogglePin={togglePin}
                onDropFile={onDropFile}
              />
            )
          ) : (
            <EmptyState onAddFolder={lib.addFolder} />
          )}
        </main>

        <StatusBar text={statusLeft} watching={lib.watching} right={statusRight} />

        <DetailSheet
          projectKey={selectedKey}
          version={lib.version}
          onClose={() => setSelectedKey(null)}
        />
        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={lib.settings}
          projects={lib.projects}
          onAddFolder={lib.addFolder}
          onRemoveFolder={lib.removeFolder}
          onAutoScan={lib.setAutoScan}
          onStartWithWindows={(v) => lib.patchSettings({ startWithWindows: v })}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          projects={lib.projects}
          onSelectProject={setSelectedKey}
          onRescan={lib.rescan}
          onOpenCaptures={() => lib.settings.capturesDir && api.openFolder(lib.settings.capturesDir)}
          onAddFolder={lib.addFolder}
        />

        <Toaster />
      </div>
    </TooltipProvider>
  );
}
