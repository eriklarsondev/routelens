import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLens, type Lens, type LensRequest } from './core.js';
import type { LensResponse } from './responses.js';
import type { RouteLensOptions } from './types.js';

export type NextFunction = (error?: unknown) => void;

export interface RouteLensMiddleware {
  /** Express middleware: `app.use(routelens())`. */
  (request: IncomingMessage, response: ServerResponse, next: NextFunction): void;
  lens: Lens;
  close(): void;
}

/**
 * The dashboard as Express middleware. Mount it in your main server file,
 * inside the local-and-dev check, and open `/__routelens`. It shows the app it
 * is mounted on:
 *
 * ```js
 * if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local') {
 *   const { routelens } = await import('routelens');
 *   app.use(routelens());
 * }
 * ```
 */
export function routelens(options: RouteLensOptions = {}): RouteLensMiddleware {
  const lens = createLens(options);

  const middleware = ((request: IncomingMessage, response: ServerResponse, next: NextFunction): void => {
    if (typeof response?.writeHead !== 'function') {
      throw new TypeError('routelens(): this is Express middleware. Use app.use(routelens()).');
    }
    const url = request.url ?? '/';
    const questionMark = url.indexOf('?');
    const path = questionMark === -1 ? url : url.slice(0, questionMark);
    const search = questionMark === -1 ? '' : url.slice(questionMark + 1);

    if (lens.isEventStream(path)) {
      const refusal = lens.guard(describe(request, path));
      if (refusal) send(request, response, refusal);
      else streamEvents(lens, request, response);
      return;
    }

    if (!path.startsWith(lens.basePath)) {
      next();
      return;
    }

    readBody(request)
      .then(async (body) => {
        const result = await lens.handle({ ...describe(request, path), search, body });
        if (!result) {
          next();
          return;
        }
        send(request, response, result);
      })
      .catch(next);
  }) as RouteLensMiddleware;

  middleware.lens = lens;
  middleware.close = () => lens.close();
  return middleware;
}

/** What the guard needs to know about a Node request: who it is for, and where it came from. */
function describe(request: IncomingMessage, path: string): LensRequest {
  return {
    method: request.method ?? 'GET',
    path,
    headers: request.headers,
    remoteAddress: request.socket?.remoteAddress,
    localAddress: request.socket?.localAddress,
  };
}

function send(request: IncomingMessage, response: ServerResponse, result: LensResponse): void {
  dropCors(response);
  response.writeHead(result.status, result.headers);
  response.end(request.method === 'HEAD' ? undefined : result.body);
}

/**
 * A `cors()` earlier in the app's chain may already have allowed every origin
 * on this response. That was meant for the app's API, never for the dashboard,
 * so it is taken back.
 */
function dropCors(response: ServerResponse): void {
  for (const name of response.getHeaderNames()) {
    if (name.startsWith('access-control-')) response.removeHeader(name);
  }
}

function streamEvents(lens: Lens, request: IncomingMessage, response: ServerResponse): void {
  dropCors(response);
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'keep-alive',
  });
  response.write('event: ready\ndata: {}\n\n');

  const unsubscribe = lens.subscribe(() => {
    response.write('event: change\ndata: {}\n\n');
  });
  const heartbeat = setInterval(() => response.write(': ping\n\n'), 30_000);
  heartbeat.unref?.();

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.on('close', cleanup);
  response.on('close', cleanup);
}

function readBody(request: IncomingMessage): Promise<string> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return Promise.resolve('');

  // Body parsers that ran earlier in the chain leave the stream consumed.
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    return Promise.resolve(typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
  }

  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('routelens: request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
