import { canonicalizeParams, joinPath, toMethod } from '../paths.js';
import type { Method, ScannedFile } from '../types.js';
import { lineOf, type RawRoute } from './shared.js';

const VERBS = 'get|post|put|patch|delete|head|options';

/**
 * FastAPI and Flask. Both attach routes with decorators, and both support a
 * per-module prefix (`APIRouter(prefix=...)`, `Blueprint(url_prefix=...)`) that
 * we fold into the path. Cross-module `include_router(prefix=...)` is resolved
 * only when the router is imported relatively.
 */
export function detectPython(file: ScannedFile, masked: string): RawRoute[] {
  if (file.ext !== '.py') return [];

  const routes: RawRoute[] = [];
  const modulePrefix = joinPath(
    '/',
    /APIRouter\s*\([^)]*prefix\s*=\s*['"]([^'"]+)['"]/.exec(masked)?.[1],
    /Blueprint\s*\([^)]*url_prefix\s*=\s*['"]([^'"]+)['"]/.exec(masked)?.[1],
  );

  // FastAPI: @app.get("/items/{id}")
  const fastapiRe = new RegExp(
    `@\\s*([A-Za-z_][\\w.]*)\\s*\\.\\s*(${VERBS})\\s*\\(\\s*(['"])([^'"]*)\\3`,
    'g',
  );
  for (const match of masked.matchAll(fastapiRe)) {
    const rawPath = match[4]!;
    if (!rawPath.startsWith('/')) continue;
    routes.push({
      kind: 'api',
      method: toMethod(match[2]),
      path: joinPath(modulePrefix, canonicalizeParams(rawPath)),
      framework: 'fastapi',
      line: lineOf(masked, match.index ?? 0),
    });
  }

  // Flask: @app.route("/items", methods=["GET", "POST"])
  const flaskRe = /@\s*([A-Za-z_][\w.]*)\s*\.\s*(?:route|add_url_rule)\s*\(\s*(['"])([^'"]*)\2([^)]*)/g;
  for (const match of masked.matchAll(flaskRe)) {
    const rawPath = match[3]!;
    if (!rawPath.startsWith('/')) continue;
    const methodsArg = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(match[4] ?? '')?.[1];
    const methods: Method[] = methodsArg
      ? (methodsArg.match(/[A-Za-z]+/g) ?? ['GET']).map((raw) => toMethod(raw))
      : ['GET'];
    const line = lineOf(masked, match.index ?? 0);
    for (const method of methods) {
      routes.push({
        kind: 'api',
        method,
        path: joinPath(modulePrefix, canonicalizeParams(rawPath)),
        framework: 'flask',
        line,
      });
    }
  }

  // Django: path("items/<int:pk>/", views.detail)
  if (/\burlpatterns\b/.test(masked)) {
    for (const match of masked.matchAll(/\b(?:path|re_path)\s*\(\s*(['"])([^'"]*)\1/g)) {
      const rawPath = match[2]!;
      if (rawPath.includes('^') || rawPath.includes('$')) continue;
      routes.push({
        kind: 'api',
        method: 'ALL',
        path: joinPath(modulePrefix, canonicalizeParams('/' + rawPath)),
        framework: 'unknown',
        line: lineOf(masked, match.index ?? 0),
      });
    }
  }

  return routes;
}
