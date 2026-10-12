import { useEffect, useRef } from 'react';
import { SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MethodBadge, PathText } from '@/components/MethodBadge';
import { callerCount, groupEntries, shortSource } from '@/lib';
import { cn } from '@/lib/utils';
import type { ClientCall, Entry } from '@/types';
import { isRoute } from '@/types';

interface EndpointListProps {
  entries: Entry[];
  selectedId: string | null;
  query: string;
  loading: boolean;
  onSelect: (entry: Entry) => void;
}

export function EndpointList({
  entries,
  selectedId,
  query,
  loading,
  onSelect,
}: EndpointListProps) {
  if (loading) return <LoadingRows />;

  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12 text-center">
        <SearchX className="size-6 opacity-60" />
        <p className="text-sm">
          {query ? (
            <>
              Nothing matches <span className="text-foreground font-mono">{query}</span>
            </>
          ) : (
            'Nothing found here.'
          )}
        </p>
      </div>
    );
  }

  return (
    <div role="listbox" aria-label="Endpoints" className="pb-10">
      {groupEntries(entries).map((group) => (
        <section key={`${group.label}:${group.entries[0]!.id}`}>
          <h2 className="bg-background/85 text-muted-foreground sticky top-0 z-10 px-4 pt-3.5 pb-1.5 font-mono text-[11px] backdrop-blur">
            {group.label}
          </h2>
          {group.entries.map((entry) => (
            <Row
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedId}
              onSelect={() => onSelect(entry)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function Row({
  entry,
  selected,
  onSelect,
}: {
  entry: Entry;
  selected: boolean;
  onSelect: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const callers = callerCount(entry);

  // Keyboard navigation moves the selection, so the list has to follow it.
  useEffect(() => {
    if (selected) node.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      ref={node}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'group grid cursor-pointer grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-3',
        'scroll-mt-16 border-l-2 border-transparent px-4 py-1.5 transition-colors',
        'hover:bg-accent/60',
        selected && 'border-l-primary bg-accent',
      )}
    >
      <MethodBadge method={entry.method} className="w-full" />
      <PathText path={entry.path} host={!isRoute(entry) ? entry.host : undefined} />

      <div className="flex items-center gap-2 whitespace-nowrap">
        {entry.issue ? (
          <Badge
            variant="outline"
            className="text-method-put border-method-put/35 bg-method-put/10"
          >
            {entry.issue}
          </Badge>
        ) : null}

        {callers !== null ? (
          <Badge
            variant="outline"
            className={cn(
              'font-mono',
              callers > 0
                ? 'text-method-get border-method-get/30 bg-method-get/10'
                : 'text-muted-foreground',
            )}
          >
            {callers} {callers === 1 ? 'caller' : 'callers'}
          </Badge>
        ) : null}

        {isRoute(entry) ? (
          entry.framework !== 'unknown' ? (
            <Badge variant="secondary" className="text-muted-foreground font-mono">
              {entry.framework}
            </Badge>
          ) : null
        ) : (
          <>
            <MatchBadge call={entry} />
            <Badge variant="secondary" className="text-muted-foreground font-mono">
              {entry.library}
            </Badge>
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground hidden font-mono text-[11px] lg:inline">
              {shortSource(entry.source.file, entry.source.line)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono">
            {entry.source.file}:{entry.source.line}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * Whether a client call reaches a route in this repo. Calls to other hosts,
 * runtime-assembled URLs and bare constants cannot be judged, so they say
 * nothing rather than raising a false alarm.
 */
function MatchBadge({ call }: { call: ClientCall }) {
  if (call.routeId) {
    return (
      <Badge variant="outline" className="text-method-get border-method-get/30 bg-method-get/10">
        matched
      </Badge>
    );
  }
  if (call.host || call.dynamic || call.library === 'literal') return null;
  return (
    <Badge variant="outline" className="text-method-put border-method-put/35 bg-method-put/10">
      no route
    </Badge>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-1 p-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-1.5">
          <Skeleton className="h-5 w-14 rounded-sm" />
          <Skeleton className="h-4" style={{ width: `${30 + ((index * 17) % 45)}%` }} />
        </div>
      ))}
    </div>
  );
}
