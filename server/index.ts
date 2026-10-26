export { scan } from './scan.js';
export { DEFAULT_BASE_PATH } from './core.js';
export { isDevelopment } from './env.js';
export { routelens } from './middleware.js';
export type { RouteLensMiddleware } from './middleware.js';
export type {
  Method,
  MiddlewareKind,
  MiddlewareRef,
  RouteLensOptions,
  ScanOptions,
  ScanResult,
  ScanStats,
  ServerRoute,
  SourceRef,
} from './types.js';

// Default export so `const routelens = require('routelens')` style usage and
// `import routelens from 'routelens'` both give you the middleware.
export { routelens as default } from './middleware.js';
