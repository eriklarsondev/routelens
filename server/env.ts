import type { RouteLensOptions } from './types.js';

/**
 * Where the dashboard may run: local and dev. An unset NODE_ENV is someone
 * running `node server.js` on their own machine, which Express treats as
 * development too. Anything else — production, staging, test — is not.
 */
export function isDevelopment(): boolean {
  const env = process.env.NODE_ENV;
  const local = env === undefined || env === '' || env === 'development' || env === 'local';
  return local && process.env.VERCEL_ENV !== 'production';
}

export function assertDev(options: RouteLensOptions): void {
  if (isDevelopment() || options.allowInProduction) return;
  const env = process.env.VERCEL_ENV === 'production' ? 'VERCEL_ENV is "production"' : `NODE_ENV is "${process.env.NODE_ENV}"`;
  throw new Error(
    `routelens refused to start: ${env}. It maps every endpoint in your app, so it runs in ` +
      'development only (NODE_ENV development, local or unset) — mount it inside the local-and-dev check ' +
      'in your main server file. Pass { allowInProduction: true } if you have deliberately decided otherwise.',
  );
}
