import { useCallback, useMemo, useState } from 'react';
import { BaseCard } from '@/components/BaseCard';
import { GroupCard } from '@/components/GroupCard';
import type { ExampleKind } from '@/components/RequestExample';
import { originFor } from '@/lib/request';
import { sourceColumnWidth } from '@/lib/sources';
import type { DashboardData, Entry, Group, Method } from '@/types';

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
  const origin = originFor();

  // Clicking a row opens it in the side panel and opens it in place, and
  // clicking it again folds it back up. The side panel stays on it either way.
  const choose = useCallback(
    (entry: Entry) => {
      onSelect(entry);
      toggleExpanded(entry.id);
    },
    [onSelect, toggleExpanded],
  );

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
            <GroupCard
              key={group.label}
              group={group}
              sourceWidth={sourceWidth}
              selectedId={selectedId}
              onSelect={choose}
              onToggle={onToggle}
              onMethod={onMethod}
              expanded={expanded}
              onExpand={toggleExpanded}
              origin={origin}
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
