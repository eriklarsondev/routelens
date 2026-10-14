import { createLens, type Lens } from './core.js';
import type { RouteLensOptions } from './types.js';

export interface FetchHandler {
  (request: Request): Promise<Response>;
  lens: Lens;
}

/**
 * Web-standard handler for frameworks that speak `Request`/`Response`
 * (Next.js App Router, Hono, Remix, SvelteKit, Bun, Deno).
 *
 * Next.js — `app/__routelens/[[...path]]/route.ts`:
 * ```ts
 * import { createRouteLensHandler } from 'routelens/fetch';
 * const handler = createRouteLensHandler({ basePath: '/__routelens' });
 * export const GET = handler;
 * export const POST = handler;
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

  if (lens.isEventStream(url.pathname)) {
    return eventStream(lens);
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();

  const result = await lens.handle({
    method: request.method,
    path: url.pathname,
    search: url.search,
    body,
  });
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
      connection: 'keep-alive',
    },
  });
}
