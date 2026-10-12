import { canonicalizeParams, joinPath, toMethod } from '../paths.js';
import type { ScannedFile } from '../types.js';
import { lineOf, type RawRoute } from './shared.js';

const VERB_DECORATORS = 'Get|Post|Put|Patch|Delete|Head|Options|All';

/**
 * NestJS controllers: `@Controller('users')` sets the prefix, method decorators
 * add the rest. A file can declare several controllers, so each route uses the
 * nearest `@Controller` above it.
 */
export function detectNest(file: ScannedFile, masked: string, globalPrefix?: string): RawRoute[] {
  if (!/@Controller\s*\(/.test(masked)) return [];

  const controllers: Array<{ index: number; prefix: string }> = [];
  for (const match of masked.matchAll(/@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path\s*:\s*['"`]([^'"`]*)['"`])?/g)) {
    controllers.push({ index: match.index ?? 0, prefix: match[1] ?? match[2] ?? '' });
  }
  if (controllers.length === 0) return [];

  const routes: RawRoute[] = [];
  const routeRe = new RegExp(`@(${VERB_DECORATORS})\\s*\\(\\s*(?:['"\`]([^'"\`]*)['"\`])?`, 'g');

  for (const match of masked.matchAll(routeRe)) {
    const index = match.index ?? 0;
    const controller = [...controllers].reverse().find((candidate) => candidate.index < index);
    const prefix = controller?.prefix ?? '';
    const path = joinPath('/', globalPrefix, canonicalizeParams(prefix), canonicalizeParams(match[2] ?? ''));

    routes.push({
      kind: 'api',
      method: toMethod(match[1]),
      path,
      framework: 'nest',
      line: lineOf(masked, index),
    });
  }

  return routes;
}

/** `app.setGlobalPrefix('api')` in main.ts applies to every Nest controller. */
export function findNestGlobalPrefix(masked: string): string | undefined {
  return /setGlobalPrefix\s*\(\s*['"`]([^'"`]+)['"`]/.exec(masked)?.[1];
}
