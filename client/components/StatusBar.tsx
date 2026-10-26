import type { DashboardData } from '@/types';

export function StatusBar({ data, error }: { data: DashboardData | null; error: string | null }) {
  const parts = error
    ? [error]
    : !data
      ? ['Scanning…']
      : [
          ...(data.routes.length === 0 ? ['no Express routes found'] : []),
          `${data.stats.filesScanned} files in ${data.stats.durationMs}ms`,
          // The base card above the endpoints says where links point.
          ...data.warnings,
        ];

  return (
    <footer
      className={
        'bg-card flex h-8 shrink-0 items-center gap-2.5 overflow-x-auto border-t px-4 font-mono ' +
        'text-[11px] whitespace-nowrap ' +
        (error ? 'text-destructive' : 'text-muted-foreground')
      }
    >
      {parts.join('  ·  ')}
    </footer>
  );
}
