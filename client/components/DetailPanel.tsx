import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { Copy, ExternalLink, Terminal } from '@/components/icons';
import { MethodBadge, PathText } from '@/components/MethodBadge';
import { MiddlewareStep } from '@/components/MiddlewareStep';
import { Shortcuts } from '@/components/Shortcuts';
import { SourceLink } from '@/components/SourceLink';
import { Tip } from '@/components/Tip';
import { gatesOf } from '@/lib/gates';
import { curlFor, fillPath, isNavigable, originFor, paramsOf } from '@/lib/request';
import { cn, CONTROL, INPUT } from '@/lib/utils';
import type { DashboardData, Entry } from '@/types';

interface DetailPanelProps {
  entry: Entry | null;
  data: DashboardData | null;
}

export function DetailPanel({ entry, data }: DetailPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // A new selection starts with empty parameters rather than stale ones.
  useEffect(() => setValues({}), [entry?.id]);

  const params = useMemo(() => (entry ? paramsOf(entry.path) : []), [entry]);

  if (!entry || !data) return <Shortcuts />;

  const url = originFor() + fillPath(entry.path, values);

  return (
    <aside className="bg-card flex h-full flex-col gap-5 overflow-y-auto border-l p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={entry.method} />
          <PathText path={entry.path} className="text-sm break-all" />
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
          <SourceLink file={entry.source.file} line={entry.source.line} />
        </div>
      </div>

      {/* Above the URL, because it is the reason the URL below is a guess. */}
      {!entry.mounted ? (
        <p className="text-method-put border-method-put/30 bg-method-put/10 rounded-md border px-2.5 py-2 text-xs leading-relaxed">
          Nothing in this project mounts this router. The path is relative to a prefix that does
          not exist, so these handlers answer at no URL.
        </p>
      ) : null}

      {params.length > 0 ? (
        <Field label="Parameters">
          <div className="grid gap-2.5">
            {params.map((param) => (
              <label key={param} className="block space-y-1">
                {/* Above the field, not beside it: a long `:columnDefinitionId`
                    has the width to be read in full. */}
                <span className="text-param block font-mono text-[11px]">{param}</span>
                <input
                  value={values[param] ?? ''}
                  placeholder="value"
                  autoComplete="off"
                  spellcheck={false}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setValues((prev) => ({ ...prev, [param]: value }));
                  }}
                  className={cn(INPUT, 'w-full')}
                />
              </label>
            ))}
          </div>
        </Field>
      ) : null}

      <Field label="URL">
        {/* One line, clipped at the end. The full value is a hover away, and
            the copy button next to it never truncates. */}
        <Tip content={url} align="start" mono>
          <p className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">{url}</p>
        </Tip>
        <div className="flex flex-wrap gap-2 pt-1">
          {isNavigable(entry) ? (
            <a
              id="routelens-open-link"
              href={url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                CONTROL,
                'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
              )}
            >
              <ExternalLink />
              Open in tab
            </a>
          ) : null}
          <CopyButton value={url} label="Copy URL" icon={Copy} />
          <CopyButton value={curlFor(entry, url)} label="Copy curl" icon={Terminal} />
        </div>
      </Field>

      {entry.middleware.length > 0 ? (
        <Field label={`Runs before the handler (${entry.middleware.length})`}>
          {entry.middleware.map((item, index) => (
            <MiddlewareStep key={`${item.name}:${item.source.file}:${item.source.line}:${index}`} item={item} />
          ))}
        </Field>
      ) : null}

      {gatesOf(entry).length === 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          No authentication or permission check found in front of this endpoint, or inside its
          handler.
        </p>
      ) : null}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </h3>
      {children}
    </div>
  );
}
