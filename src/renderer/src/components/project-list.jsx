import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Pause,
  Play,
  RotateCw,
  Star,
} from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fmtBytes, fmtDate, fmtLength, fmtWhen } from '@/lib/format';
import { whereIsPreview, whyPreview } from '@/lib/provenance';
import { cn } from '@/lib/utils';

/** Sortable header cell - click sorts, clicking the active one flips direction. */
function SortHeader({ col, label, hint, sort, sortDir, onSortColumn, className }) {
  const active = sort === col;
  const button = (
    <button
      type="button"
      onClick={() => onSortColumn(col)}
      className={cn(
        'label-micro inline-flex items-center gap-1 rounded-sm',
        active && 'text-primary',
      )}
    >
      {label}
      {active ? (
        sortDir === 'asc' ? (
          <ArrowUpNarrowWide className="size-3" />
        ) : (
          <ArrowDownNarrowWide className="size-3" />
        )
      ) : null}
    </button>
  );
  return (
    <TableHead className={cn('h-9 border-b border-border px-2', className)}>
      {hint ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </TableHead>
  );
}

/** A tiny icon with a plain-words explanation, inline after the name. */
function Flag({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-grid shrink-0 cursor-default place-items-center">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 leading-relaxed">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function PinButton({ pinned, onToggle }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="pin-toggle"
          data-pinned={pinned ? 'true' : undefined}
          aria-label={pinned ? 'Unpin project' : 'Pin project'}
          aria-pressed={pinned}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'grid size-6 place-items-center rounded-sm transition-colors outline-none',
            'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            pinned
              ? 'text-primary'
              : 'text-muted-foreground/50 opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100',
          )}
        >
          <Star className={cn('size-3.5', pinned && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{pinned ? 'Unpin' : 'Pin'}</TooltipContent>
    </Tooltip>
  );
}

/** Play/pause (or the error chip) - the row's audio affordance. */
function AudioCell({ p, playing, onTogglePlay }) {
  if (p.error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="row-badge-err"
            className="grid size-6 cursor-default place-items-center rounded-full border border-destructive/40 bg-destructive/15 text-[11px] font-semibold text-destructive"
          >
            !
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64 leading-relaxed">
          {p.error}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (!p.proxy) return null;
  const label = p.proxy.nameMatched
    ? `Preview: ${p.proxy.audioName} - found ${whereIsPreview(p.proxy)}, ${whyPreview(p.proxy)}`
    : `Audio found ${whereIsPreview(p.proxy)}: ${p.proxy.audioName} - its name doesn't match the set, so it may be a partial edit or a different song`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="row-play"
          data-loose={!p.proxy.nameMatched ? 'true' : undefined}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePlay(p);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'grid size-6 place-items-center rounded-full transition-colors outline-none',
            'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            playing
              ? 'text-primary'
              : p.proxy.nameMatched
                ? 'text-audio hover:bg-audio/15'
                : 'text-primary hover:bg-primary/15',
          )}
        >
          {playing ? (
            <Pause className="size-3" fill="currentColor" />
          ) : (
            <Play className="size-3 translate-x-px" fill="currentColor" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64 leading-relaxed">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProjectList({
  projects,
  justRendered,
  selectedKey,
  pinnedSet,
  playingKey,
  sort,
  sortDir,
  onSortColumn,
  onOpen,
  onTogglePlay,
  onTogglePin,
}) {
  const onRowKeyDown = (e, p) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(p.key);
    } else if (e.key === ' ') {
      e.preventDefault();
      onTogglePlay(p);
    }
  };

  return (
    <div data-testid="project-list" className="px-4 pt-2 pb-4">
      <Table className="table-fixed">
        <colgroup>
          <col className="w-8" />
          <col className="w-10" />
          <col />
          <col className="w-14" />
          <col className="w-16" />
          <col className="w-12" />
          <col className="w-12" />
          <col className="w-24" />
          <col className="w-16" />
        </colgroup>
        <TableHeader data-testid="list-head" className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 border-b border-border px-2" />
            <TableHead className="h-9 border-b border-border px-2" />
            <SortHeader col="name" label="Name" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} />
            <SortHeader col="bpm" label="BPM" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} className="text-right" />
            <SortHeader col="length" label="Length" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} className="text-right" />
            <SortHeader col="tracks" label="Trk" hint="Tracks" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} className="text-right" />
            <SortHeader col="versions" label="Ver" hint="Saved versions in Backup/" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} className="text-right" />
            <SortHeader col="modified" label="Saved" hint="Last saved" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} className="text-right" />
            <SortHeader col="size" label="Size" sort={sort} sortDir={sortDir} onSortColumn={onSortColumn} className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => {
            const playing = playingKey === p.key;
            return (
              <TableRow
                key={p.key}
                data-testid="project-row"
                data-key={p.key}
                tabIndex={0}
                onClick={() => onOpen(p.key)}
                onKeyDown={(e) => onRowKeyDown(e, p)}
                className={cn(
                  'group/row h-9 cursor-pointer outline-none select-none',
                  'focus-visible:bg-accent/40 focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                  p.key === selectedKey && 'bg-accent/40',
                  justRendered.has(p.key) && 'bg-audio/10',
                  playing && 'bg-primary/5',
                )}
              >
                <TableCell className="px-1.5 py-0">
                  <PinButton pinned={pinnedSet.has(p.key)} onToggle={() => onTogglePin(p.key)} />
                </TableCell>
                <TableCell className="px-1.5 py-0">
                  <AudioCell p={p} playing={playing} onTogglePlay={onTogglePlay} />
                </TableCell>
                <TableCell className="min-w-0 overflow-hidden py-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13px] font-medium" title={p.name}>
                      {p.name}
                    </span>
                    {p.setCount > 1 ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground/70">
                        · {p.setCount} sets
                      </span>
                    ) : null}
                    {p.proxy && p.proxy.stale ? (
                      <Flag label="This preview is from an older save - the project was saved after the audio was made. Drop a fresh bounce on the card (or use Add audio) to update it.">
                        <RotateCw className="size-3 text-primary" />
                      </Flag>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] text-primary tabular-nums">
                  {p.bpm != null ? p.bpm : '--'}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                  {fmtLength(p.lengthSeconds)}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                  {p.trackCount ?? '--'}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                  {p.backups ? p.backups.count : '--'}
                </TableCell>
                <TableCell className="py-1.5 text-right text-[12px] text-muted-foreground">
                  <span title={fmtDate(p.mtimeMs)}>{fmtWhen(p.mtimeMs)}</span>
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                  {fmtBytes(p.fileSizeBytes)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
