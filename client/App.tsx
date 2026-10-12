import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchData, onFileChange, openInEditor } from '@/api';
import { DetailPanel } from '@/components/DetailPanel';
import { EndpointList } from '@/components/EndpointList';
import { Header } from '@/components/Header';
import { StatusBar } from '@/components/StatusBar';
import { Toolbar } from '@/components/Toolbar';
import { entriesFor, isNavigable, matchesQuery } from '@/lib';
import { cn } from '@/lib/utils';
import type { DashboardData, Entry, TabKey } from '@/types';

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<TabKey>('server');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (fresh: boolean) => {
    if (fresh) setScanning(true);
    try {
      setData(await fetchData(fresh));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // The server watches the project and pings when a scanned file changes.
  useEffect(() => onFileChange(() => void load(true)), [load]);

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    return entriesFor(data, tab).filter((entry) => matchesQuery(entry, query));
  }, [data, tab, query]);

  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const move = useCallback(
    (delta: number) => {
      if (entries.length === 0) return;
      const index = entries.findIndex((entry) => entry.id === selectedId);
      const next = index === -1 ? (delta > 0 ? 0 : entries.length - 1) : index + delta;
      const clamped = Math.max(0, Math.min(entries.length - 1, next));
      setSelectedId(entries[clamped]!.id);
    },
    [entries, selectedId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter' && selected && isNavigable(selected)) {
        // Navigation only — never a non-GET request.
        document.getElementById('routelens-open-link')?.click();
      } else if (event.key === 'o' && selected) {
        event.preventDefault();
        void openInEditor(selected.source.file, selected.source.line);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header data={data} scanning={scanning} onRescan={() => void load(true)} />
      <Toolbar
        data={data}
        tab={tab}
        query={query}
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
            entries={entries}
            selectedId={selectedId}
            query={query}
            loading={!data && !error}
            onSelect={(entry) => setSelectedId(entry.id)}
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
