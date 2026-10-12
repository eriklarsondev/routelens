import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Copy, FileCode2, Keyboard, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MethodBadge, PathText } from '@/components/MethodBadge';
import { openInEditor } from '@/api';
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
import { cn } from '@/lib/utils';
import type { DashboardData, Entry } from '@/types';
import { isRoute } from '@/types';

interface DetailPanelProps {
  entry: Entry | null;
  data: DashboardData | null;
}

export function DetailPanel({ entry, data }: DetailPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // A new selection starts with empty parameters rather than stale ones.
  useEffect(() => setValues({}), [entry?.id]);

  const params = useMemo(() => (entry ? paramsOf(entry.path) : []), [entry]);

  if (!entry || !data) return <EmptyPanel />;

  const url = originFor(entry, data) + fillPath(entry.path, values);
  const callers = callsOf(entry);
  const handler = routeById(data, !isRoute(entry) ? entry.routeId : undefined);

  return (
    <aside className="bg-card flex h-full flex-col overflow-y-auto border-l">
      <div className="space-y-1.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={entry.method} />
          <PathText
            path={entry.path}
            host={!isRoute(entry) ? entry.host : undefined}
            className="text-sm whitespace-normal"
          />
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <SourceButton file={entry.source.file} line={entry.source.line} />
          {isRoute(entry) && entry.framework !== 'unknown' ? <span>· {entry.framework}</span> : null}
          {!isRoute(entry) ? <span>· {entry.library}</span> : null}
        </div>
      </div>

      <Separator />

      <div className="space-y-4 p-4">
        {params.length > 0 ? (
          <Field label="Parameters">
            <div className="grid gap-1.5">
              {params.map((param) => (
                <div key={param} className="relative">
                  <span className="text-param pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[11px]">
                    {param}
                  </span>
                  <Input
                    value={values[param] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [param]: event.target.value }))
                    }
                    className="h-8 font-mono text-xs"
                    style={{ paddingLeft: `${param.length * 0.62 + 1.4}rem` }}
                  />
                </div>
              ))}
            </div>
          </Field>
        ) : null}

        <Field label="URL">
          <div className="bg-muted/60 text-muted-foreground rounded-md border px-2.5 py-2 font-mono text-[11px] break-all">
            {url}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          {isNavigable(entry) ? (
            <Button asChild size="sm" className="flex-1">
              <a id="routelens-open-link" href={url} target="_blank" rel="noreferrer">
                Open in tab
                <ArrowUpRight />
              </a>
            </Button>
          ) : null}
          <CopyButton value={url} label="URL" icon={Copy} />
          <CopyButton value={curlFor(entry, url)} label="curl" icon={Terminal} />
        </div>

        {!isNavigable(entry) ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            <Badge variant="outline" className="mr-1.5 font-mono">
              {entry.method}
            </Badge>
            endpoints are not opened from here — routelens never sends requests. Copy the curl
            instead.
          </p>
        ) : null}
      </div>

      {handler ? (
        <>
          <Separator />
          <div className="p-4">
            <Field label="Handled by">
              <Reference
                file={handler.source.file}
                line={handler.source.line}
                method={handler.method}
                text={handler.path}
              />
            </Field>
          </div>
        </>
      ) : null}

      {callers.length > 0 ? (
        <>
          <Separator />
          <div className="p-4">
            <Field label={`Called from (${callers.length})`}>
              <div className="grid gap-1">
                {callers.map((caller) => (
                  <Reference
                    key={caller.id}
                    file={caller.source.file}
                    line={caller.source.line}
                    method={caller.method}
                    text={caller.library}
                  />
                ))}
              </div>
            </Field>
          </div>
        </>
      ) : null}

      {isRoute(entry) && entry.kind === 'api' && callers.length === 0 ? (
        <>
          <Separator />
          <p className="text-muted-foreground p-4 text-xs">
            Nothing in this repo calls this endpoint.
          </p>
        </>
      ) : null}
    </aside>
  );
}

function EmptyPanel() {
  const shortcuts: Array<[string, string]> = [
    ['/', 'filter'],
    ['j k', 'move'],
    ['↵', 'open in a tab'],
    ['o', 'open the source'],
  ];

  return (
    <aside className="bg-card flex h-full flex-col items-center justify-center gap-5 border-l p-6 text-center">
      <Keyboard className="text-muted-foreground/40 size-7" />
      <p className="text-muted-foreground max-w-56 text-sm">
        Select an endpoint to get its URL, curl command, callers and source.
      </p>
      <dl className="grid gap-2">
        {shortcuts.map(([keys, label]) => (
          <div key={keys} className="flex items-center justify-center gap-2">
            <dt className="flex gap-1">
              {keys.split(' ').map((key) => (
                <kbd
                  key={key}
                  className="bg-muted text-muted-foreground rounded border px-1.5 font-mono text-[10px] leading-5"
                >
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className="text-muted-foreground text-xs">{label}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function CopyButton({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: typeof Copy;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied; the URL is on screen either way.
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="text-method-get" /> : <Icon />}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy {label} to the clipboard</TooltipContent>
    </Tooltip>
  );
}

function SourceButton({ file, line }: { file: string; line: number }) {
  return (
    <button
      className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
      onClick={() => void openInEditor(file, line)}
    >
      <FileCode2 className="size-3" />
      {file}:{line}
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
      className={cn(
        'bg-muted/50 hover:bg-accent flex w-full items-center gap-2 rounded-md border px-2 py-1.5',
        'cursor-pointer text-left transition-colors',
      )}
    >
      <MethodBadge method={method as never} />
      <span className="truncate font-mono text-[11px]">{text}</span>
      <span className="text-muted-foreground ml-auto max-w-[45%] truncate font-mono text-[10px]">
        {shortSource(file, line, 26)}
      </span>
    </button>
  );
}
