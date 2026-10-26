import { Tip } from '@/components/Tip';
import { originFor } from '@/lib/request';
import type { DashboardData } from '@/types';

/**
 * Where every path below actually lives. It sits above the endpoints because it
 * applies to all of them: a route reads as `/api/status`, but the URL you can
 * open is the base joined to it.
 */
export function BaseCard({ data }: { data: DashboardData | null }) {
  if (!data) return null;

  const base = originFor();
  const mountedIn = data.mountedIn.map((source) => `${source.file}:${source.line}`).join(', ');

  return (
    <section className="bg-card rounded-lg border px-3 py-2.5 shadow-xs">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          Base
        </h2>
        <Tip content={base} align="start" mono>
          <p className="min-w-0 flex-1 truncate font-mono text-[13px]">{base}</p>
        </Tip>
      </div>

      <p className="text-muted-foreground mt-0.5 text-[11px]">
        {mountedIn ? (
          <>
            Mounted in <span className="text-foreground/80 font-mono">{mountedIn}</span>, so endpoint
            links are same-origin.
          </>
        ) : (
          'No app.use(routelens()) found, so no route could be placed in an app.'
        )}
      </p>
    </section>
  );
}
