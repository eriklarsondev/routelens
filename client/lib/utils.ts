/** Join class names, dropping anything falsy. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Chrome for the small icon buttons in the top bar. Shared so they stay a
 * matched pair; it lives here rather than in either component to keep the
 * theme toggle and the top bar from importing each other.
 */
export const CONTROL = cn(
  'inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
  'border-border bg-muted/60 text-muted-foreground transition-colors',
  'hover:bg-accent hover:text-foreground',
  'disabled:pointer-events-none disabled:opacity-60',
);

/** Chrome for text fields: the filter in the top bar and the parameter values. */
export const INPUT = cn(
  'rounded-md border px-2 py-1.5 font-mono text-xs',
  'border-border bg-muted/40 placeholder:text-muted-foreground/50',
  'focus:ring-ring/40 focus:ring-2 focus:outline-none',
);
