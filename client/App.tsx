import { useCallback, useEffect, useMemo, useState } from 'react';
import { openInEditor } from '@/api';
import { DetailPanel } from '@/components/DetailPanel';
import { EndpointList } from '@/components/EndpointList';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useGroups } from '@/hooks/useGroups';
import { useScan } from '@/hooks/useScan';
import { entriesFor, matchesQuery } from '@/lib/groups';
import { isNavigable } from '@/lib/request';
import { cn } from '@/lib/utils';
import type { Entry, TabKey } from '@/types';

export function App() {
  const { data, error, scanning, rescan } = useScan();
  const [tab, setTab] = useState<TabKey>('server');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    return entriesFor(data, tab).filter((entry) => matchesQuery(entry, query));
  }, [data, tab, query]);

  const { groups, cursor, currentGroup, toggleMethod, moveCursor, toggleGroup, clearCursor } = useGroups(
    entries,
    query,
    selectedId,
  );

  // What the keyboard can reach: on-screen rows, in the order they appear.
  const navigable = useMemo(() => groups.flatMap((group) => group.visible), [groups]);

  const selected = useMemo(
    () => navigable.find((entry) => entry.id === selectedId) ?? null,
    [navigable, selectedId],
  );

  const move = useCallback(
    (delta: number) => {
      if (navigable.length === 0) return;
      const index = navigable.findIndex((entry) => entry.id === selectedId);
      const next = index === -1 ? (delta > 0 ? 0 : navigable.length - 1) : index + delta;
      const clamped = Math.max(0, Math.min(navigable.length - 1, next));
      setSelectedId(navigable[clamped]!.id);
    },
    [navigable, selectedId],
  );


  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      // A focused button or link owns Enter and Space — the browser activates
      // it, and acting on the selection as well would fire two things at once.
      const onControl = Boolean(target?.closest('button, a'));

      if (event.key === 'l' || event.key === 'ArrowRight') {
        event.preventDefault();
        moveCursor(1);
      } else if (event.key === 'h' || event.key === 'ArrowLeft') {
        event.preventDefault();
        moveCursor(-1);
      } else if (event.key === ' ' && cursor && !onControl) {
        event.preventDefault();
        const method = currentGroup?.methods[cursor.index];
        if (method) toggleMethod(cursor.label, method);
      } else if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter' && !onControl && selected && isNavigable(selected)) {
        // Navigation only — never a non-GET request.
        document.getElementById('routelens-open-link')?.click();
      } else if (event.key === 'o' && selected) {
        event.preventDefault();
        void openInEditor(selected.source.file, selected.source.line);
      } else if (event.key === 'Escape') {
        setSelectedId(null);
        clearCursor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, moveCursor, toggleMethod, clearCursor, cursor, currentGroup, selected]);


  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        data={data}
        tab={tab}
        query={query}
        scanning={scanning}
        onRescan={rescan}
        onTab={(next) => {
          setTab(next);
          setSelectedId(null);
        }}
        onQuery={(next) => {
          setQuery(next);
          setSelectedId(null);
        }}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 overflow-y-auto">
          <EndpointList
            data={data}
            groups={groups}
            empty={entries.length === 0}
            selectedId={selectedId}
            query={query}
            loading={!data && !error}
            onSelect={(entry) => setSelectedId(entry.id)}
            onToggle={toggleGroup}
            onMethod={toggleMethod}
          />
        </div>

        {/* Narrow screens have no room for a side panel, so it becomes a
            bottom sheet that appears once something is selected. */}
        <div
          className={cn(
            'min-h-0 max-h-[55vh] lg:max-h-none',
            selected ? 'block' : 'hidden lg:block',
          )}
        >
          <DetailPanel entry={selected} data={data} />
        </div>
      </main>

      <StatusBar data={data} error={error} />
    </div>
  );
}
