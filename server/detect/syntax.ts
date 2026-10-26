/**
 * Just enough JavaScript syntax to read a route registration: matching brackets,
 * string literals and call arguments. Every helper works on comment-masked text
 * and steps over strings and template literals, so a `)` inside one never ends
 * anything.
 */

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Index just past the bracket closing the one at `open`, or -1 when it never closes. */
export function closeOf(text: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      i = endOfQuoted(text, i);
    } else if (char === '`') {
      i = endOfTemplate(text, i);
    } else if (CLOSERS[char]) {
      stack.push(CLOSERS[char]!);
    } else if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Index of the quote closing the one at `start`. A quoted string cannot span
 * lines, so a stray apostrophe stops at the end of its line instead of
 * swallowing the rest of the file.
 */
export function endOfQuoted(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') i++;
    else if (char === quote || char === '\n') return i;
  }
  return text.length;
}

/** Index of the backtick closing the template literal that opens at `start`. */
export function endOfTemplate(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      i++;
    } else if (char === '`') {
      return i;
    } else if (char === '$' && text[i + 1] === '{') {
      const end = closeOf(text, i + 1);
      if (end < 0) return text.length;
      i = end - 1;
    }
  }
  return text.length;
}

/**
 * The value of an expression that is nothing but a string literal. A template
 * literal comes back with its `${…}` parts intact for the caller to interpret.
 */
export function stringLiteral(expression: string): string | null {
  const text = expression.trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'") && endOfQuoted(text, 0) === text.length - 1) {
    return text.slice(1, -1);
  }
  if (quote === '`' && endOfTemplate(text, 0) === text.length - 1) return text.slice(1, -1);
  return null;
}

/**
 * Split `text` on a separator that sits outside every bracket and string, e.g.
 * the commas between a call's arguments.
 */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") i = endOfQuoted(text, i);
    else if (char === '`') i = endOfTemplate(text, i);
    else if (CLOSERS[char]) depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(from, i));
      from = i + separator.length;
      i += separator.length - 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/**
 * The arguments of the call whose `(` is at `open`, or null when its closing
 * `)` cannot be found — a regex literal with a lone bracket in a handler, say.
 */
export function callArguments(text: string, open: number): Array<{ text: string; start: number }> | null {
  const close = closeOf(text, open);
  if (close < 0) return null;

  const items: Array<{ text: string; start: number }> = [];
  let start = open + 1;
  for (const part of splitTopLevel(text.slice(open + 1, close - 1), ',')) {
    const lead = part.length - part.trimStart().length;
    if (part.trim()) items.push({ text: part.trim(), start: start + lead });
    start += part.length + 1;
  }
  return items;
}
