import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  AudioLines,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Search,
  Settings2,
  Star,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const SORTS = [
  ['name', 'Name'],
  ['bpm', 'Tempo'],
  ['length', 'Length'],
  ['modified', 'Last saved'],
  ['tracks', 'Tracks'],
  ['versions', 'Versions'],
  ['size', 'Size'],
  ['preview', 'Preview status'],
];

/** Plain words for the direction radios, phrased for the active sort key. */
const DIRECTION_LABELS = {
  name: { asc: 'A → Z', desc: 'Z → A' },
  modified: { asc: 'Oldest first', desc: 'Newest first' },
  versions: { asc: 'Fewest first', desc: 'Most first' },
  preview: { asc: 'Needs render first', desc: 'Ready first' },
  nums: { asc: 'Low → high', desc: 'High → low' },
};
const dirLabel = (key, dir) => (DIRECTION_LABELS[key] || DIRECTION_LABELS.nums)[dir];

/**
 * The mark: three bars - a nod to the DAW this library lives in - the middle
 * one ours in amber. Mirrors assets/icon.svg (kept in sync by hand).
 */
function BrandMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="5.4" y="6.2" width="13.2" height="2.6" rx="0.7" className="fill-current" />
      <rect x="5.4" y="10.7" width="13.2" height="2.6" rx="0.7" className="fill-primary" />
      <rect x="5.4" y="15.2" width="13.2" height="2.6" rx="0.7" className="fill-current" />
    </svg>
  );
}

export function TopBar({
  search,
  onSearch,
  sort,
  onSort,
  sortDir,
  onSortDir,
  audioOnly,
  onToggleAudio,
  pinnedOnly,
  onTogglePinned,
  view,
  onToggleView,
  scanning,
  onRescan,
  onOpenSettings,
}) {
  const sortLabel = SORTS.find(([v]) => v === sort)?.[1] || 'Name';
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/40 px-4">
      {/* brand block - the unit's faceplate nameplate */}
      <div className="mr-1 flex shrink-0 items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-md border border-border bg-card text-foreground">
          <BrandMark className="size-4" />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-tight">FC Live Manager</span>
          <span className="label-micro block">2026</span>
        </span>
      </div>

      <div className="relative w-full max-w-lg">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="search"
          data-testid="search-input"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search projects, tempos, tracks…"
          autoComplete="off"
          spellCheck={false}
          className="h-9 rounded-md bg-well pr-9 pl-9 text-sm placeholder:text-muted-foreground/70"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm border border-border bg-card px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
          /
        </kbd>
      </div>

      {/* control cluster - connected controls, hairline dividers, like a
          hardware panel; the whole cluster shares one border */}
      <div className="ml-auto flex shrink-0 items-stretch overflow-hidden rounded-md border border-input">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid="sort-button"
              aria-label="Sort projects"
              className="h-8 gap-1.5 rounded-none border-r border-input text-xs text-muted-foreground hover:text-foreground"
            >
              {sortDir === 'desc' ? (
                <ArrowDownNarrowWide className="size-3.5" />
              ) : (
                <ArrowUpNarrowWide className="size-3.5" />
              )}
              {sortLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuLabel className="label-micro">Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={sort} onValueChange={onSort}>
              {SORTS.map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value} className="text-xs">
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="label-micro">Direction</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortDir} onValueChange={onSortDir}>
              <DropdownMenuRadioItem value="asc" className="text-xs">
                {dirLabel(sort, 'asc')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc" className="text-xs">
                {dirLabel(sort, 'desc')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Toggle
          variant="ghost"
          size="sm"
          pressed={audioOnly}
          onPressedChange={onToggleAudio}
          data-testid="filter-audio"
          aria-label="Only projects with audio"
          className={cn(
            'h-8 gap-1.5 rounded-none text-xs text-muted-foreground hover:text-foreground',
            'data-[state=on]:bg-primary/12 data-[state=on]:text-primary',
          )}
        >
          <AudioLines className="size-3.5" />
          Audio
        </Toggle>

        <Toggle
          variant="ghost"
          size="sm"
          pressed={pinnedOnly}
          onPressedChange={onTogglePinned}
          data-testid="filter-pinned"
          aria-label="Only pinned projects"
          className={cn(
            'h-8 gap-1.5 rounded-none text-xs text-muted-foreground hover:text-foreground',
            'data-[state=on]:bg-primary/12 data-[state=on]:text-primary',
          )}
        >
          <Star className="size-3.5" />
          Pinned
        </Toggle>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleView}
              data-testid="view-toggle"
              aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              className="size-8 rounded-none text-muted-foreground hover:text-foreground"
            >
              {view === 'grid' ? <LayoutList className="size-4" /> : <LayoutGrid className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{view === 'grid' ? 'List view' : 'Grid view'}</TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="sm"
          onClick={onRescan}
          disabled={scanning}
          data-testid="rescan-button"
          aria-label="Rescan library"
          className="h-8 gap-1.5 rounded-none text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />
          Rescan
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenSettings}
              data-testid="settings-button"
              aria-label="Settings"
              className="size-8 rounded-none border-l border-input text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
