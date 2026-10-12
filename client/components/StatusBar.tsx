import { AlertTriangle, Circle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import type { DashboardData } from '@/types';

export function StatusBar({ data, error }: { data: DashboardData | null; error: string | null }) {
  if (error) {
    return (
      <footer className="text-destructive bg-card flex h-9 shrink-0 items-center gap-2 border-t px-4 font-mono text-[11px]">
        <AlertTriangle className="size-3" />
        {error}
      </footer>
    );
  }

  if (!data) {
    return (
      <footer className="text-muted-foreground bg-card flex h-9 shrink-0 items-center gap-2 border-t px-4 font-mono text-[11px]">
        <Circle className="size-2 animate-pulse fill-current" />
        Scanning…
      </footer>
    );
  }

  const { stats } = data;
  const parts = [
    stats.frameworks.length > 0 ? stats.frameworks.join(' · ') : 'no framework detected',
    `${stats.filesScanned} files in ${stats.durationMs}ms`,
    `${stats.routes} endpoints · ${stats.calls} client calls`,
    ...(data.mode === 'standalone' ? [`links point at ${data.target}`] : []),
  ];

  return (
    <footer className="text-muted-foreground bg-card flex h-9 shrink-0 items-center gap-2.5 overflow-x-auto border-t px-4 font-mono text-[11px] whitespace-nowrap">
      {parts.map((part, index) => (
        <span key={part} className="flex items-center gap-2.5">
          {index > 0 ? <Separator orientation="vertical" className="!h-3" /> : null}
          {part}
        </span>
      ))}
      {data.warnings.map((warning) => (
        <span key={warning} className="text-method-put flex items-center gap-1.5">
          <AlertTriangle className="size-3" />
          {warning}
        </span>
      ))}
    </footer>
  );
}
