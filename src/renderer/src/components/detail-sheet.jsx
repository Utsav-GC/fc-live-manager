import { useEffect, useRef, useState } from 'react';
import { ExternalLink, EyeOff, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WavePlayer } from '@/components/wave-player';
import { api } from '@/lib/api';
import { attachPreview } from '@/lib/attach-preview';
import { TYPE_COLOR } from '@/lib/draw';
import { fmtBytes, fmtDate, fmtLength, fmtWhen } from '@/lib/format';
import { provenanceText, STALE_NOTE, whereIsPreview } from '@/lib/provenance';
import { cn } from '@/lib/utils';

function Stat({ k, v, accent }) {
  return (
    <div data-testid="stat" className="bg-background p-3">
      <div data-testid="stat-k" className="label-micro">
        {k}
      </div>
      <div
        data-testid="stat-v"
        className={cn('mt-1 font-mono text-sm font-medium tabular-nums', accent && 'text-primary')}
      >
        {v}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <h4 data-testid="section-title" className="label-micro">
      {children}
    </h4>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[76px] w-full" />
      <Skeleton className="h-[148px] w-full" />
      <div className="space-y-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}

function DetailBody({ detail, set, versions, setIndex, onSetIndex, onRemovePreview, onAddPreview, onDropFile }) {
  const warn = detail.proxy && !detail.proxy.nameMatched;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
        <Stat k="Tempo" v={set.bpm != null ? set.bpm : '-'} accent />
        <Stat
          k="Signature"
          v={
            set.timeSignature
              ? `${set.timeSignature.numerator}/${set.timeSignature.denominator}`
              : '-'
          }
        />
        <Stat k="Length" v={fmtLength(set.lengthSeconds)} />
        <Stat k="Tracks" v={set.trackCount ?? '-'} />
        <Stat k="Versions" v={detail.backups.count} />
        <Stat k="Size" v={fmtBytes(set.sizeBytes)} />
      </div>

      {detail.sets.length > 1 ? (
        <div className="space-y-2">
          <SectionLabel>Sets in this project</SectionLabel>
          <Tabs value={String(setIndex)} onValueChange={(v) => onSetIndex(Number(v))}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-0.5">
              {detail.sets.map((s, i) => (
                <TabsTrigger key={i} value={String(i)} className="px-2.5 text-xs">
                  {s.name} ({s.bpm ?? '--'})
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Preview</SectionLabel>
          <div className="-mr-2 flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="add-preview"
                  onClick={onAddPreview}
                  className="h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                >
                  <Upload className="size-3" />
                  {detail.proxy ? 'Replace' : 'Add audio'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 leading-relaxed">
                Pick an MP3 or WAV from anywhere on the machine - it becomes this project's
                preview. You can also drag a file straight onto the player.
              </TooltipContent>
            </Tooltip>
            {detail.proxy ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="remove-preview"
                    onClick={onRemovePreview}
                    className="h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                  >
                    <EyeOff className="size-3" />
                    Remove
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 leading-relaxed">
                  Takes the preview off this project - the file itself stays where it is. Add or
                  drop a new audio file and it comes right back.
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <WavePlayer proxyUrl={detail.proxyUrl} peaksUrl={detail.peaksUrl} onDropFile={onDropFile} />
        {!detail.proxy && detail.previewHidden ? (
          <p
            data-testid="preview-hidden-note"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            You removed this preview - the file is still on disk. Add or drop a new audio file,
            and the preview comes back by itself.
          </p>
        ) : null}
        {detail.proxy ? (
          <>
            <p
              data-testid="provenance"
              className={cn(
                'text-xs leading-relaxed',
                warn ? 'text-primary/90' : 'text-muted-foreground',
              )}
            >
              {provenanceText(detail.proxy)}
            </p>
            {detail.proxy.stale ? (
              <p className="text-xs leading-relaxed text-primary/90">{STALE_NOTE}</p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="space-y-2">
        <SectionLabel>{`Tracks (${set.tracks.length})`}</SectionLabel>
        <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1.5">
          {set.tracks.map((t, i) => (
            <div
              key={i}
              data-testid="track-row"
              className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent/40"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: TYPE_COLOR[t.type] || '#71717a' }}
              />
              <span className="min-w-0 flex-1 truncate" title={t.name}>
                {t.name || `(${t.type})`}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {t.clipCount ? `${t.clipCount} clip${t.clipCount > 1 ? 's' : ''}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      {set.locators && set.locators.length ? (
        <div className="space-y-2">
          <SectionLabel>{`Locators (${set.locators.length})`}</SectionLabel>
          <div className="space-y-0.5">
            {set.locators.map((loc, i) => {
              const beats = loc.time != null ? loc.time : 0;
              const bar =
                set.bpm && set.timeSignature
                  ? Math.floor(
                      beats / (set.timeSignature.numerator * (4 / set.timeSignature.denominator)),
                    ) + 1
                  : null;
              return (
                <div
                  key={i}
                  data-testid="locator-row"
                  className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 truncate" title={loc.name}>
                    {loc.name || '(unnamed)'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {bar != null ? `bar ${bar}` : `${beats} beats`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {versions.length ? (
        <div className="space-y-2">
          <SectionLabel>{`Versions (${versions.length})`}</SectionLabel>
          <div className="space-y-0.5">
            {versions.slice(0, 40).map((v, i) => (
              <div
                key={i}
                data-testid="version-row"
                className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent/40"
              >
                <span className="min-w-0 flex-1 truncate" title={v.name}>
                  {v.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {fmtDate(v.mtimeMs)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => api.openInLive(v.path)}
                >
                  Open
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Reveal in Explorer"
                      className="size-6 text-muted-foreground"
                      onClick={() => api.reveal(v.path)}
                    >
                      <ExternalLink className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reveal in Explorer</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={() => api.openInLive(set.path)}>
          Open in Live
        </Button>
        <Button variant="outline" size="sm" onClick={() => api.openFolder(detail.dir)}>
          Open project folder
        </Button>
        <Button variant="ghost" size="sm" onClick={() => api.reveal(set.path)}>
          Reveal set
        </Button>
      </div>

      <p data-testid="detail-footer" className="text-[11px] leading-relaxed text-muted-foreground">
        {[
          set.ableton?.creator || 'Ableton Live',
          `saved ${fmtWhen(set.mtimeMs)}`,
          `set file ${fmtBytes(set.sizeBytes)}`,
          detail.proxy
            ? detail.proxy.nameMatched
              ? `preview: ${detail.proxy.audioName} (${whereIsPreview(detail.proxy)})`
              : `audio ${whereIsPreview(detail.proxy)}: ${detail.proxy.audioName} (name doesn't match this set)`
            : 'no audio yet',
        ].join(' · ')}
      </p>
    </div>
  );
}

export function DetailSheet({ projectKey, version, onClose }) {
  const [detail, setDetail] = useState(null);
  const [versions, setVersions] = useState([]);
  const [setIndex, setSetIndex] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const prevKey = useRef(null);
  const loading = projectKey != null && !detail && !notFound;

  useEffect(() => {
    if (!projectKey) return undefined;
    let cancelled = false;
    const isNew = prevKey.current !== projectKey;
    prevKey.current = projectKey;
    if (isNew) {
      // Opening a different project: drop the old content so nothing flashes.
      setDetail(null);
      setVersions([]);
      setNotFound(false);
    }
    (async () => {
      const [d, v] = await Promise.all([api.detail(projectKey, null), api.versions(projectKey)]);
      if (cancelled) return;
      if (!d) {
        setDetail(null);
        setNotFound(true);
        return;
      }
      setDetail(d);
      setVersions(v || []);
      if (isNew) setSetIndex(d.setIndex || 0);
      else setSetIndex((i) => (d.sets && d.sets[i] ? i : d.setIndex || 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey, version]);

  // "Remove preview" hides the listening copy for this project - the file is
  // never touched, and adding or dropping a new file replaces it naturally.
  const removePreview = async () => {
    const name = detail && detail.proxy ? detail.proxy.audioName : null;
    const res = await api.hidePreview(projectKey);
    if (res && res.error) {
      toast.error(res.error);
      return;
    }
    const stays = name ? `${name} stays` : 'The file stays';
    toast('Preview removed', {
      description: `${stays} in its folder - it just won't play here. Add or drop a new file and it comes back by itself.`,
      action: { label: 'Undo', onClick: () => api.unhidePreview(projectKey) },
    });
  };

  /** "Add audio…" - file picker; the chosen file goes through the same import
      flow as a drop, so both end up as `<Set Name>.mp3` in the captures folder. */
  const addPreview = async () => {
    if (projectKey == null) return;
    const picked = await api.pickPreview();
    if (!picked || picked.canceled || !picked.srcPath) return;
    await attachPreview(api, projectKey, picked.srcPath, detail?.name);
  };

  /** A file dropped onto the player becomes this project's preview. */
  const dropPreviewFile = async (file) => {
    if (projectKey == null) return;
    const filePath = api.getPathForFile(file);
    if (!filePath) {
      toast.error('Couldn’t read that file’s location.');
      return;
    }
    await attachPreview(api, projectKey, filePath, detail?.name);
  };

  const set = detail ? detail.sets[setIndex] || detail.sets[0] || null : null;

  return (
    <Sheet
      open={!!projectKey}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        data-testid="detail-sheet"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[470px]"
      >
        <SheetTitle className="sr-only">{detail ? detail.name : 'Project'}</SheetTitle>
        <SheetDescription className="sr-only">Project details and preview</SheetDescription>

        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2
              data-testid="detail-title"
              className="truncate text-lg font-semibold tracking-tight"
              title={detail?.name}
            >
              {detail ? detail.name : 'Loading…'}
            </h2>
            {detail ? (
              <p className="mt-1 font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
                {detail.dir}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            data-testid="detail-close"
            aria-label="Close"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-6">
          {notFound ? (
            <p className="text-sm text-muted-foreground">Project not found.</p>
          ) : loading || !set ? (
            <DetailSkeleton />
          ) : (
            <DetailBody
              detail={detail}
              set={set}
              versions={versions}
              setIndex={setIndex}
              onSetIndex={setSetIndex}
              onRemovePreview={removePreview}
              onAddPreview={addPreview}
              onDropFile={dropPreviewFile}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
