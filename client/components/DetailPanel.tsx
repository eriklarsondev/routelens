import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FileCode, Terminal } from '@/components/icons';
import { MethodBadge, PathText } from '@/components/MethodBadge';
import { openInEditor } from '@/api';
import { cn, CONTROL } from '@/lib/utils';
import {
  callsOf,
  curlFor,
  fillPath,
  isNavigable,
  originFor,
  paramsOf,
  routeById,
  shortSource,
} from '@/lib';
import type { DashboardData, Entry } from '@/types';
import { isRoute } from '@/types';

const SHORTCUTS: Array<[string, string]> = [
  ['/', 'filter'],
  ['↑ ↓', 'move, across cards'],
  ['← →', 'pick a method'],
  ['space', 'show / hide it'],
  ['↵', 'open in a tab'],
  ['o', 'open the source'],
  ['esc', 'clear the selection'],
];

interface DetailPanelProps {
  entry: Entry | null;
  data: DashboardData | null;
}

export function DetailPanel({ entry, data }: DetailPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // A new selection starts with empty parameters rather than stale ones.
  useEffect(() => setValues({}), [entry?.id]);

  const params = useMemo(() => (entry ? paramsOf(entry.path) : []), [entry]);

  if (!entry || !data) {
    return (
      <aside className="bg-card text-muted-foreground flex h-full flex-col gap-4 border-l p-6 text-sm">
        <p>Select an endpoint to get its URL, curl command, callers and source.</p>
        <dl className="grid gap-1 font-mono text-xs">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex gap-3">
              <dt className="w-12 shrink-0 text-right">{keys}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </aside>
    );
  }

  const url = originFor(entry, data) + fillPath(entry.path, values);
  const callers = callsOf(entry);
  const handler = routeById(data, !isRoute(entry) ? entry.routeId : undefined);

  return (
    <aside className="bg-card flex h-full flex-col gap-5 overflow-y-auto border-l p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={entry.method} />
          <PathText
            path={entry.path}
            host={!isRoute(entry) ? entry.host : undefined}
            className="text-sm break-all"
          />
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
          <SourceLink file={entry.source.file} line={entry.source.line} />
          {isRoute(entry) && entry.framework !== 'unknown' ? (
            <span className="shrink-0">· {entry.framework}</span>
          ) : null}
          {!isRoute(entry) ? <span className="shrink-0">· {entry.library}</span> : null}
        </div>
      </div>

      {/* Above the URL, because it is the reason the URL below is a guess. */}
      {isRoute(entry) && !entry.mounted ? (
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
                  spellCheck={false}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [param]: event.target.value }))
                  }
                  className="border-border bg-muted/40 placeholder:text-muted-foreground/50 focus:ring-ring/40 w-full rounded-md border px-2 py-1.5 font-mono text-xs focus:ring-2 focus:outline-none"
                />
              </label>
            ))}
          </div>
        </Field>
      ) : null}

      <Field label="URL">
        {/* One line, clipped at the end. The full value is a hover away, and
            the copy button next to it never truncates. */}
        <p className="text-muted-foreground min-w-0 truncate font-mono text-[11px]" title={url}>
          {url}
        </p>
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
        {/* Only about the method: an unmounted route says its own piece above. */}
        {!isNavigable(entry) && (!isRoute(entry) || entry.mounted) ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {entry.method} endpoints are not opened from here — routelens never sends requests.
            Copy the curl instead.
          </p>
        ) : null}
      </Field>

      {handler ? (
        <Field label="Handled by">
          <Reference
            file={handler.source.file}
            line={handler.source.line}
            method={handler.method}
            text={handler.path}
          />
        </Field>
      ) : null}

      {callers.length > 0 ? (
        <Field label={`Called from (${callers.length})`}>
          {callers.map((caller) => (
            <Reference
              key={caller.id}
              file={caller.source.file}
              line={caller.source.line}
              method={caller.method}
              text={caller.library}
            />
          ))}
        </Field>
      ) : null}

      {isRoute(entry) && entry.mounted && entry.kind === 'api' && callers.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing in this repo calls this endpoint.</p>
      ) : null}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </h3>
      {children}
    </div>
  );
}

function CopyButton({
  value,
  label,
  icon: Glyph,
}: {
  value: string;
  label: string;
  icon: typeof Copy;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={CONTROL}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard access can be denied; the URL is on screen either way.
        }
      }}
    >
      {copied ? <Check className="text-method-get" /> : <Glyph />}
      {/* Fixed width so confirming the copy does not resize the button. */}
      <span className="w-14 text-center">{copied ? 'Copied' : label}</span>
    </button>
  );
}

function SourceLink({ file, line }: { file: string; line: number }) {
  return (
    <button
      className="hover:text-foreground flex min-w-0 items-center gap-1 underline-offset-2 hover:underline"
      onClick={() => void openInEditor(file, line)}
      title={`${file}:${line}`}
    >
      <FileCode className="size-3 shrink-0" />
      {/* Shortened from the front: the filename and line are the half worth
          reading, and a deep path would otherwise push them out of sight. */}
      <span className="truncate">{shortSource(file, line, 44)}</span>
    </button>
  );
}

function Reference({
  file,
  line,
  method,
  text,
}: {
  file: string;
  line: number;
  method: string;
  text: string;
}) {
  return (
    <button
      onClick={() => void openInEditor(file, line)}
      title={`${file}:${line}`}
      className="hover:bg-accent flex w-full items-center gap-2 rounded px-1 py-1 text-left"
    >
      <MethodBadge method={method as never} />
      <span className="truncate font-mono text-[11px]">{text}</span>
      <span className="text-muted-foreground ml-auto max-w-[45%] truncate font-mono text-[10px]">
        {shortSource(file, line, 26)}
      </span>
    </button>
  );
}
