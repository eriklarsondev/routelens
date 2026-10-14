import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, relative } from 'node:path';
import type { RouteLensOptions } from './types.js';
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORED_DIRS } from './walk.js';

export interface ProjectWatcher {
  close(): void;
}

/**
 * Files that change what a scan reports without being source: where an app is
 * served from (`.env`, docker-compose), how imports resolve (tsconfig), what a
 * package depends on, and a single-page app's index.html.
 */
const CONFIG_FILE = /^(\.env(\..+)?|(docker-)?compose(\..+)?\.ya?ml|package\.json|routelens\.config\.json|[tj]sconfig(\..+)?\.json|index\.html)$/;

/**
 * More directories than this and the fallback stops adding watches: Linux caps
 * inotify watches per user, and running out breaks every other tool watching
 * files on the machine. The Rescan button still works past it.
 */
const MAX_DIRECTORY_WATCHES = 4000;

/**
 * Call `onChange` shortly after any file a scan would read changes. Recursive
 * `fs.watch` is used where the platform has it; elsewhere — Linux before Node
 * 19.1 — every directory is watched on its own, and new ones as they appear.
 */
export function watchProject(
  root: string,
  options: RouteLensOptions,
  onChange: () => void,
  { recursive = true }: { recursive?: boolean } = {},
): ProjectWatcher | null {
  const ignored = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignore ?? [])]);
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  let timer: NodeJS.Timeout | null = null;

  const changed = (path: string) => {
    const segments = path.split(/[\\/]/);
    if (segments.some((segment) => ignored.has(segment))) return;
    const name = segments[segments.length - 1]!;
    const dot = name.lastIndexOf('.');
    const relevant = (dot >= 0 && extensions.has(name.slice(dot))) || CONFIG_FILE.test(name);
    if (!relevant) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 250);
    timer.unref?.();
  };

  if (recursive) {
    try {
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename) changed(filename.toString());
      });
      watcher.on('error', () => {});
      watcher.unref?.();
      return watcher;
    } catch {
      // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM: fall through to one watch per directory.
    }
  }
  return watchEachDirectory(root, ignored, changed);
}

function watchEachDirectory(
  root: string,
  ignored: Set<string>,
  changed: (path: string) => void,
): ProjectWatcher | null {
  const watchers = new Map<string, FSWatcher>();

  const add = (dir: string) => {
    if (watchers.has(dir) || watchers.size >= MAX_DIRECTORY_WATCHES) return;

    let watcher: FSWatcher;
    try {
      watcher = watch(dir, (_event, filename) => {
        if (!filename) return;
        const path = join(dir, filename.toString());
        changed(relative(root, path));
        // A directory created after start-up gets watched too.
        if (!ignored.has(filename.toString()) && isDirectory(path)) addTree(path);
      });
    } catch {
      return;
    }
    watcher.on('error', () => {
      watcher.close();
      watchers.delete(dir);
    });
    watcher.unref?.();
    watchers.set(dir, watcher);
  };

  const addTree = (dir: string) => {
    add(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith('.')) {
        addTree(join(dir, entry.name));
      }
    }
  };

  addTree(root);
  if (watchers.size === 0) return null;

  return {
    close() {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
