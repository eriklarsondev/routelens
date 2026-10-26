/**
 * Blank out comments while preserving every byte offset and newline, so that
 * regex matches on the masked text still map to real line numbers in the file.
 * Commented-out routes are a common source of phantom endpoints.
 */
export function maskComments(text: string): string {
  const out = text.split('');
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];

    switch (state) {
      case 'code':
        if (char === '/' && next === '/') {
          state = 'line';
          out[i] = ' ';
          out[i + 1] = ' ';
          i++;
        } else if (char === '/' && next === '*') {
          state = 'block';
          out[i] = ' ';
          out[i + 1] = ' ';
          i++;
        } else if (char === "'") state = 'single';
        else if (char === '"') state = 'double';
        else if (char === '`') state = 'template';
        break;

      case 'line':
        if (char === '\n') state = 'code';
        else out[i] = ' ';
        break;

      case 'block':
        if (char === '*' && next === '/') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i++;
          state = 'code';
        } else if (char !== '\n') out[i] = ' ';
        break;

      case 'single':
      case 'double':
      case 'template':
        if (char === '\\') i++;
        else if (
          (state === 'single' && char === "'") ||
          (state === 'double' && char === '"') ||
          (state === 'template' && char === '`')
        ) {
          state = 'code';
        }
        break;

      default:
        break;
    }
  }

  return out.join('');
}
