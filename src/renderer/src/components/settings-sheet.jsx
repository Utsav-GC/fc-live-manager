import { FolderOpen, FolderPlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function FolderRow({ path, onOpen, onRemove }) {
  return (
    <li
      data-testid="root-row"
      className="flex items-center gap-2 rounded-md border bg-card/40 py-1.5 pr-1.5 pl-2.5"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={path}>
        {path}
      </span>
      {onOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open folder"
              className="size-6 text-muted-foreground"
              onClick={onOpen}
            >
              <FolderOpen className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open folder</TooltipContent>
        </Tooltip>
      ) : null}
      {onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove folder"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
            >
              <X className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from the watch list</TooltipContent>
        </Tooltip>
      ) : null}
    </li>
  );
}

function GroupLabel({ children }) {
  return <h3 className="label-micro">{children}</h3>;
}

export function SettingsSheet({ open, onOpenChange, settings, projects, onAddFolder, onRemoveFolder, onAutoScan, onStartWithWindows }) {
  const withAudio = projects.filter((p) => p.proxy).length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-testid="settings-sheet"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[400px]"
      >
        <SheetHeader className="flex flex-row items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base">Settings</SheetTitle>
            <SheetDescription className="mt-1 text-xs">
              Folders the app watches and how previews are found.
            </SheetDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            data-testid="settings-close"
            aria-label="Close"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-2.5">
            <GroupLabel>Project folders</GroupLabel>
            <ul data-testid="roots" className="space-y-1">
              {settings.scanRoots.map((r) => (
                <FolderRow key={r} path={r} onRemove={() => onRemoveFolder(r)} />
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              data-testid="add-folder"
              className="w-full gap-1.5 text-xs"
              onClick={onAddFolder}
            >
              <FolderPlus className="size-3.5" />
              Add folder…
            </Button>
          </section>

          <Separator />

          <section className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <label
                htmlFor="start-with-windows"
                className="text-sm leading-none font-medium peer-disabled:opacity-70"
              >
                Start with Windows
              </label>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Opens the app automatically when you sign in to Windows. On by default - switch
                it off any time.
              </p>
            </div>
            <Switch
              id="start-with-windows"
              data-testid="start-with-windows"
              checked={settings.startWithWindows !== false}
              onCheckedChange={onStartWithWindows}
            />
          </section>

          <Separator />

          <section className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <label
                htmlFor="auto-scan"
                className="text-sm leading-none font-medium peer-disabled:opacity-70"
              >
                Watch for changes
              </label>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Re-scans the folders whenever files change, and picks new previews up by itself.
              </p>
            </div>
            <Switch
              id="auto-scan"
              data-testid="auto-scan"
              checked={settings.autoScan !== false}
              onCheckedChange={onAutoScan}
            />
          </section>

          <p data-testid="stats" className="text-xs text-muted-foreground">
            {projects.length} projects · {withAudio} with a preview
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
