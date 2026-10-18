import { AudioLines, FolderPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectCard } from '@/components/project-card';

const GRID_CLS = 'grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-3.5 p-4';

export function ProjectGrid({
  projects,
  justRendered,
  selectedKey,
  pinnedSet,
  playingKey,
  onOpen,
  onTogglePlay,
  onTogglePin,
  onDropFile,
}) {
  return (
    <div data-testid="project-grid" className={GRID_CLS}>
      {projects.map((p) => (
        <ProjectCard
          key={p.key}
          p={p}
          selected={p.key === selectedKey}
          flashed={justRendered.has(p.key)}
          pinned={pinnedSet.has(p.key)}
          playing={playingKey === p.key}
          onOpen={onOpen}
          onTogglePlay={onTogglePlay}
          onTogglePin={onTogglePin}
          onDropFile={onDropFile}
        />
      ))}
    </div>
  );
}

/** First-load shimmer - same footprint as real cards so the grid doesn't jump. */
export function GridSkeleton() {
  return (
    <div data-testid="grid-skeleton" className={GRID_CLS} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-7 w-9" />
          </div>
          <Skeleton className="well h-16 w-full rounded-md" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ onAddFolder }) {
  return (
    <div data-testid="empty-state" className="grid h-full place-items-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center rounded-lg border border-dashed border-border px-8 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-md border border-border bg-card">
          <AudioLines className="size-5 text-muted-foreground" />
        </span>
        <h2 className="mt-4 text-sm font-medium">No Ableton projects found yet</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Add a folder where your .als projects live - the app keeps watching it and fills this
          list in as it finds them.
        </p>
        <Button className="mt-5 gap-1.5" size="sm" onClick={onAddFolder}>
          <FolderPlus className="size-3.5" />
          Add folder…
        </Button>
      </div>
    </div>
  );
}
