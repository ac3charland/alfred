/**
 * A body-search snippet, split into runs to render. Postgres's `ts_headline` wraps each matched
 * word in control characters (`\u0002` … `\u0003`) — never HTML — so the reading room can mark the
 * words by rendering `<mark>` elements around plain text runs, and nothing the server sends is
 * ever injected as markup.
 */

/** Opens a matched run. */
export const SNIPPET_START = '\u0002';
/** Closes a matched run. */
export const SNIPPET_STOP = '\u0003';

/** One run of a snippet: its text, and whether it is a matched word to mark. */
export interface SnippetPart {
  text: string;
  marked: boolean;
}

/**
 * `snippet` as plain and marked runs, in order. Tolerant of a malformed snippet: a stop with no
 * open run is dropped, a start never closed runs to the end, and empty runs are dropped with
 * their neighbours merged.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let marked = false;
  let text = '';

  const flush = () => {
    if (text === '') return;
    const last = parts.at(-1);
    if (last?.marked === marked) last.text += text;
    else parts.push({ text, marked });
    text = '';
  };

  for (const character of snippet) {
    if (character === SNIPPET_START || character === SNIPPET_STOP) {
      const opens = character === SNIPPET_START;
      if (opens !== marked) {
        flush();
        marked = opens;
      }
      continue;
    }
    text += character;
  }
  flush();
  return parts;
}
