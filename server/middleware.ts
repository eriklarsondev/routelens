import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLens, type Lens } from './core.js';
import type { RouteLensOptions } from './types.js';

export type NextFunction = (error?: unknown) => void;

export interface RouteLensMiddleware {
  (request: IncomingMessage, response: ServerResponse, next: NextFunction): void;
  lens: Lens;
  close(): void;
}

/**
 * Connect / Express / Vite style middleware. Mount it on your dev server and
 * open `/__routelens`:
 *
 * ```js
 * if (process.env.NODE_ENV !== 'production') {
 *   const { routelens } = await import('routelens');
 *   app.use(routelens());
 * }
 * ```
 */
export function routelens(options: RouteLensOptions = {}): RouteLensMiddleware {
  const lens = createLens(options);

  const middleware = ((request, response, next) => {
    const url = request.url ?? '/';
    const questionMark = url.indexOf('?');
    const path = questionMark === -1 ? url : url.slice(0, questionMark);
    const search = questionMark === -1 ? '' : url.slice(questionMark + 1);

    if (lens.isEventStream(path)) {
      streamEvents(lens, request, response);
      return;
    }

    if (!path.startsWith(lens.basePath)) {
      next();
      return;
    }

    readBody(request)
      .then(async (body) => {
        const result = await lens.handle({ method: request.method ?? 'GET', path, search, body });
        if (!result) {
          next();
          return;
        }
        response.writeHead(result.status, result.headers);
        response.end(request.method === 'HEAD' ? undefined : result.body);
      })
      .catch(next);
  }) as RouteLensMiddleware;

  middleware.lens = lens;
  middleware.close = () => lens.close();
  return middleware;
}

function streamEvents(lens: Lens, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
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
