import { openInEditor } from '@/api';
import { Lock, Shield } from '@/components/icons';
import { Tip } from '@/components/ui/tooltip';
import { attachedMiddleware, shortSource } from '@/lib';
import { cn } from '@/lib/utils';
import type { MiddlewareRef, ServerRoute, SourceRef } from '@/types';

const DOT: Record<MiddlewareRef['kind'], string> = {
  auth: '',
  permission: '',
  limit: 'bg-method-put',
  validation: 'bg-method-post',
  other: 'bg-muted-foreground/40',
};

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
  node: React.ReactNode;
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

/**
 * Everything that runs before the endpoint's own middleware — what the app
 * runs for every request, and what it hands the router as it mounts it — as
 * one step: how many, and their names. A check among them still shows, as a
 * lock or a shield, so a gate set up in the app file is not lost from view.
 */
function Before({ steps }: { steps: MiddlewareRef[] }) {
  const app = steps.filter((step) => step.scope === 'app').length;
  const mount = steps.length - app;
  const gate = steps.find((step) => step.kind === 'permission') ?? steps.find((step) => step.kind === 'auth');
  const counts = [app > 0 ? `${app} app-wide` : '', mount > 0 ? `${mount} at the mount` : ''].filter(Boolean);
  const names = steps.map((step) => step.name).join(' · ');

  return (
    <li className="flex pb-3">
      <Track
        first
        node={
          gate ? (
            <Node kind={gate.kind} />
          ) : (
            // A ring rather than a dot: several steps, not one.
            <span className="border-muted-foreground/60 size-2.5 rounded-full border-2" />
          )
        }
      />
      <Tip
        content={
          <ul className="space-y-0.5">
            {steps.map((step, index) => (
              <li key={`${step.name}:${step.source.file}:${step.source.line}:${index}`}>
                {step.scope} · {step.name} · {step.source.file}:{step.source.line}
              </li>
            ))}
          </ul>
        }
        side="right"
        mono
      >
        {/* Focusable, so the list behind the summary is reachable without a mouse. */}
        <div tabIndex={0} className="ml-1.5 min-w-0 rounded px-1.5 pb-1 focus-visible:outline-2">
          <span className="text-muted-foreground flex h-6 items-center font-mono text-[11px]">
            {[`${steps.length} ${steps.length === 1 ? 'step' : 'steps'} first`, ...counts].join(' · ')}
          </span>
          <span className="text-muted-foreground/80 block truncate font-mono text-[10px] leading-4">{names}</span>
        </div>
      </Tip>
    </li>
  );
}

/** A node on the track, with the line running through its middle so the steps read as one. */
function Track({ node, first = false, last = false }: { node: React.ReactNode; first?: boolean; last?: boolean }) {
  return (
    <div className="relative flex w-5 shrink-0 justify-center">
      {first ? null : <span className="bg-border absolute top-0 h-3 w-px" />}
      {last ? null : <span className="bg-border absolute top-3 bottom-0 w-px" />}
      <span className="relative flex h-6 items-center">{node}</span>
    </div>
  );
}

/**
 * Signing in is a lock and a permission check a shield, both in a ring; anything
 * else is a dot in its kind's colour.
 */
function Node({ kind }: { kind: MiddlewareRef['kind'] }) {
  if (kind === 'auth' || kind === 'permission') {
    const Icon = kind === 'auth' ? Lock : Shield;
    return (
      <span className="bg-card border-foreground/30 flex size-5 items-center justify-center rounded-full border">
        <Icon className="text-foreground/80 size-2.5" />
      </span>
    );
  }
  return <span className={cn('size-2.5 rounded-full', DOT[kind])} />;
}
