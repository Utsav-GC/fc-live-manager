import { Toaster as Sonner } from 'sonner';

export function Toaster(props) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      toastOptions={{ classNames: { toast: 'font-sans' } }}
      style={{
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--success-bg': 'var(--popover)',
        '--success-text': 'var(--popover-foreground)',
        '--success-border': 'var(--border)',
        '--error-bg': 'var(--popover)',
        '--error-text': 'var(--popover-foreground)',
        '--error-border': 'var(--destructive)',
      }}
      {...props}
    />
  );
}
