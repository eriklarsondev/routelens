import { cn } from '@/lib/utils';
import type { Method } from '@/types';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-put',
  DELETE: 'text-method-delete',
  WS: 'text-method-realtime',
  SSE: 'text-method-realtime',
};

/** The text colour a method is drawn in, wherever it appears. */
export function methodColor(method: string): string {
  return METHOD_COLOR[method] ?? 'text-method-other';
}

export function MethodBadge({
  method,
  className,
}: {
  method: Method;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5',
        'font-mono text-[10px] leading-none font-semibold tracking-wide',
        'border-current/25 bg-current/8',
        methodColor(method),
        className,
      )}
    >
      {method}
    </span>
  );
}

/** Paths read far better when the dynamic segments are picked out. */
export function PathText({
  path,
  host,
  className,
}: {
  path: string;
  host?: string;
  className?: string;
}) {
  // How it overflows is the caller's call: a list row clips to one line, the
  // detail heading wraps. Baking in `truncate` here fought both.
  return (
    <span className={cn('font-mono text-[13px]', className)}>
      {host ? <span className="text-muted-foreground">{host}</span> : null}
      {path.split('/').map((segment, index) => (
        <span key={index}>
          {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
          <span
            className={
              segment.startsWith(':') || segment.includes('*') ? 'text-param' : undefined
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </span>
  );
}
