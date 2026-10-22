import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLens, type Lens, type LensRequest, type LensResponse } from './core.js';
import { respondTo } from './fetch-handler.js';
import type { RouteLensOptions } from './types.js';

export type NextFunction = (error?: unknown) => void;

/** Koa's context, as far as routelens needs it. */
interface KoaContext {
  req: IncomingMessage;
  res: ServerResponse;
  respond?: boolean;
  request?: { body?: unknown };
}

/** Hono's context, as far as routelens needs it. */
interface HonoContext {
  req: { raw: Request };
}

/** A Fastify instance, as far as routelens needs it. */
interface FastifyInstance {
  addHook(name: string, hook: (...args: any[]) => unknown): unknown;
}

export interface RouteLensMiddleware {
  /**
   * Express, Connect, NestJS and Vite call it as `(request, response, next)`;
   * Koa and Hono as `(context, next)`; Fastify registers it as a plugin,
   * `(instance, options, done)`. One loose signature rather than one overload
   * each, because TypeScript infers a framework's generics from the last
   * overload only, and every framework but one would get the wrong ones.
   */
  (first: unknown, second?: unknown, third?: unknown): any;
  lens: Lens;
  close(): void;
}

/**
 * The dashboard as middleware, one initializer for every Node framework. Mount
 * it in your main server file, inside the local-and-dev check, and open
 * `/__routelens` (`npx routelens mount` prints this for your project):
 *
 * ```js
 * if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local') {
 *   const { routelens } = await import('routelens');
 *   app.use(routelens());         // Express, Connect, NestJS, Koa, Hono
 *   // app.register(routelens()); // Fastify
 * }
 * ```
 *
 * Each framework calls middleware with arguments of its own shape, which is how
 * this tells them apart.
 */
export function routelens(options: RouteLensOptions = {}): RouteLensMiddleware {
  const lens = createLens(options);
  const owns = (path: string) => path.startsWith(lens.basePath) || lens.isEventStream(path);

  const connect = (request: IncomingMessage, response: ServerResponse, next: NextFunction): void => {
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
  };

  // Koa writes the response itself once the middleware chain settles, unless
  // told not to; the chain settles when routelens has finished answering.
  const koa = (ctx: KoaContext, next: () => Promise<unknown>): Promise<unknown> => {
    if (!owns(pathOf(ctx.req.url))) return next();
    const parsed = ctx.request?.body;
    if (parsed !== undefined) (ctx.req as IncomingMessage & { body?: unknown }).body = parsed;
    ctx.respond = false;
    return new Promise((resolve, reject) => {
      ctx.res.once('finish', resolve).once('close', resolve);
      connect(ctx.req, ctx.res, (error) => {
        if (error) {
          reject(error);
          return;
        }
        ctx.respond = true;
        resolve(next());
      });
    });
  };

  // A Response returned from Hono middleware is the answer; `next()` is the app.
  const hono = async (c: HonoContext, next: () => Promise<unknown>): Promise<unknown> => {
    if (!owns(new URL(c.req.raw.url).pathname)) return next();
    return (await respondTo(lens, c.req.raw)) ?? next();
  };

  // Fastify only routes what it has a route for, so routelens answers in a
  // hook, before routing, rather than as a route of its own.
  const fastify = (instance: FastifyInstance, done: (error?: Error) => void): void => {
    type FastifyRequest = { raw: IncomingMessage };
    type FastifyReply = { raw: ServerResponse; hijack(): void };
    instance.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, hookDone: NextFunction) => {
      if (!owns(pathOf(request.raw.url))) {
        hookDone();
        return;
      }
      // Answered here, so the hook chain is never resumed: that is how a
      // Fastify hook responds early.
      reply.hijack();
      connect(request.raw, reply.raw, () => {
        reply.raw.writeHead(404, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'Not a routelens path' }));
      });
    });
    instance.addHook('onClose', (_instance: unknown, closed: () => void) => {
      lens.close();
      closed();
    });
    done();
  };

  const middleware = function (first: any, second: any, third: any): unknown {
    if (typeof first?.addHook === 'function' && typeof third === 'function') return fastify(first, third);
    if (typeof first?.on === 'function' && typeof second?.writeHead === 'function') return connect(first, second, third);
    if (typeof Request === 'function' && first?.req?.raw instanceof Request) return hono(first, second);
    if (typeof first?.req?.on === 'function' && typeof first?.res?.writeHead === 'function') return koa(first, second);
    throw new TypeError(
      'routelens(): called the way none of Express, Koa, Hono or Fastify call middleware. ' +
        'Use app.use(routelens()), or app.register(routelens()) in Fastify.',
    );
  } as RouteLensMiddleware;

  // Fastify scopes a plugin's hooks to the plugin unless it opts out, and a
  // dashboard that only covered its own (nonexistent) routes would never answer.
  Object.assign(middleware, {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'routelens',
  });
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

function pathOf(url: string | undefined): string {
  const value = url ?? '/';
  const questionMark = value.indexOf('?');
  return questionMark === -1 ? value : value.slice(0, questionMark);
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
