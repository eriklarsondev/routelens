/**
 * Just enough highlighting for the request examples the dashboard writes
 * itself — a `fetch` call and a `curl` command. A general highlighter would be
 * most of the bundle for two snippets whose every token is known.
 */
export type TokenKind = 'keyword' | 'string' | 'function' | 'property' | 'variable' | 'flag' | 'punctuation' | 'plain';

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set(['const', 'let', 'await', 'async', 'return', 'new', 'true', 'false', 'null', 'undefined']);

export function highlight(code: string, language: 'js' | 'shell'): Token[] {
  return merge(language === 'js' ? javascript(code) : shell(code));
}

function javascript(code: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const push = (text: string, kind: TokenKind) => tokens.push({ text, kind });

  while (at < code.length) {
    const rest = code.slice(at);
    const quoted = /^(['"])(?:\\.|(?!\1)[^\\\n])*\1/.exec(rest);
    if (quoted) {
      push(quoted[0], 'string');
      at += quoted[0].length;
      continue;
    }
    if (rest[0] === '`') {
      at = template(code, at, push);
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const after = code.slice(at + word[0].length);
      const kind = KEYWORDS.has(word[0])
        ? 'keyword'
        : /^\s*\(/.test(after)
          ? 'function'
          : /^\s*:(?!:)/.test(after)
            ? 'property'
            : 'plain';
      push(word[0], kind);
      at += word[0].length;
      continue;
    }
    const space = /^\s+/.exec(rest);
    if (space) {
      push(space[0], 'plain');
      at += space[0].length;
      continue;
    }
    push(rest[0]!, /[{}()[\],.;:=]/.test(rest[0]!) ? 'punctuation' : 'plain');
    at += 1;
  }
  return tokens;
}

/** A template literal from its opening backtick: the text, and what `${…}` fills in. */
function template(code: string, start: number, push: (text: string, kind: TokenKind) => void): number {
  let at = start + 1;
  let text = '`';
  while (at < code.length && code[at] !== '`') {
    if (code.startsWith('${', at)) {
      push(text, 'string');
      text = '';
      const close = code.indexOf('}', at);
      const end = close < 0 ? code.length : close;
      push('${', 'punctuation');
      push(code.slice(at + 2, end), 'variable');
      if (close >= 0) push('}', 'punctuation');
      at = end + 1;
      continue;
    }
    text += code[at];
    at += 1;
  }
  push(at < code.length ? `${text}\`` : text, 'string');
  return at + 1;
}

function shell(code: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  // The first word of a command is the program; a line after a trailing `\`
  // carries on the same command.
  let commandStart = true;
  let continued = false;
  const push = (text: string, kind: TokenKind) => tokens.push({ text, kind });

  while (at < code.length) {
    const rest = code.slice(at);
    const space = /^[ \t]+/.exec(rest);
    if (space) {
      push(space[0], 'plain');
      at += space[0].length;
      continue;
    }
    if (rest[0] === '\n') {
      push('\n', 'plain');
      at += 1;
      commandStart = !continued;
      continued = false;
      continue;
    }
    if (rest.startsWith('\\\n') || rest === '\\') {
      push('\\', 'punctuation');
      at += 1;
      continued = true;
      continue;
    }
    if (rest[0] === "'") {
      const end = code.indexOf("'", at + 1);
      const close = end < 0 ? code.length : end + 1;
      push(code.slice(at, close), 'string');
      at = close;
    } else if (rest[0] === '"') {
      // Double quotes expand variables, so those stand out inside the string.
      const end = code.indexOf('"', at + 1);
      const close = end < 0 ? code.length : end + 1;
      for (const part of code.slice(at, close).split(/(\$[A-Za-z_]\w*)/)) {
        if (part) push(part, part.startsWith('$') ? 'variable' : 'string');
      }
      at = close;
    } else {
      const word = /^[^\s'"]+/.exec(rest)![0];
      push(
        word,
        commandStart ? 'function' : /^--?[A-Za-z]/.test(word) ? 'flag' : word.startsWith('$') ? 'variable' : 'plain',
      );
      at += word.length;
    }
    commandStart = false;
  }
  return tokens;
}

/** Neighbours of one kind become one span. */
function merge(tokens: Token[]): Token[] {
  const merged: Token[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.kind === token.kind) last.text += token.text;
    else merged.push({ ...token });
  }
  return merged;
}
