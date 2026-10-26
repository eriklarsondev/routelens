/**
 * Constructors that make a whole application, as opposed to a sub-router. The
 * constructor is often imported under a capitalised name, and the variable
 * often typed: `const app: Express = express()`.
 */
const APP_PATTERN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*(?:express|Express)\s*\(/g;

const ROUTER_PATTERNS = [
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*(?:express\.)?Router\s*\(/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*new\s+Router\b/g,
];

/** The applications a file builds. */
export function collectApps(masked: string): Set<string> {
  const apps = new Set<string>();
  for (const match of masked.matchAll(APP_PATTERN)) apps.add(match[1]!);
  return apps;
}

/** The applications and routers a file builds. */
export function collectLocalRouters(masked: string): Set<string> {
  const routers = collectApps(masked);
  for (const pattern of ROUTER_PATTERNS) {
    for (const match of masked.matchAll(pattern)) routers.add(match[1]!);
  }
  return routers;
}

/** Each name a file imports or requires, and the specifier it comes from. */
export function collectImports(masked: string): Map<string, string> {
  const imports = new Map<string, string>();

  for (const match of masked.matchAll(
    /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }
  for (const match of masked.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    imports.set(match[1]!, match[2]!);
  }
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }
  // `import { userRouter } from './users'` — named routers are common too.
  for (const match of masked.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of match[1]!.split(',')) {
      const name = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
      if (name) imports.set(name, match[2]!);
    }
  }

  return imports;
}
