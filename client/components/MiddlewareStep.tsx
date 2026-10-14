import { openInEditor } from '@/api';
import { Lock, Shield } from '@/components/icons';
import { Tip } from '@/components/ui/tooltip';
import { shortSource } from '@/lib';
import { cn } from '@/lib/utils';
import type { MiddlewareRef } from '@/types';

const KIND_COLOR: Record<MiddlewareRef['kind'], string> = {
  auth: 'text-foreground',
  permission: 'text-foreground',
  limit: 'text-method-put',
  validation: 'text-method-post',
  other: 'text-muted-foreground',
};

/**
 * One step in front of the handler: where it is attached, what it is, and the
 * line that attaches it — which for app-wide middleware is not in the route's
 * file at all. Shown in the side panel and under an expanded row.
 */
export function MiddlewareStep({ item, sourceLength = 24 }: { item: MiddlewareRef; sourceLength?: number }) {
  return (
    <Tip content={`${item.kind} · ${item.source.file}:${item.source.line}`} side="left" mono>
      <button
        type="button"
        onClick={() => void openInEditor(item.source.file, item.source.line)}
        className="hover:bg-accent flex w-full items-center gap-2 rounded px-1 py-1 text-left"
      >
        <span className="text-muted-foreground/70 w-12 shrink-0 font-mono text-[9px] tracking-wide uppercase">
          {item.scope}
        </span>
        {item.kind === 'auth' ? (
          <Lock className="text-foreground/70 size-3" />
        ) : item.kind === 'permission' ? (
          <Shield className="text-foreground/70 size-3" />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {/* The name comes first; the source gives way when space runs short. */}
        <span className={cn('max-w-[66%] shrink-0 truncate font-mono text-[11px]', KIND_COLOR[item.kind])}>
          {item.name}
          {item.definition ? <span className="text-muted-foreground"> = {item.definition}</span> : null}
        </span>
        <span className="text-muted-foreground ml-auto min-w-0 truncate font-mono text-[10px]">
          {shortSource(item.source.file, item.source.line, sourceLength)}
        </span>
      </button>
    </Tip>
  );
}
