import type { ReactNode } from 'react';
import { openInEditor } from '@/api';
import { Before } from '@/components/TimelineBefore';
import { Node, Track } from '@/components/TimelineTrack';
import { Tip } from '@/components/Tip';
import { attachedMiddleware } from '@/lib/gates';
import { shortSource } from '@/lib/sources';
import { cn } from '@/lib/utils';
import type { MiddlewareRef, ServerRoute, SourceRef } from '@/types';

const NAME: Record<MiddlewareRef['kind'], string> = {
  auth: 'text-foreground',
  permission: 'text-foreground',
  limit: 'text-method-put',
  validation: 'text-method-post',
  other: 'text-muted-foreground',
};

/**
 * What is attached to one endpoint, top to bottom in the order a request meets
 * it: its router's middleware, then the route's own, then the handler, which
 * carries any check it makes itself. What the app runs or hands a router as it
 * mounts it is shared by many endpoints, so it opens the timeline as one
 * summary — the side panel lists it step by step.
 */
export function MiddlewareTimeline({ route }: { route: ServerRoute }) {
  const before = route.middleware.filter((step) => step.scope === 'app' || step.scope === 'mount');
  const steps = attachedMiddleware(route);
  const checks = route.middleware.filter((step) => step.scope === 'handler');

  return (
    <ol className="py-3" aria-label="Attached middleware">
      {before.length > 0 ? <Before steps={before} /> : null}
      {steps.map((step, index) => (
        <Step
          key={`${step.name}:${step.source.file}:${step.source.line}:${index}`}
          first={index === 0 && before.length === 0}
          node={<Node kind={step.kind} />}
          name={step.name}
          definition={step.definition}
          nameClass={NAME[step.kind]}
          note={step.scope}
          source={step.source}
          title={`${step.kind} · attached to the ${step.scope}`}
        />
      ))}
      <Step
        first={steps.length === 0 && before.length === 0}
        last
        // A handler that answers 401 or 403 itself is a check like any other.
        node={
          checks.length > 0 ? (
            <Node kind={checks.some((check) => check.kind === 'permission') ? 'permission' : 'auth'} />
          ) : (
            <span className="bg-foreground size-2.5 rounded-full" />
          )
        }
        name="handler"
        nameClass="text-foreground"
        note={checks.map((check) => check.name).join(' · ')}
        source={route.source}
        title="The route's own handler"
      />
    </ol>
  );
}

function Step({
  node,
  name,
  definition,
  nameClass,
  note,
  source,
  title,
  first = false,
  last = false,
}: {
  node: ReactNode;
  name: string;
  definition?: string;
  nameClass: string;
  note: string;
  source: SourceRef;
  title: string;
  first?: boolean;
  last?: boolean;
}) {
  return (
    // The gap below a step belongs to it, so its line carries on to the next node.
    <li className={cn('flex', !last && 'pb-3')}>
      <Track node={node} first={first} last={last} />
      <Tip content={`${title} · ${source.file}:${source.line}`} side="right" mono>
        <button
          type="button"
          onClick={() => void openInEditor(source.file, source.line)}
          className="hover:bg-accent ml-1.5 min-w-0 rounded px-1.5 pb-1 text-left"
        >
          {/* The name sits level with its node; where it is attached, and where, below. */}
          <span className={cn('flex h-6 items-center gap-1.5 truncate font-mono text-[11px]', nameClass)}>
            {name}
            {/* A local name, and what it stands for: `auth = passport.authenticate('jwt')`. */}
            {definition ? <span className="text-muted-foreground truncate">= {definition}</span> : null}
          </span>
          <span className="text-muted-foreground block truncate font-mono text-[10px] leading-4">
            {note ? `${note} · ` : ''}
            {/* Shortened from the front to fit half a row: the file and line are what matter. */}
            {shortSource(source.file, source.line, Math.max(24, 52 - (note ? note.length + 3 : 0)))}
          </span>
        </button>
      </Tip>
    </li>
  );
}
