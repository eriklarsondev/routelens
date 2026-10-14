import { useEffect, useMemo, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { Copy, ExternalLink, FileCode, Terminal } from '@/components/icons';
import { MethodBadge, PathText } from '@/components/MethodBadge';
import { MiddlewareStep } from '@/components/MiddlewareStep';
import { Tip } from '@/components/ui/tooltip';
import { openInEditor } from '@/api';
import { cn, CONTROL, INPUT } from '@/lib/utils';
import {
  appOf,
  gatesOf,
  callsOf,
  curlFor,
  fillPath,
  isNavigable,
  originFor,
  paramsOf,
  routeById,
  shortSource,
} from '@/lib';
import type { ClientPage, DashboardData, Entry, PageUnlock, ServerRoute } from '@/types';
import { isCall, isLink, isPage, isRoute } from '@/types';

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
        <p>Select an endpoint or page to get its URL, callers and source.</p>
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
  const handler = routeById(data, isCall(entry) ? entry.routeId : undefined);
  const app = isPage(entry) || isLink(entry) ? appOf(data, entry.app) : null;

  return (
    <aside className="bg-card flex h-full flex-col gap-5 overflow-y-auto border-l p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={entry.method} />
          <PathText
            path={entry.path}
            host={isCall(entry) ? entry.host : undefined}
            className="text-sm break-all"
          />
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
          <SourceLink file={entry.source.file} line={entry.source.line} />
          {isRoute(entry) && entry.framework !== 'unknown' ? (
            <span className="shrink-0">· {entry.framework}</span>
          ) : null}
          {isCall(entry) ? <span className="shrink-0">· {entry.via ?? entry.library}</span> : null}
          {isPage(entry) ? <span className="shrink-0">· {entry.router}</span> : null}
          {isLink(entry) ? <span className="shrink-0">· {entry.via}</span> : null}
        </div>
      </div>

      {isLink(entry) && entry.issue ? (
        <p className="text-method-put border-method-put/30 bg-method-put/10 rounded-md border px-2.5 py-2 text-xs leading-relaxed">
          No page in {entry.app === '.' ? 'this app' : entry.app} answers this path, so the link
          lands on its not-found page — or, with a catch-all redirect, somewhere it did not mean
          to go.
        </p>
      ) : null}

      {isPage(entry) && entry.to ? (
        <Field label="Redirects to">
          <PathText path={entry.to} className="text-sm break-all" />
        </Field>
      ) : null}

      {isPage(entry) && entry.condition ? (
        <Field label="Only when">
          <code className="bg-muted/60 block rounded px-2 py-1 font-mono text-[11px] break-all">
            {entry.condition}
          </code>
        </Field>
      ) : null}

      {app ? (
        <Field label="App">
          <p className="font-mono text-[11px]">
            {app.root === '.' ? (app.name ?? '/') : app.root}
            <span className="text-muted-foreground"> · served under </span>
            {app.base ?? '?'}
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {app.base
              ? `From ${app.baseSource ?? 'the default'}.`
              : 'routelens could not work out the base path this app is served under, so the URL below assumes /.'}
          </p>
        </Field>
      ) : null}

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
          {/* A page is for a browser; curl would only fetch the app shell. */}
          {isPage(entry) || isLink(entry) ? null : (
            <CopyButton value={curlFor(entry, url)} label="Copy curl" icon={Terminal} />
          )}
        </div>
        {isPage(entry) && !isNavigable(entry) ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            A catch-all answers every path it covers, so there is no one URL to open.
          </p>
        ) : null}
      </Field>

      {isPage(entry) && !entry.public ? <Unlocks page={entry} data={data} /> : null}

      {isRoute(entry) && entry.middleware.length > 0 ? (
        <Field label={`Runs before the handler (${entry.middleware.length})`}>
          {entry.middleware.map((item, index) => (
            <MiddlewareStep key={`${item.name}:${item.source.file}:${item.source.line}:${index}`} item={item} />
          ))}
        </Field>
      ) : null}

      {isRoute(entry) && gatesOf(entry).length === 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          No authentication or permission check found in front of this endpoint, or inside its
          handler.
        </p>
      ) : null}


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
              text={caller.via ?? caller.library}
            />
          ))}
        </Field>
      ) : null}

      {isPage(entry) && entry.linkedFrom.length > 0 ? (
        <Field label={`Linked from (${entry.linkedFrom.length})`}>
          {entry.linkedFrom.map((link) => (
            <Reference
              key={link.id}
              file={link.source.file}
              line={link.source.line}
              method="LINK"
              text={link.via}
            />
          ))}
        </Field>
      ) : null}

      {isPage(entry) && entry.kind === 'page' && entry.linkedFrom.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing in this app links here.</p>
      ) : null}

      {isRoute(entry) && entry.mounted && callers.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing in this repo calls this endpoint.</p>
      ) : null}
    </aside>
  );
}

const UNLOCKS: Array<{ by: PageUnlock['by']; note: string }> = [
  { by: 'sign-in', note: 'Signing in here gets a visitor past the check in front of this page.' },
  { by: 'link', note: 'The page sends the token from its link here.' },
];

/**
 * What a page that is not public needs hit before it opens: the endpoint that
 * signs a visitor in, or the one its link's token is checked against. How the
 * page is guarded stays on the server's side; this is only where to go.
 */
function Unlocks({ page, data }: { page: ClientPage; data: DashboardData }) {
  const groups = UNLOCKS.map(({ by, note }) => ({
    by,
    note,
    routes: (page.unlockedBy ?? [])
      .filter((unlock) => unlock.by === by)
      .map((unlock) => routeById(data, unlock.routeId))
      .filter((route): route is ServerRoute => route !== null),
  })).filter((group) => group.routes.length > 0);

  return (
    <Field label="To get past the lock">
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          routelens could not tell which endpoint opens this page.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.by} className="space-y-1">
            <p className="text-muted-foreground text-xs leading-relaxed">{group.note}</p>
            {group.routes.map((route) => (
              <Reference
                key={route.id}
                file={route.source.file}
                line={route.source.line}
                method={route.method}
                text={route.path}
              />
            ))}
          </div>
        ))
      )}
    </Field>
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

function SourceLink({ file, line }: { file: string; line: number }) {
  return (
    <Tip content={`${file}:${line}`} align="start" mono>
      <button
        className="hover:text-foreground flex min-w-0 items-center gap-1 underline-offset-2 hover:underline"
        onClick={() => void openInEditor(file, line)}
      >
        <FileCode className="size-3 shrink-0" />
        {/* Shortened from the front: the filename and line are the half worth
            reading, and a deep path would otherwise push them out of sight. */}
        <span className="truncate">{shortSource(file, line, 44)}</span>
      </button>
    </Tip>
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
    <Tip content={`${file}:${line}`} side="left" mono>
      <button
        onClick={() => void openInEditor(file, line)}
        className="hover:bg-accent flex w-full items-center gap-2 rounded px-1 py-1 text-left"
      >
        <MethodBadge method={method as never} />
        <span className="truncate font-mono text-[11px]">{text}</span>
        <span className="text-muted-foreground ml-auto max-w-[45%] truncate font-mono text-[10px]">
          {shortSource(file, line, 26)}
        </span>
      </button>
    </Tip>
  );
}
