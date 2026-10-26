import { Node, Track } from '@/components/TimelineTrack';
import { Tip } from '@/components/Tip';
import type { MiddlewareRef } from '@/types';

/**
 * Everything that runs before the endpoint's own middleware — what the app
 * runs for every request, and what it hands the router as it mounts it — as
 * one step: how many, and their names. A check among them still shows, as a
 * lock or a shield, so a gate set up in the app file is not lost from view.
 */
export function Before({ steps }: { steps: MiddlewareRef[] }) {
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
