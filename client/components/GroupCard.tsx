import { EndpointRow } from '@/components/EndpointRow';
import { ChevronRight } from '@/components/icons';
import { MethodTab } from '@/components/MethodTab';
import type { ExampleKind } from '@/components/RequestExample';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';
import type { Entry, Group, Method } from '@/types';

/** One topic: its endpoints, a method filter, and a header that folds it. */
export function GroupCard({
  group,
  sourceWidth,
  selectedId,
  onSelect,
  onToggle,
  onMethod,
  expanded,
  onExpand,
  origin,
  example,
  onExample,
}: {
  group: Group;
  sourceWidth: number;
  selectedId: string | null;
  onSelect: (entry: Entry) => void;
  onToggle: (label: string) => void;
  onMethod: (label: string, method: Method) => void;
  expanded: string | null;
  onExpand: (id: string) => void;
  origin: string;
  example: ExampleKind;
  onExample: (kind: ExampleKind) => void;
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
          <h2 className="truncate font-mono text-[15px] font-medium tracking-tight">{group.label}</h2>
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
            <EndpointRow
              key={entry.id}
              entry={entry}
              label={labels.get(entry.id) ?? ''}
              sourceWidth={sourceWidth}
              selected={entry.id === selectedId}
              onSelect={() => onSelect(entry)}
              expanded={expanded === entry.id}
              onExpand={() => onExpand(entry.id)}
              origin={origin}
              example={example}
              onExample={onExample}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
