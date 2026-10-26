import { useCallback, useMemo, useState } from 'react';
import { groupEntries, methodsOf } from '@/lib/groups';
import type { Entry, Group, Method } from '@/types';

/**
 * The cards the list shows, and what the developer has done to them: folded
 * one up, switched a method off, or moved the keyboard's cursor onto a method.
 */
export function useGroups(entries: Entry[], query: string, selectedId: string | null) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hiddenMethods, setHiddenMethods] = useState<Record<string, Method[]>>({});
  const [cursor, setCursor] = useState<{ label: string; index: number } | null>(null);

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

  const toggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(label)) next.add(label);
      return next;
    });
  }, []);

  const clearCursor = useCallback(() => setCursor(null), []);

  return { groups, cursor, currentGroup, toggleMethod, moveCursor, toggleGroup, clearCursor };
}
