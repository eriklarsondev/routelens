/**
 * Just enough JavaScript syntax to read route tables: matching brackets, string
 * literals, object properties and JSX tags. Every helper works on comment-masked
 * text and steps over strings and template literals, so a `}` or `>` inside one
 * never ends anything.
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
 * lines, so a stray apostrophe in JSX text (`<p>Don't</p>`) stops at the end of
 * its line instead of swallowing the rest of the file.
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
 * the commas between array elements or the `||` of a fallback.
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

/** The elements of the array literal whose `[` is at `open`. */
export function arrayElements(text: string, open: number): Array<{ text: string; start: number }> {
  return listItems(text, open) ?? [];
}

/**
 * The arguments of the call whose `(` is at `open`, or null when its closing
 * `)` cannot be found — a regex literal with a lone bracket in a handler, say.
 */
export function callArguments(text: string, open: number): Array<{ text: string; start: number }> | null {
  return listItems(text, open);
}

function listItems(text: string, open: number): Array<{ text: string; start: number }> | null {
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

/**
 * The `key: value` properties of the object literal whose `{` is at `open`.
 * Shorthand and spread entries carry no value worth reading and are skipped.
 */
export function objectProperties(
  text: string,
  open: number,
): Map<string, { value: string; start: number }> {
  const properties = new Map<string, { value: string; start: number }>();
  const close = closeOf(text, open);
  if (close < 0) return properties;

  let start = open + 1;
  for (const part of splitTopLevel(text.slice(open + 1, close - 1), ',')) {
    const entry = /^\s*(?:(['"])([^'"\n]+)\1|([A-Za-z_$][\w$]*))\s*:/.exec(part);
    if (entry) {
      const key = entry[2] ?? entry[3]!;
      const rest = part.slice(entry[0].length);
      const lead = rest.length - rest.trimStart().length;
      properties.set(key, { value: rest.trim(), start: start + entry[0].length + lead });
    }
    start += part.length + 1;
  }
  return properties;
}

export interface JsxTag {
  name: string;
  start: number;
  /** Index just past the tag's closing `>`. */
  end: number;
  selfClosing: boolean;
  /** Attribute values as written: `"x"`, `{expr}`, or `true` for a bare flag. */
  attrs: Map<string, string | true>;
}

/** Read the opening tag that starts at `start` (the `<`), attributes and all. */
export function readJsxTag(text: string, start: number): JsxTag | null {
  // Vue templates name components in kebab-case: `<router-link>`.
  const name = /^<([A-Za-z][\w.-]*)/.exec(text.slice(start, start + 120))?.[1];
  if (!name) return null;

  const attrs = new Map<string, string | true>();
  let i = start + 1 + name.length;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };

  while (i < text.length) {
    skipSpace();
    const char = text[i];
    if (char === '/' && text[i + 1] === '>') {
      return { name, start, end: i + 2, selfClosing: true, attrs };
    }
    if (char === '>') return { name, start, end: i + 1, selfClosing: false, attrs };
    if (char === '{') {
      // `{...props}`
      const close = closeOf(text, i);
      if (close < 0) return null;
      i = close;
      continue;
    }

    // Vue binds an attribute to an expression with `:to` or `v-bind:to`.
    const attr = /^:?[A-Za-z_$@][\w$:.-]*/.exec(text.slice(i, i + 80))?.[0];
    if (!attr) return null;
    i += attr.length;
    skipSpace();
    if (text[i] !== '=') {
      attrs.set(attr, true);
      continue;
    }
    i++;
    skipSpace();

    const quote = text[i];
    if (quote === '"' || quote === "'") {
      const close = endOfQuoted(text, i);
      attrs.set(attr, text.slice(i, close + 1));
      i = close + 1;
    } else if (quote === '{') {
      const close = closeOf(text, i);
      if (close < 0) return null;
      attrs.set(attr, text.slice(i, close));
      i = close;
    } else {
      return null;
    }
  }
  return null;
}

/** The expression inside an attribute value: `"x"` stays a literal, `{expr}` loses its braces. */
export function attrExpression(value: string | true | undefined): string | null {
  if (value === undefined || value === true) return null;
  return value.startsWith('{') ? value.slice(1, -1).trim() : value;
}

/**
 * Opening JSX tags in `text`. A `<` straight after an identifier or a closing
 * bracket is a type argument or a comparison (`useState<string>`, `a<b`), not
 * an element.
 */
export function jsxTagStarts(text: string): Array<{ name: string; index: number }> {
  const tags: Array<{ name: string; index: number }> = [];
  for (const match of text.matchAll(/(?<![\w$.\])])<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    tags.push({ name: match[1]!, index: match.index ?? 0 });
  }
  return tags;
}
