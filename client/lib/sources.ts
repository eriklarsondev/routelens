import { groupEntries } from '@/lib/groups';
import type { DashboardData, Entry } from '@/types';

/**
 * Shorten a source reference from the front. CSS ellipsis trims the tail, which
 * is exactly the half worth reading — the filename and the line number.
 */
export function shortSource(file: string, line: number, maxLength = 30): string {
  const full = `${file}:${line}`;
  if (full.length <= maxLength) return full;

  const segments = file.split('/');
  let tail = segments.pop() ?? file;
  while (segments.length > 0) {
    const next = `${segments[segments.length - 1]}/${tail}`;
    if (`…/${next}:${line}`.length > maxLength) break;
    tail = next;
    segments.pop();
  }
  return `…/${tail}:${line}`;
}

/**
 * Short source labels for one card, kept distinct from each other. Trimming
 * from the front is what makes a path readable, but in a monorepo it is also
 * what hides the difference: `billing/…/routes/index.ts` and
 * `accounts/…/routes/index.ts` both end the same way. Colliding labels regrow
 * towards the front until they disagree.
 */
export function sourceLabels(entries: Entry[]): Map<string, string> {
  const labels = new Map<string, string>();
  const byLabel = new Map<string, Entry[]>();

  for (const entry of entries) {
    const label = shortSource(entry.source.file, entry.source.line);
    labels.set(entry.id, label);
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(entry);
    else byLabel.set(label, [entry]);
  }

  for (const collisions of byLabel.values()) {
    // Rows from the very same line — a route listing several paths — are
    // already told apart by their paths; no amount of widening separates them.
    const distinct = new Set(collisions.map((entry) => entry.source.file)).size;
    if (distinct < 2) continue;

    const files = collisions.map((entry) => entry.source.file.split('/'));
    const depth = Math.max(...files.map((segments) => segments.length));

    // Widen every colliding label in step until the set is distinct, so they
    // stay visually comparable rather than ragged.
    for (let keep = 2; keep <= depth; keep++) {
      const widened = collisions.map((entry, index) => {
        const segments = files[index]!;
        const tail = segments.slice(Math.max(0, segments.length - keep)).join('/');
        const elided = segments.length > keep ? '…/' : '';
        return `${elided}${tail}:${entry.source.line}`;
      });
      if (new Set(widened).size === distinct || keep === depth) {
        collisions.forEach((entry, index) => labels.set(entry.id, widened[index]!));
        break;
      }
    }
  }

  return labels;
}

/**
 * Longest the source column may be, in characters: a label at `shortSource`'s
 * default length, with room to spare for the ones `sourceLabels` widens to tell
 * files apart. Past it, a label is shortened.
 */
export const MAX_SOURCE = 48;

/**
 * The source column is monospace, so a character count is an exact width. It
 * is sized from every endpoint, filtered or not and collapsed or not, so it is
 * the same on both tabs and lines up down the whole page. The Issues tab holds
 * a subset of the same cards, and per-card labels only ever narrow when a card
 * shows fewer rows, so they always fit.
 */
export function sourceColumnWidth(data: DashboardData | null): number {
  if (!data) return 0;

  let width = 0;
  for (const group of groupEntries(data.routes)) {
    const labels = sourceLabels(group.entries);
    for (const entry of group.entries) {
      width = Math.max(width, (labels.get(entry.id) ?? '').length);
    }
  }
  return Math.min(width, MAX_SOURCE);
}

/**
 * Fit a source label into `max` characters. `sourceLabels` widens colliding
 * labels until their front folder tells them apart, so a long label keeps that
 * folder and its file and drops the folders between. Failing that, it is
 * trimmed from the front. The row's tooltip still has the full path.
 */
export function fitSource(entry: Entry, label: string, max: number): string {
  if (label.length <= max) return label;

  const segments = label.replace(/^…\//, '').split('/');
  const file = segments.pop()!;
  if (segments.length > 1) {
    const kept = `…/${segments[0]}/…/${file}`;
    if (kept.length <= max) return kept;
  }

  // `shortSource` stops at the file name, which can be too long by itself;
  // then the name gives up letters from its front too.
  const short = shortSource(entry.source.file, entry.source.line, max);
  return short.length <= max ? short : `…${short.slice(-(max - 1))}`;
}
