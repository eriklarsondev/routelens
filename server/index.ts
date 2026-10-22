export { scan } from './scan.js';
export { createLens, isDevelopment, DEFAULT_BASE_PATH } from './core.js';
export type { Lens, LensRequest, LensResponse } from './core.js';
export { routelens } from './middleware.js';
export type { RouteLensMiddleware } from './middleware.js';
export { createRouteLensHandler } from './fetch-handler.js';
export type { FetchHandler } from './fetch-handler.js';
export { serve } from './http-server.js';
export type { ServeOptions, ServeResult } from './http-server.js';
export { renderDashboard } from './dashboard.js';
export type {
  ClientApp,
  ClientCall,
  ClientLibrary,
  ClientLink,
  ClientPage,
  ClientRouter,
  Framework,
  Method,
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
