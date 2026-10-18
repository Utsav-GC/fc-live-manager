import { useMemo } from 'react';
import { AudioLines, FolderOpen, FolderPlus, RefreshCw } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { byName } from '@/lib/browse';

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  onSelectProject,
  onRescan,
  onOpenCaptures,
  onAddFolder,
}) {
  const sorted = useMemo(() => [...projects].sort(byName), [projects]);

  const run = (fn) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="FC Live Manager 2026"
      description="Search projects and run quick actions"
      className="sm:max-w-lg"
      showCloseButton={false}
    >
      <CommandInput
        data-testid="command-input"
        placeholder="Search projects, tempos, tracks…"
      />
      <CommandList data-testid="command-list">
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Projects">
          {sorted.map((p) => (
            <CommandItem
              key={p.key}
              value={`${p.name} ${p.setNames.join(' ')} ${p.trackNames.join(' ')} ${p.bpm ?? ''}`}
              onSelect={() => {
                onOpenChange(false);
                onSelectProject(p.key);
              }}
            >
              <AudioLines className="size-4 text-muted-foreground" />
              <span className="truncate">{p.name}</span>
              {p.proxy ? (
                <span className="ml-1.5 size-1.5 shrink-0 rounded-full bg-audio" aria-hidden="true" />
              ) : null}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {p.bpm ?? '--'}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="rescan library" onSelect={run(onRescan)}>
            <RefreshCw />
            Rescan library
          </CommandItem>
          <CommandItem value="open setlist captures folder" onSelect={run(onOpenCaptures)}>
            <FolderOpen />
            Open Setlist Captures
          </CommandItem>
          <CommandItem value="add folder" onSelect={run(onAddFolder)}>
            <FolderPlus />
            Add folder…
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
