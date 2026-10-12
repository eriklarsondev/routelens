import { useEffect, useRef } from 'react';
import { ChevronRight } from '@/components/icons';
import { MethodBadge, methodColor, PathText } from '@/components/MethodBadge';
import { callerCount, sourceLabels } from '@/lib';
import { cn } from '@/lib/utils';
import type { DashboardData, Entry, Group, Method } from '@/types';
import { isRoute } from '@/types';

interface EndpointListProps {
  data: DashboardData | null;
  groups: Group[];
  empty: boolean;
  selectedId: string | null;
  query: string;
  loading: boolean;
  onSelect: (entry: Entry) => void;
  onToggle: (label: string) => void;
  onMethod: (label: string, method: Method) => void;
}

export function EndpointList({
  data,
  groups,
  empty,
  selectedId,
  query,
  loading,
  onSelect,
  onToggle,
  onMethod,
}: EndpointListProps) {
  return (
    <div className="space-y-2.5 p-4">
      <BaseCard data={data} />

      {loading ? (
        <p className="text-muted-foreground p-8 text-center text-sm">Scanning…</p>
      ) : empty ? (
        <p className="text-muted-foreground p-8 text-center text-sm">
          {query ? (
            <>
              Nothing matches <span className="text-foreground font-mono">{query}</span>
            </>
          ) : (
            'Nothing found here.'
          )}
        </p>
      ) : (
        <div role="listbox" aria-label="Endpoints" className="space-y-2.5">
          {groups.map((group) => (
            <Card
              key={group.label}
              group={group}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              onMethod={onMethod}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Where every path below actually lives. It sits above the endpoints because it
 * applies to all of them: a route reads as `/api/status`, but the URL you can
 * open is the base joined to it.
 */
function BaseCard({ data }: { data: DashboardData | null }) {
  if (!data) return null;

  const mounted = data.mode === 'mounted';
  const base = mounted ? window.location.origin : (data.target ?? window.location.origin);

  return (
    <section className="bg-card rounded-lg border px-3 py-2.5 shadow-xs">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          Base
        </h2>
        <p className="min-w-0 flex-1 truncate font-mono text-[13px]" title={base}>
          {base}
        </p>
        {!mounted && data.targetLive !== null ? (
          <span
            className={cn(
              'shrink-0 font-mono text-[10px]',
              data.targetLive ? 'text-method-get' : 'text-muted-foreground',
            )}
          >
            {data.targetLive ? 'live' : 'not answering'}
          </span>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-0.5 text-[11px]">
        {mounted
          ? 'Mounted on your app, so endpoint links are same-origin.'
          : data.targetReason === '--target'
            ? 'Set with --target. Every path below is relative to it.'
            : data.targetReason
              ? `From ${data.targetReason}. Every path below is relative to it.`
              : 'Every path below is relative to it.'}
      </p>
    </section>
  );
}

function Card({
  group,
  selectedId,
  onSelect,
  onToggle,
  onMethod,
}: {
  group: Group;
  selectedId: string | null;
  onSelect: (entry: Entry) => void;
  onToggle: (label: string) => void;
  onMethod: (label: string, method: Method) => void;
}) {
  const labels = sourceLabels(group.visible);

  // With one method there is nothing to choose between, so the tabs are noise —
  // and a collapsed card has nothing to filter. Both fall back to the total.
  const showTabs = group.open && group.methods.length > 1;

  return (
    // No `overflow-hidden` here: it would trap the sticky header. The row list
    // below does the clipping instead.
    <section className="bg-card rounded-lg border shadow-xs">
      <div className="bg-card sticky top-0 z-10 flex items-center gap-3 rounded-t-lg px-3 py-2">
        <button
          onClick={() => onToggle(group.label)}
          aria-expanded={group.open}
          className="hover:bg-accent/40 -mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left"
        >
          <ChevronRight
            className={cn(
              'text-muted-foreground transition-transform duration-150',
              group.open && 'rotate-90',
            )}
          />
          <h2 className="truncate font-mono text-[15px] font-medium tracking-tight">
            {group.label}
          </h2>
        </button>

        {showTabs ? (
          <div
            role="group"
            aria-label={`${group.label} methods`}
            className="flex flex-wrap justify-end gap-1"
          >
            {group.methods.map((method, index) => (
              <MethodTab
                key={method}
                method={method}
                count={group.entries.filter((entry) => entry.method === method).length}
                on={!group.hidden.includes(method)}
                cursor={group.cursor === index}
                onClick={() => onMethod(group.label, method)}
              />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
            {group.entries.length}
          </span>
        )}
      </div>

      {group.open && group.visible.length === 0 ? (
        <p className="text-muted-foreground border-t px-3 py-2 text-xs">
          Every method is switched off here.
        </p>
      ) : null}

      {group.open ? (
        <div
          role="group"
          aria-label={group.label}
          className="overflow-hidden rounded-b-lg border-t empty:border-0"
        >
          {group.visible.map((entry) => (
            <Row
              key={entry.id}
              entry={entry}
              label={labels.get(entry.id) ?? ''}
              selected={entry.id === selectedId}
              onSelect={() => onSelect(entry)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A method filter. Every method starts on; switching one off hides its rows,
 * so the tabs double as a legend of what the topic contains.
 */
function MethodTab({
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

function Row({
  entry,
  label,
  selected,
  onSelect,
}: {
  entry: Entry;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const callers = callerCount(entry);

  // Keyboard navigation moves the selection, so the list has to follow it.
  useEffect(() => {
    if (selected) node.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // One muted trailing column: where the row came from, and how it calls out.
  const origin = [!isRoute(entry) ? entry.library : null, label].filter(Boolean).join(' · ');

  return (
    <div
      ref={node}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      title={`${entry.source.file}:${entry.source.line}`}
      className={cn(
        'grid cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3',
        // Clear the sticky header when the keyboard scrolls a row into view.
        'scroll-mt-12 border-l-2 border-transparent py-1.5 pr-3 pl-2.5',
        'hover:bg-accent/50',
        selected && 'border-l-primary bg-accent',
      )}
    >
      <MethodBadge method={entry.method} className="w-full" />
      <PathText
        path={entry.path}
        host={!isRoute(entry) ? entry.host : undefined}
        className="truncate"
      />

      <div className="text-muted-foreground flex items-center gap-3 font-mono text-[11px] whitespace-nowrap">
        {entry.issue ? <span className="text-method-put">{entry.issue}</span> : null}
        {callers ? <span>{callers === 1 ? '1 caller' : `${callers} callers`}</span> : null}
        <span className="hidden lg:inline">{origin}</span>
      </div>
    </div>
  );
}
