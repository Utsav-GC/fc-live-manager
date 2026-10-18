import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCw, Star } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { drawThumb } from '@/lib/draw';
import { fmtLength, ts } from '@/lib/format';
import { whereIsPreview, whyPreview } from '@/lib/provenance';
import { cn } from '@/lib/utils';

/** Canvas thumbnail of the arrangement; redraws itself when the card resizes. */
function ThumbCanvas({ thumb, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const draw = () => drawThumb(c, thumb);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [thumb]);
  return <canvas ref={ref} className={className} />;
}

/** A small square state chip floating on the minimap, with a plain-words tooltip. */
function StateBadge({ testid, label, className, loose, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={testid}
          data-loose={loose ? 'true' : undefined}
          className={cn(
            'absolute z-10 grid size-5 cursor-default place-items-center rounded-sm border shadow-sm backdrop-blur-sm',
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 leading-relaxed">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProjectCard({
  p,
  selected,
  flashed,
  pinned,
  playing,
  onOpen,
  onTogglePlay,
  onTogglePin,
  onDropFile,
}) {
  const [dragOver, setDragOver] = useState(false);
  const subtitle = p.setCount > 1 ? `${p.setName} · ${p.setCount} sets` : p.setName;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  return (
    <Card
      data-testid="project-card"
      data-key={p.key}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(p.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen(p.key);
        } else if (e.key === ' ') {
          e.preventDefault();
          if (p.proxy) onTogglePlay(p);
        }
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) onDropFile(p, file);
      }}
      className={cn(
        'group relative cursor-pointer gap-2 overflow-hidden rounded-lg border bg-card p-3 py-3 shadow-none outline-none select-none',
        'transition-[border-color,background-color,box-shadow] duration-150',
        'hover:border-foreground/15 hover:bg-accent/25',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        selected && 'border-primary/60 ring-1 ring-primary/40',
        flashed && 'just-rendered',
        dragOver && 'border-primary/70 ring-1 ring-primary/50',
      )}
    >
      {/* Premium sheen - the light band rests caught at the card's far corner;
          hovering replays the full sweep, which settles right back there. */}
      <div
        aria-hidden="true"
        className={cn(
          'card-sheen',
          flashed
            ? 'animate-[card-sheen_1100ms_cubic-bezier(0.22,1,0.36,1)_forwards]'
            : 'group-hover:animate-[card-sheen_900ms_cubic-bezier(0.22,1,0.36,1)_forwards]',
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 data-testid="card-title" title={p.name} className="truncate text-[13px] leading-tight font-medium">
            {p.name}
          </h3>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        {/* tempo window - the card's little LCD */}
        <div data-testid="card-bpm" className="flex shrink-0 flex-col items-end border-l border-border/70 pl-2.5">
          <span className="font-mono text-[15px] leading-none font-semibold text-primary tabular-nums">
            {p.bpm != null ? p.bpm : '--'}
          </span>
          <span className="label-micro mt-1 pr-px">bpm</span>
        </div>
      </div>

      {/* the arrangement minimap - this card's screen */}
      <div className="well relative h-16 overflow-hidden rounded-md border border-border/50">
        <ThumbCanvas thumb={p.thumb} className="h-full w-full" />
        {!p.thumb ? (
          <div className="well-scanlines absolute inset-0 grid place-items-center">
            <span className="label-micro">no arrangement</span>
          </div>
        ) : null}

        {p.proxy ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="card-toggle-play"
                aria-label={playing ? 'Pause preview' : 'Play preview'}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePlay(p);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className={cn(
                  'absolute top-1/2 left-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-black/60 text-foreground shadow-sm backdrop-blur-sm outline-none transition-opacity duration-150',
                  'focus-visible:opacity-100 focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                  playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                {playing ? (
                  <Pause className="size-3.5" fill="currentColor" />
                ) : (
                  <Play className="size-3.5 translate-x-px" fill="currentColor" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {playing ? 'Pause' : 'Play preview'} <span className="text-muted-foreground">(Space)</span>
            </TooltipContent>
          </Tooltip>
        ) : null}

        {p.error ? (
          <StateBadge
            testid="card-badge-err"
            label={p.error}
            className="top-1.5 right-1.5 border-destructive/40 bg-destructive/15 text-destructive"
          >
            <span className="text-[11px] leading-none font-semibold">!</span>
          </StateBadge>
        ) : p.proxy ? (
          <StateBadge
            testid="card-badge-play"
            loose={!p.proxy.nameMatched}
            label={
              p.proxy.nameMatched
                ? `Preview: ${p.proxy.audioName} - found ${whereIsPreview(p.proxy)}, ${whyPreview(p.proxy)}`
                : `Audio found ${whereIsPreview(p.proxy)}: ${p.proxy.audioName} - its name doesn't match the set, so it may be a partial edit or a different song`
            }
            className={cn(
              'top-1.5 right-1.5',
              p.proxy.nameMatched
                ? 'border-audio/40 bg-audio/15 text-audio'
                : 'border-primary/40 bg-primary/15 text-primary',
            )}
          >
            <Play className="size-2.5 translate-x-px" fill="currentColor" />
          </StateBadge>
        ) : null}

        {p.proxy && p.proxy.stale ? (
          <StateBadge
            testid="card-badge-stale"
            label="This preview is from an older save - the project was saved after the audio was made. Drop a fresh bounce on the card (or use Add audio) to update it."
            className="top-1.5 left-1.5 border-primary/40 bg-primary/15 text-primary"
          >
            <RotateCw className="size-3" />
          </StateBadge>
        ) : null}

        {flashed ? (
          <StateBadge
            testid="card-badge-done"
            label="A fresh preview just landed for this project."
            className="top-1.5 right-8 border-audio/40 bg-audio/15 text-audio"
          >
            <Check className="size-3" />
          </StateBadge>
        ) : null}

        {dragOver ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-background/85 text-[10px] font-medium text-primary">
            Drop to set preview
          </div>
        ) : null}
      </div>

      {/* data strip - readouts, not labels */}
      <div
        data-testid="card-meta"
        className="flex items-center gap-x-2.5 font-mono text-[11px] text-muted-foreground tabular-nums"
      >
        <span title="last saved">{ts(p)}</span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
        <span title="song length">{fmtLength(p.lengthSeconds)}</span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
        <span title="tracks">
          {p.trackCount ?? '--'} <span className="text-muted-foreground/60">trk</span>
        </span>
        <span title="saved versions in Backup/">
          {p.backups.count} <span className="text-muted-foreground/60">ver</span>
        </span>
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
                onTogglePin(p.key);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                'ml-auto -mr-0.5 grid size-5 shrink-0 place-items-center rounded-sm font-sans outline-none transition-opacity',
                'focus-visible:opacity-100 focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                pinned ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100',
              )}
            >
              <Star className={cn('size-3.5', pinned && 'fill-current')} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{pinned ? 'Unpin' : 'Pin'}</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}
