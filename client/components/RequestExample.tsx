import { CopyButton } from '@/components/CopyButton';
import { requestExamples } from '@/lib';
import { highlight, type TokenKind } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import type { ServerRoute } from '@/types';

export type ExampleKind = 'fetch' | 'curl';

const KINDS: ExampleKind[] = ['fetch', 'curl'];

const TOKEN: Record<TokenKind, string> = {
  keyword: 'text-syntax-keyword',
  string: 'text-syntax-string',
  function: 'text-syntax-function',
  property: 'text-syntax-property',
  flag: 'text-syntax-property',
  variable: 'text-syntax-variable',
  punctuation: 'text-muted-foreground',
  plain: '',
};

/**
 * The endpoint as a request to paste, in the form the reader asked for last.
 * routelens never sends it: the example is text, and the copy button the only
 * thing it does.
 */
export function RequestExample({
  route,
  origin,
  kind,
  onKind,
}: {
  route: ServerRoute;
  origin: string;
  kind: ExampleKind;
  onKind: (kind: ExampleKind) => void;
}) {
  // A router nothing mounts answers at no URL, so there is nothing to request.
  if (!route.mounted) {
    return (
      <p className="text-muted-foreground bg-card rounded-md border px-3 py-2.5 text-xs">
        Not mounted, so there is no URL to send a request to.
      </p>
    );
  }

  const code = requestExamples(route, origin)[kind];
  return (
    <div className="bg-card min-w-0 rounded-md border">
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-1.5">
        <div role="tablist" aria-label="Request example" className="flex gap-0.5">
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              onClick={() => onKind(option)}
              className={cn(
                'rounded px-2 py-0.5 font-mono text-[11px] transition-colors',
                kind === option ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <CopyButton value={code} label="Copy" />
        </div>
      </div>
      {/* Wrapped rather than scrolled: the URL line is always the long one. */}
      <pre className="px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>
          {highlight(code, kind === 'fetch' ? 'js' : 'shell').map((token, index) =>
            token.kind === 'plain' ? (
              token.text
            ) : (
              <span key={index} className={TOKEN[token.kind]}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
