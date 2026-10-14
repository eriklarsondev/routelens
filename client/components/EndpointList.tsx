import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Lock } from '@/components/icons';
import { MethodBadge, methodColor, PathText } from '@/components/MethodBadge';
import { MiddlewareTimeline } from '@/components/MiddlewareTimeline';
import { RequestExample, type ExampleKind } from '@/components/RequestExample';
import { Tip } from '@/components/ui/tooltip';
import {
  appOf,
  fitSource,
  isExpandable,
  lockOf,
  originFor,
  permissionsOf,
  sourceColumnWidth,
  sourceLabels,
} from '@/lib';
import { cn } from '@/lib/utils';
import type { ClientApp, DashboardData, Entry, Group, Method, ServerRoute, TabKey } from '@/types';
import { isCall, isPage, isRoute } from '@/types';

interface EndpointListProps {
  data: DashboardData | null;
  tab: TabKey;
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
  tab,
  groups,
  empty,
  selectedId,
  query,
  loading,
  onSelect,
  onToggle,
  onMethod,
}: EndpointListProps) {
  const sourceWidth = useMemo(() => sourceColumnWidth(data), [data]);
  // The one row whose middleware is showing. Kept by id, so filtering or
  // switching tabs and back does not fold it up again.
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((previous) => (previous === id ? null : id));
  }, []);

  // Which request example the expanded rows show, kept for the next visit.
  const [example, setExample] = useState<ExampleKind>(storedExample);
  const chooseExample = useCallback((kind: ExampleKind) => {
    setExample(kind);
    try {
      localStorage.setItem(EXAMPLE_KEY, kind);
    } catch {
      // Private browsing: the choice lasts as long as the page does.
    }
  }, []);
  const originOf = useCallback((entry: Entry) => originFor(entry, data), [data]);

  // Clicking a row opens it in the side panel and opens it in place, and
  // clicking it again folds it back up. The side panel stays on it either way.
  const choose = useCallback(
    (entry: Entry) => {
      onSelect(entry);
      if (isExpandable(entry)) toggleExpanded(entry.id);
      else setExpanded(null);
    },
    [onSelect, toggleExpanded],
  );

  return (
    <div className="space-y-2.5 p-4">
      <BaseCard data={data} pages={tab === 'client'} />

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
              app={pageApp(data, group)}
              sourceWidth={sourceWidth}
              selectedId={selectedId}
              onSelect={choose}
              onToggle={onToggle}
              onMethod={onMethod}
              expanded={expanded}
              onExpand={toggleExpanded}
              originOf={originOf}
              example={example}
              onExample={chooseExample}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const EXAMPLE_KEY = 'routelens:example';

function storedExample(): ExampleKind {
  try {
    return localStorage.getItem(EXAMPLE_KEY) === 'curl' ? 'curl' : 'fetch';
  } catch {
    return 'fetch';
  }
}

/** The app a card of pages belongs to; null for a card of endpoints or calls. */
function pageApp(data: DashboardData | null, group: Group): ClientApp | null {
  const first = group.entries[0];
  return first && isPage(first) ? appOf(data, first.app) : null;
}

/**
 * Where every path below actually lives. It sits above the endpoints because it
 * applies to all of them: a route reads as `/api/status`, but the URL you can
 * open is the base joined to it. Pages are the exception — each app has its own
 * base, so the card names only the origin and leaves the rest to the app cards.
 */
function BaseCard({ data, pages }: { data: DashboardData | null; pages: boolean }) {
  if (!data) return null;

  const mounted = data.mode === 'mounted';
  const target = mounted ? window.location.origin : (data.target ?? window.location.origin);
  const base = pages ? new URL(target).origin : target;

  if (pages) {
    return (
      <section className="bg-card rounded-lg border px-3 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            Origin
          </h2>
          <Tip content={base} align="start" mono>
            <p className="min-w-0 flex-1 truncate font-mono text-[13px]">{base}</p>
          </Tip>
        </div>
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          Each app below is served under its own base path, shown on its card.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-lg border px-3 py-2.5 shadow-xs">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          Base
        </h2>
        <Tip content={base} align="start" mono>
          <p className="min-w-0 flex-1 truncate font-mono text-[13px]">{base}</p>
        </Tip>
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

function Card({
  group,
  sourceWidth,
  selectedId,
  onSelect,
  onToggle,
  onMethod,
  app,
  expanded,
  onExpand,
  originOf,
  example,
  onExample,
}: {
  group: Group;
  sourceWidth: number;
  selectedId: string | null;
  onSelect: (entry: Entry) => void;
  onToggle: (label: string) => void;
  onMethod: (label: string, method: Method) => void;
  app: ClientApp | null;
  expanded: string | null;
  onExpand: (id: string) => void;
  originOf: (entry: Entry) => string;
  example: ExampleKind;
  onExample: (kind: ExampleKind) => void;
}) {
  const labels = sourceLabels(group.visible);
  // An app at the scan root has no directory to go by, so it goes by its name.
  const title = app && app.root === '.' ? (app.name ?? '/') : group.label;

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
          <h2 className="truncate font-mono text-[15px] font-medium tracking-tight">{title}</h2>
          {app ? (
            // The base every page in this card sits under, and where it was read.
            <Tip content={app.base ? (app.baseSource ?? 'default') : 'Could not work out the base path'}>
              <span className="text-muted-foreground shrink-0 truncate font-mono text-[11px]">
                {app.base ?? 'base unknown'}
              </span>
            </Tip>
          ) : null}
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
              sourceWidth={sourceWidth}
              selected={entry.id === selectedId}
              onSelect={() => onSelect(entry)}
              expanded={expanded === entry.id}
              onExpand={() => onExpand(entry.id)}
              origin={originOf(entry)}
              example={example}
              onExample={onExample}
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
  const expandable = isExpandable(entry);
  // The same lock for an endpoint behind a check and a page that is not public.
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
          // A lock, a badge wide enough for REDIRECT, the path, the source, and
          // a chevron — the same columns on every tab, filled or not.
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
          <PathText
            path={entry.path}
            host={isCall(entry) ? entry.host : undefined}
            className="min-w-0 truncate"
          />
          {isPage(entry) && entry.to ? (
            <>
              <span className="text-muted-foreground shrink-0">→</span>
              {/* The target gives way first: the path on the left is the row's own. */}
              <PathText
                path={entry.to}
                className="text-muted-foreground min-w-0 shrink-[4] truncate"
              />
            </>
          ) : null}
          {isPage(entry) && entry.condition ? (
            <Tip content={`Only when ${entry.condition}`} mono>
              <span className="text-muted-foreground min-w-0 shrink truncate font-mono text-[11px]">
                when {entry.condition}
              </span>
            </Tip>
          ) : null}
          {entry.issue ? (
            <span className="text-method-put shrink-0 font-mono text-[11px]">{entry.issue}</span>
          ) : null}
          {isRoute(entry) ? <Permissions route={entry} /> : null}
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

        {expandable ? (
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
        ) : null}
      </div>

      {expanded && isExpandable(entry) ? (
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
