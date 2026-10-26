import { useEffect, useRef } from 'react';
import { ChevronRight, Lock } from '@/components/icons';
import { MethodBadge, PathText } from '@/components/MethodBadge';
import { MiddlewareTimeline } from '@/components/MiddlewareTimeline';
import { RequestExample, type ExampleKind } from '@/components/RequestExample';
import { Tip } from '@/components/Tip';
import { lockOf, permissionsOf } from '@/lib/gates';
import { fitSource } from '@/lib/sources';
import { cn } from '@/lib/utils';
import type { Entry, ServerRoute } from '@/types';

/** One endpoint, and under it, when expanded, what runs in front of it and how to call it. */
export function EndpointRow({
  entry,
  label,
  sourceWidth,
  selected,
  onSelect,
  expanded,
  onExpand,
  origin,
  example,
  onExample,
}: {
  entry: Entry;
  label: string;
  sourceWidth: number;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onExpand: () => void;
  origin: string;
  example: ExampleKind;
  onExample: (kind: ExampleKind) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const lock = lockOf(entry);

  // Keyboard navigation moves the selection, so the list has to follow it.
  useEffect(() => {
    if (selected) node.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <>
      <div
        ref={node}
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={cn(
          // A lock, a badge wide enough for any method, the path, the source,
          // and a chevron — the same columns on every tab.
          'grid cursor-pointer grid-cols-[1rem_4.25rem_minmax(0,1fr)_auto_1.5rem] items-center',
          // Clear the sticky header when the keyboard scrolls a row into view.
          'scroll-mt-12 border-l-2 border-transparent py-1.5 pr-3 pl-2.5',
          'hover:bg-accent/50',
          selected && 'border-l-primary bg-accent',
        )}
      >
        {lock ? (
          <Tip content={lock} side="right">
            <span aria-label="Behind an authentication or permission check">
              <Lock className="text-foreground/60 size-3" />
            </span>
          </Tip>
        ) : (
          <span />
        )}
        <MethodBadge method={entry.method} className="w-full" />
        <div className="flex min-w-0 items-baseline gap-2.5 pl-3">
          <PathText path={entry.path} className="min-w-0 truncate" />
          {entry.issue ? (
            <span className="text-method-put shrink-0 font-mono text-[11px]">{entry.issue}</span>
          ) : null}
          <Permissions route={entry} />
        </div>

        {/* The full file and line, which the column may have shortened. */}
        <Tip content={`${entry.source.file}:${entry.source.line}`} side="left" mono>
          <span
            // `ch` resolves against this cell's own monospace font, so it is exact.
            style={{ width: `calc(${sourceWidth}ch + 0.75rem)` }}
            className="text-muted-foreground hidden pl-3 text-right font-mono text-[11px] whitespace-nowrap lg:block"
          >
            {fitSource(entry, label, sourceWidth)}
          </span>
        </Tip>

        <Tip content="Middleware and a request example" side="left">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} the middleware and a request example for ${entry.method} ${entry.path}`}
            // The chevron only folds and unfolds: the side panel stays put.
            onClick={(event) => {
              event.stopPropagation();
              onExpand();
            }}
            // Pinned to the last column, so it stays at the far right on narrow
            // screens too, where the source column is hidden.
            className="text-muted-foreground hover:text-foreground hover:bg-accent col-start-5 -my-1 ml-auto flex size-5 items-center justify-center rounded"
          >
            <ChevronRight className={cn('transition-transform duration-150', expanded && 'rotate-90')} />
          </button>
        </Tip>
      </div>

      {expanded ? (
        // Half what runs in front of it, half how to call it. The timeline
        // lines up with the path above; the panel is marked as the row's own.
        <div
          className={cn(
            'bg-muted/30 grid grid-cols-1 border-l-2 border-transparent md:grid-cols-2',
            selected && 'border-l-primary',
          )}
        >
          <div className="min-w-0 pr-4 pl-[6.375rem]">
            <MiddlewareTimeline route={entry} />
          </div>
          <div className="min-w-0 pr-8 pb-3 pl-[6.375rem] md:pt-3 md:pl-0">
            <RequestExample route={entry} origin={origin} kind={example} onKind={onExample} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The permission checks in front of an endpoint, by name. Whether anyone has to
 * sign in at all is the lock in front of the method badge; the rest of the
 * chain is under the row and in the side panel.
 */
function Permissions({ route }: { route: ServerRoute }) {
  const permissions = permissionsOf(route);
  if (permissions.length === 0) return null;
  const names = permissions.map((permission) => permission.name).join(' · ');
  return (
    <Tip content={names} mono>
      <span className="text-foreground/70 min-w-0 shrink truncate font-mono text-[11px]">{names}</span>
    </Tip>
  );
}
