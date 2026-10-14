import { canonicalizeParams, joinPath, toMethod } from '../paths.js';
import type { MiddlewareRef, ScannedFile, SourceRef } from '../types.js';
import { classifyMiddleware, describeArgument, handlerChecks } from './middleware.js';
import { lineOf, type RawRoute } from './shared.js';
import { closeOf, splitTopLevel, stringLiteral } from './syntax.js';

const VERBS = /^(Get|Post|Put|Patch|Delete|Head|Options|All)$/;

/** Decorators that describe a route rather than run in front of it. */
const DESCRIPTIVE =
  /^(Controller|Get|Post|Put|Patch|Delete|Head|Options|All|HttpCode|Header|Redirect|Render|Version|Sse|Injectable|Module|Api[A-Z]\w*|Body|Param|Query|Req|Res|Headers)$/;

interface Decorator {
  name: string;
  /** The text inside its parentheses, when it is called. */
  args: string | null;
  start: number;
  end: number;
}

export interface NestGlobals {
  prefix?: string;
  /** `app.useGlobalGuards(...)` and `APP_GUARD` providers: in front of every route. */
  guards: MiddlewareRef[];
}

/**
 * NestJS controllers: `@Controller('users')` sets the prefix, method decorators
 * add the rest. A file can declare several controllers, so each route belongs
 * to the class it is declared in. Guards, pipes, interceptors and custom
 * decorators (`@Roles('admin')`) on the class run in front of every method;
 * those on a method, in front of that method.
 */
export function detectNest(file: ScannedFile, masked: string, globals: NestGlobals = { guards: [] }): RawRoute[] {
  if (!/@Controller\s*\(/.test(masked)) return [];

  const routes: RawRoute[] = [];
  let prefix = '';
  let classMiddleware: MiddlewareRef[] = [];

  for (const block of decoratorBlocks(masked)) {
    const after = masked.slice(block[block.length - 1]!.end, block[block.length - 1]!.end + 120);
    const isClass = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(after);

    if (isClass) {
      const controller = block.find((decorator) => decorator.name === 'Controller');
      if (!controller) continue;
      prefix = controllerPrefix(controller.args);
      classMiddleware = block.flatMap((decorator) => middlewareOf(decorator, 'router', file.rel, masked));
      continue;
    }

    const verbs = block.filter((decorator) => VERBS.test(decorator.name));
    if (verbs.length === 0) continue;
    const own = block.flatMap((decorator) => middlewareOf(decorator, 'route', file.rel, masked));
    const checks = handlerChecks(methodBody(masked, block[block.length - 1]!.end), {
      file: file.rel,
      line: lineOf(masked, block[block.length - 1]!.end),
    });

    for (const verb of verbs) {
      const path = stringLiteral(verb.args?.split(',')[0] ?? '') ?? '';
      routes.push({
        kind: 'api',
        method: toMethod(verb.name),
        path: joinPath('/', globals.prefix, canonicalizeParams(prefix), canonicalizeParams(path)),
        framework: 'nest',
        line: lineOf(masked, verb.start),
        middleware: [...globals.guards, ...classMiddleware, ...own, ...checks],
      });
    }
  }

  return routes;
}

/** Decorators in runs: the ones stacked on one class or method form one block. */
function decoratorBlocks(masked: string): Decorator[][] {
  const blocks: Decorator[][] = [];
  let current: Decorator[] = [];
  let lastEnd = -1;

  const pattern = /(?<![\w$.])@([A-Za-z_$][\w$]*)/g;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const start = match.index;
    let end = start + match[0].length;
    let args: string | null = null;
    const open = /^\s*\(/.exec(masked.slice(end, end + 40));
    if (open) {
      const paren = end + open[0].length - 1;
      const close = closeOf(masked, paren);
      if (close > 0) {
        args = masked.slice(paren + 1, close - 1);
        end = close;
      }
    }
    pattern.lastIndex = end;

    if (lastEnd >= 0 && masked.slice(lastEnd, start).trim() !== '') {
      blocks.push(current);
      current = [];
    }
    current.push({ name: match[1]!, args, start, end });
    lastEnd = end;
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function controllerPrefix(args: string | null): string {
  if (!args) return '';
  const literal = stringLiteral(args.trim());
  if (literal !== null) return literal;
  return /path\s*:\s*['"`]([^'"`]*)['"`]/.exec(args)?.[1] ?? '';
}

/**
 * What a decorator puts in front of a handler. `@UseGuards(A, B)` is two
 * guards, `@UsePipes` validation; a custom decorator such as `@Roles('admin')`
 * is kept by name, since that is usually the permission it declares.
 */
function middlewareOf(decorator: Decorator, scope: MiddlewareRef['scope'], rel: string, masked: string): MiddlewareRef[] {
  if (DESCRIPTIVE.test(decorator.name)) return [];
  const source: SourceRef = { file: rel, line: lineOf(masked, decorator.start) };

  const use = /^Use(Guards|Interceptors|Pipes|Filters)$/.exec(decorator.name);
  if (use) {
    return splitTopLevel(decorator.args ?? '', ',').flatMap((arg) =>
      describeArgument(arg.trim().replace(/^new\s+/, '')).map(({ name }) => {
        const classified = classifyMiddleware(name);
        const kind =
          use[1] === 'Pipes' ? 'validation' : use[1] === 'Guards' && classified === 'other' ? 'auth' : classified;
        return { name, kind, scope, source } satisfies MiddlewareRef;
      }),
    );
  }

  const name = decorator.args === null ? decorator.name : describeArgument(`${decorator.name}(${decorator.args})`)[0]!.name;
  return [{ name, kind: classifyMiddleware(name), scope, source }];
}

/** The body of the method whose signature follows `from`. */
function methodBody(masked: string, from: number): string {
  const open = masked.indexOf('{', from);
  if (open < 0) return '';
  const close = closeOf(masked, open);
  return close < 0 ? '' : masked.slice(open, close);
}

/**
 * Settings in a Nest app's bootstrap and modules that apply to every
 * controller: `app.setGlobalPrefix('api')`, `app.useGlobalGuards(new
 * JwtGuard())`, and `{ provide: APP_GUARD, useClass: RolesGuard }`.
 */
export function findNestGlobals(file: ScannedFile, masked: string, into: NestGlobals): void {
  const prefix = /setGlobalPrefix\s*\(\s*['"`]([^'"`]+)['"`]/.exec(masked)?.[1];
  if (prefix && !into.prefix) into.prefix = prefix;

  for (const match of masked.matchAll(/\.\s*useGlobalGuards\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = closeOf(masked, open);
    if (close < 0) continue;
    const source = { file: file.rel, line: lineOf(masked, match.index ?? 0) };
    for (const arg of splitTopLevel(masked.slice(open + 1, close - 1), ',')) {
      for (const { name } of describeArgument(arg.trim().replace(/^new\s+/, ''))) {
        const kind = classifyMiddleware(name);
        into.guards.push({ name, kind: kind === 'other' ? 'auth' : kind, scope: 'app', source });
      }
    }
  }

  for (const match of masked.matchAll(/provide\s*:\s*APP_GUARD\s*,\s*use(?:Class|Existing)\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    const name = match[1]!;
    const kind = classifyMiddleware(name);
    into.guards.push({
      name,
      kind: kind === 'other' ? 'auth' : kind,
      scope: 'app',
      source: { file: file.rel, line: lineOf(masked, match.index ?? 0) },
    });
  }
}
