import { createLens, type Lens, type LensRequest } from './core.js';
import type { RouteLensOptions } from './types.js';

export interface FetchHandler {
  (request: Request): Promise<Response>;
  lens: Lens;
}

/**
 * Web-standard handler for frameworks that speak `Request`/`Response`
 * (Next.js App Router, Hono, Remix, SvelteKit, Bun, Deno).
 *
 * Next.js — `app/%5F%5Froutelens/[[...path]]/route.ts` (`%5F` is an escaped
 * underscore: a folder starting with `_` is private and never routed). The
 * check folds to `false` in `next build`, which leaves routelens out of it:
 * ```ts
 * export const dynamic = 'force-dynamic';
 * const lens =
 *   process.env.NODE_ENV === 'development'
 *     ? import('routelens/fetch').then(({ createRouteLensHandler }) => createRouteLensHandler())
 *     : null;
 * export async function GET(request: Request) {
 *   return lens ? (await lens)(request) : new Response('Not found', { status: 404 });
 * }
 * export const POST = GET;
 * ```
 */
export function createRouteLensHandler(options: RouteLensOptions = {}): FetchHandler {
  const lens = createLens(options);

  const handler = (async (request: Request): Promise<Response> => {
    return (
      (await respondTo(lens, request)) ??
      new Response(JSON.stringify({ error: 'Not a routelens path' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );
  }) as FetchHandler;

  handler.lens = lens;
  return handler;
}

/**
 * The dashboard's answer to a web-standard request, or null when the request
 * is not for routelens. Shared with `routelens()`, which hands a null back to
 * the app (Hono's `next()`) instead of answering it.
 */
export async function respondTo(lens: Lens, request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const headers: LensRequest['headers'] = Object.fromEntries(request.headers);
  // Servers build a Request's URL from the Host it arrived with; one built in
  // code (`app.fetch(new Request(url))`) has only the URL to say it.
  headers.host ??= url.host;
  const described: LensRequest = {
    method: request.method,
    path: url.pathname,
    // A web Request carries no socket, so who sent it is down to its headers.
    headers,
  };

  if (lens.isEventStream(url.pathname)) {
    const refusal = lens.guard(described);
    return refusal ? new Response(refusal.body, { status: refusal.status, headers: refusal.headers }) : eventStream(lens);
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();

  const result = await lens.handle({ ...described, search: url.search, body });
  if (!result) return null;

  return new Response(request.method === 'HEAD' ? null : result.body, {
    status: result.status,
    headers: result.headers,
  });
}

function eventStream(lens: Lens): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: ready\ndata: {}\n\n'));
      unsubscribe = lens.subscribe(() => {
        controller.enqueue(encoder.encode('event: change\ndata: {}\n\n'));
      });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 30_000);
      heartbeat.unref?.();
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      connection: 'keep-alive',
    },
  });
}
