import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchData, onFileChange, openInEditor } from '@/api';
import { DetailPanel } from '@/components/DetailPanel';
import { EndpointList } from '@/components/EndpointList';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { entriesFor, groupEntries, isNavigable, matchesQuery, methodsOf } from '@/lib';
import { cn } from '@/lib/utils';
import type { DashboardData, Entry, Group, Method, TabKey } from '@/types';

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<TabKey>('server');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hiddenMethods, setHiddenMethods] = useState<Record<string, Method[]>>({});
  const [cursor, setCursor] = useState<{ label: string; index: number } | null>(null);

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

  const groups = useMemo<Group[]>(
    () =>
      groupEntries(entries).map((group) => {
        // Filtering is a request to see what matched, so it opens every card.
        const open = Boolean(query) || !collapsed.has(group.label);
        const methods = methodsOf(group.entries);

        // A method switched off in a card that no longer has it — because the
        // filter removed those rows — is not held against the card.
        const hidden = (hiddenMethods[group.label] ?? []).filter((method) =>
          methods.includes(method),
        );
        const matching = group.entries.filter((entry) => !hidden.includes(entry.method));

        return {
          ...group,
          open,
          methods,
          hidden,
          cursor: cursor?.label === group.label ? cursor.index : null,
          visible: open ? matching : [],
        };
      }),
    [entries, query, collapsed, hiddenMethods, cursor],
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

  /** Switch one method off, or back on. Everything is on until turned off. */
  const toggleMethod = useCallback((label: string, method: Method) => {
    setHiddenMethods((prev) => {
      const current = prev[label] ?? [];
      const hidden = current.includes(method)
        ? current.filter((other) => other !== method)
        : [...current, method];

      const next = { ...prev };
      if (hidden.length > 0) next[label] = hidden;
      else delete next[label];
      return next;
    });
  }, []);

  /** The card the keyboard is working in: the one holding the selection. */
  const currentGroup = useMemo(
    () =>
      groups.find((group) => group.visible.some((entry) => entry.id === selectedId)) ??
      groups.find((group) => group.open) ??
      null,
    [groups, selectedId],
  );

  /** Point the keyboard at the next method tab along, wrapping at the ends. */
  const moveCursor = useCallback(
    (delta: number) => {
      const group = currentGroup;
      if (!group || !group.open || group.methods.length < 2) return;

      setCursor((prev) => {
        const from = prev?.label === group.label ? prev.index : delta > 0 ? -1 : 0;
        const index = (from + delta + group.methods.length) % group.methods.length;
        return { label: group.label, index };
      });
    },
    [currentGroup],
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
        setCursor(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, moveCursor, toggleMethod, cursor, currentGroup, selected]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(label)) next.add(label);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        data={data}
        tab={tab}
        query={query}
        scanning={scanning}
        onRescan={() => void load(true)}
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
            tab={tab}
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
