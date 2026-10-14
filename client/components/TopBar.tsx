import { useEffect, useRef } from 'react';
import { Refresh } from '@/components/icons';
import { ThemeToggle } from '@/components/theme';
import { Tip } from '@/components/ui/tooltip';
import { cn, CONTROL, INPUT } from '@/lib/utils';
import type { DashboardData, TabKey } from '@/types';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'server', label: 'Server' },
  { key: 'client', label: 'Client' },
  { key: 'issues', label: 'Issues' },
];

interface TopBarProps {
  data: DashboardData | null;
  tab: TabKey;
  query: string;
  scanning: boolean;
  onTab: (tab: TabKey) => void;
  onQuery: (query: string) => void;
  onRescan: () => void;
}

export function TopBar({
  data,
  tab,
  query,
  scanning,
  onTab,
  onQuery,
  onRescan,
}: TopBarProps) {
  const input = useRef<HTMLInputElement>(null);

  // `/` focuses the filter from anywhere, the way every code search works.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.target === input.current) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts: Record<TabKey, number> = {
    server: data?.stats.routes ?? 0,
    client: (data?.stats.pages ?? 0) + (data?.stats.redirects ?? 0),
    issues:
      (data?.stats.unmatchedCalls ?? 0) +
      (data?.stats.uncalledRoutes ?? 0) +
      (data?.stats.unmountedRoutes ?? 0) +
      (data?.stats.brokenLinks ?? 0),
  };

  return (
    <header className="bg-card flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2">
      <h1 className="text-[13px] font-semibold tracking-tight">routelens</h1>

      <nav className="flex items-center gap-1">
        {TABS.filter(
          // An empty tab is only worth a slot while it is the one you are on.
          ({ key }) => !data || counts[key] > 0 || key === tab,
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onTab(key)}
            className={cn(
              'rounded px-2 py-1 text-xs',
              key === tab
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            <span className="ml-1.5 font-mono text-[10px] opacity-60">{counts[key]}</span>
          </button>
        ))}
      </nav>

      <input
        ref={input}
        value={query}
        placeholder="Filter by path, method, file…   /"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onQuery('');
            event.currentTarget.blur();
          }
        }}
        className={cn(INPUT, 'min-w-48 flex-1')}
      />

      <div className="flex items-center gap-2">
        <Tip content="Rescan the project">
          <button type="button" onClick={onRescan} disabled={scanning} className={CONTROL}>
            <Refresh className={cn(scanning && 'animate-spin')} />
            <span>{scanning ? 'Scanning…' : 'Rescan'}</span>
          </button>
        </Tip>
        <ThemeToggle />
      </div>
    </header>
  );
}
