import { methodColor } from '@/components/MethodBadge';
import { cn } from '@/lib/utils';
import type { Method } from '@/types';

/**
 * A method filter. Every method starts on; switching one off hides its rows,
 * so the tabs double as a legend of what the topic contains.
 */
export function MethodTab({
  method,
  count,
  on,
  cursor,
  onClick,
}: {
  method: Method;
  count: number;
  on: boolean;
  cursor: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={on}
      aria-label={`${method} (${count})`}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 font-mono text-[11px] leading-none font-semibold tracking-wide',
        'transition-colors',
        on
          ? cn('border-current/40 bg-current/12', methodColor(method))
          : 'border-border/70 text-muted-foreground/60 hover:text-foreground border-dashed line-through',
        cursor && 'ring-ring/70 ring-2',
      )}
    >
      {method}
      <span className="ml-1.5 font-normal opacity-70">{count}</span>
    </button>
  );
}
