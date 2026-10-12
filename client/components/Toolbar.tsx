import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { DashboardData, TabKey } from '@/types';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'server', label: 'Server-side' },
  { key: 'client', label: 'Client-side' },
  { key: 'pages', label: 'Pages' },
  { key: 'issues', label: 'Issues' },
];

interface ToolbarProps {
  data: DashboardData | null;
  tab: TabKey;
  query: string;
  onTab: (tab: TabKey) => void;
  onQuery: (query: string) => void;
}

export function Toolbar({ data, tab, query, onTab, onQuery }: ToolbarProps) {
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
    client: data?.stats.calls ?? 0,
    pages: data?.stats.pages ?? 0,
    issues: (data?.stats.unmatchedCalls ?? 0) + (data?.stats.uncalledRoutes ?? 0),
  };

  return (
    <div className="bg-card flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
      <div className="relative min-w-56 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          ref={input}
          value={query}
          placeholder="Filter by path, method, file…"
          autoComplete="off"
          spellCheck={false}
          className="h-8 pr-8 pl-8 font-mono text-[13px]"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onQuery('');
              event.currentTarget.blur();
            }
          }}
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => onQuery('')}
          >
            <X />
            <span className="sr-only">Clear filter</span>
          </Button>
        ) : (
          <kbd className="text-muted-foreground bg-muted pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 font-mono text-[10px]">
            /
          </kbd>
        )}
      </div>

      <Tabs value={tab} onValueChange={(value) => onTab(value as TabKey)}>
        <TabsList className="h-8">
          {TABS.map(({ key, label }) => (
            <TabsTrigger key={key} value={key} className="gap-1.5 text-xs">
              {label}
              <span
                className={cn(
                  'rounded-full px-1.5 font-mono text-[10px] leading-4',
                  key === 'issues' && counts.issues > 0
                    ? 'text-method-put bg-method-put/15'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {counts[key]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
