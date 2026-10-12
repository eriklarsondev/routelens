import { createServer, type Server } from 'node:http';
import type { Lens } from './core.js';
import { routelens } from './middleware.js';
import type { RouteLensOptions } from './types.js';

export interface ServeOptions extends RouteLensOptions {
  /** Port for the standalone dashboard. Defaults to 4477, then the next free port. */
  port?: number;
  host?: string;
}

export interface ServeResult {
  url: string;
  port: number;
  server: Server;
  lens: Lens;
  close(): Promise<void>;
}

/**
 * Run the dashboard on its own port, for when you would rather not touch your
 * app's server. Requests you fire from the dashboard are proxied to `target`
 * so they land on the real dev server.
 */
export async function serve(options: ServeOptions = {}): Promise<ServeResult> {
  const host = options.host ?? '127.0.0.1';
  const basePort = options.port ?? 4477;
  const middleware = routelens(options);

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]!;

    // Standalone mode has nothing else to serve, so send the root to the dashboard.
    if (path === '/' || path === '') {
      response.writeHead(302, { location: middleware.lens.basePath });
      response.end();
      return;
    }

    middleware(request, response, () => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end(`Not found. The dashboard is at ${middleware.lens.basePath}\n`);
    });
  });

  const port = await listen(server, host, basePort);

  return {
    url: `http://${host}:${port}${middleware.lens.basePath}`,
    port,
    server,
    lens: middleware.lens,
    close: () =>
      new Promise((resolveClose) => {
        middleware.close();
        server.close(() => resolveClose());
      }),
  };
}

/** Bind to `port`, walking forward a few ports if it is taken. */
function listen(server: Server, host: string, port: number, attempt = 0): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE' && attempt < 20) {
        listen(server, host, port + 1, attempt + 1).then(resolvePort, reject);
        return;
      }
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      resolvePort(typeof address === 'object' && address ? address.port : port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
