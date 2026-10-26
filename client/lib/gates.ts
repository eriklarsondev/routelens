import type { Entry, MiddlewareRef, ServerRoute } from '@/types';

/** The authentication and permission checks in front of an endpoint, each name once. */
export function gatesOf(route: ServerRoute): MiddlewareRef[] {
  return uniqueNames((route.middleware ?? []).filter((ref) => ref.kind === 'auth' || ref.kind === 'permission'));
}

/**
 * The permission checks written as middleware, each name once: `requireAdmin`,
 * a role guard. A handler refusing with a 403 is a check too, but it has no
 * name to show, only a status code.
 */
export function permissionsOf(route: ServerRoute): MiddlewareRef[] {
  return uniqueNames((route.middleware ?? []).filter((ref) => ref.kind === 'permission' && ref.scope !== 'handler'));
}

/** Why a row carries a lock — what checks the endpoint — or null when it does not. */
export function lockOf(entry: Entry): string | null {
  const gates = gatesOf(entry);
  return gates.length > 0 ? `Behind ${gates.map((gate) => gate.name).join(' · ')}` : null;
}

function uniqueNames(refs: MiddlewareRef[]): MiddlewareRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.name)) return false;
    seen.add(ref.name);
    return true;
  });
}

/**
 * The middleware attached to this endpoint in particular: its router's own and
 * the route's own. What the app runs, and what the app hands a router as it
 * mounts it, is wiring the app does for many endpoints at once — the side
 * panel lists it. A handler's own checks are the handler's.
 */
export function attachedMiddleware(route: ServerRoute): MiddlewareRef[] {
  return (route.middleware ?? []).filter((step) => step.scope === 'router' || step.scope === 'route');
}
