export function StatusBar({ text, watching, right }) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-border bg-card/40 px-4 text-xs text-muted-foreground">
      <span data-testid="status-left" className="min-w-0 flex-1 truncate">
        {text}
      </span>
      {watching ? (
        <span data-testid="watch-state" className="flex shrink-0 items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-audio opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-audio" />
          </span>
          Watching
        </span>
      ) : null}
      <span data-testid="status-right" className="min-w-0 flex-1 truncate text-right">
        {right}
      </span>
    </footer>
  );
}

/** Thin progress rail under the toolbar; errors sit in a slim banner instead. */
export function ProgressStrip({ progress, error }) {
  if (error) {
    return (
      <div
        data-testid="progress-error"
        className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-1 text-[11px] text-destructive"
      >
        {error}
      </div>
    );
  }
  if (!progress) return null;
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div data-testid="progress" className="h-0.5 shrink-0 bg-border">
      <div
        className="h-full bg-primary transition-[width] duration-150 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
