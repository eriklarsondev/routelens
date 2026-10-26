import type { ReactNode } from 'react';
import { Lock, Shield } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { MiddlewareRef } from '@/types';

const DOT: Record<MiddlewareRef['kind'], string> = {
  auth: '',
  permission: '',
  limit: 'bg-method-put',
  validation: 'bg-method-post',
  other: 'bg-muted-foreground/40',
};

/** A node on the track, with the line running through its middle so the steps read as one. */
export function Track({ node, first = false, last = false }: { node: ReactNode; first?: boolean; last?: boolean }) {
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
export function Node({ kind }: { kind: MiddlewareRef['kind'] }) {
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
