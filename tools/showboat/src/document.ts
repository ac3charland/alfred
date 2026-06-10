/**
 * The document model for showboat-compatible demo docs.
 *
 * A demo doc is an H1 title, an ISO-8601 timestamp, and an ordered list of
 * entries. The markdown serialization matches upstream showboat closely enough
 * that a doc produced here reads identically and could later be re-driven by the
 * real Go binary: notes are plain paragraphs, an exec is a fenced code block
 * immediately followed by a ```output block, and an image is a markdown image.
 */

export interface NoteEntry {
  readonly kind: 'note';
  readonly text: string;
}

export interface ExecEntry {
  readonly kind: 'exec';
  readonly lang: string;
  readonly code: string;
  readonly output: string;
}

export interface ImageEntry {
  readonly kind: 'image';
  readonly alt: string;
  readonly path: string;
}

export type Entry = NoteEntry | ExecEntry | ImageEntry;

export interface ShowboatDocument {
  title: string;
  timestamp: string;
  entries: Entry[];
}

const FENCE = /^(`{3,})(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)]*)\)$/;

/** Trim a trailing run of newlines so fenced blocks stay tight. */
function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/, '');
}

/**
 * Pick a backtick fence longer than the longest backtick run starting any line
 * of `content`, so captured output containing its own ``` fences round-trips
 * (the CommonMark rule for nested fences).
 */
function fenceTicks(content: string): string {
  let longest = 0;
  for (const line of content.split('\n')) {
    const match = /^(`+)/.exec(line);
    const run = match?.[1];
    if (run) longest = Math.max(longest, run.length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function makeFence(info: string, content: string): string {
  const ticks = fenceTicks(content);
  const body = trimTrailingNewlines(content);
  return body.length > 0 ? `${ticks}${info}\n${body}\n${ticks}` : `${ticks}${info}\n${ticks}`;
}

function entryToMarkdown(entry: Entry): string {
  switch (entry.kind) {
    case 'note': {
      return entry.text;
    }
    case 'image': {
      return `![${entry.alt}](${entry.path})`;
    }
    case 'exec': {
      return `${makeFence(entry.lang, entry.code)}\n\n${makeFence('output', entry.output)}`;
    }
  }
}

export function serializeDocument(document: ShowboatDocument): string {
  const header = `# ${document.title}\n\n*${document.timestamp}*`;
  const parts = [header, ...document.entries.map((entry) => entryToMarkdown(entry))];
  return `${parts.join('\n\n')}\n`;
}

interface FenceToken {
  kind: 'fence';
  info: string;
  content: string;
}
interface ImageToken {
  kind: 'image';
  alt: string;
  path: string;
}
interface NoteToken {
  kind: 'note';
  text: string;
}
type Token = FenceToken | ImageToken | NoteToken;

function tokenize(lines: readonly string[], start: number): Token[] {
  const tokens: Token[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const ticks = fence[1] ?? '```';
      const info = (fence[2] ?? '').trim();
      const content: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? '') !== ticks) {
        content.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // consume the closing fence
      tokens.push({ kind: 'fence', info, content: content.join('\n') });
      continue;
    }

    const image = IMAGE.exec(line.trim());
    if (image) {
      tokens.push({ kind: 'image', alt: image[1] ?? '', path: image[2] ?? '' });
      index += 1;
      continue;
    }

    const noteLines: string[] = [];
    while (index < lines.length) {
      const noteLine = lines[index] ?? '';
      if (noteLine.trim() === '') break;
      if (FENCE.test(noteLine)) break;
      if (IMAGE.test(noteLine.trim())) break;
      noteLines.push(noteLine);
      index += 1;
    }
    tokens.push({ kind: 'note', text: noteLines.join('\n') });
  }
  return tokens;
}

function mergeTokens(tokens: readonly Token[]): Entry[] {
  const entries: Entry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      index += 1;
      continue;
    }
    if (token.kind === 'image') {
      entries.push({ kind: 'image', alt: token.alt, path: token.path });
      index += 1;
      continue;
    }
    if (token.kind === 'note') {
      entries.push({ kind: 'note', text: token.text });
      index += 1;
      continue;
    }
    // A fence token: a code block, optionally followed by its output block.
    if (token.info === 'output') {
      throw new Error('malformed demo doc: found an output block with no preceding code block');
    }
    const next = tokens[index + 1];
    if (next?.kind === 'fence' && next.info === 'output') {
      entries.push({ kind: 'exec', lang: token.info, code: token.content, output: next.content });
      index += 2;
    } else {
      entries.push({ kind: 'exec', lang: token.info, code: token.content, output: '' });
      index += 1;
    }
  }
  return entries;
}

export function parseDocument(markdown: string): ShowboatDocument {
  const lines = markdown.split('\n');
  let index = 0;
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;

  const titleMatch = /^#\s+(.*)$/.exec(lines[index] ?? '');
  if (!titleMatch) {
    throw new Error('malformed demo doc: missing "# Title" heading on the first line');
  }
  const title = (titleMatch[1] ?? '').trim();
  index += 1;

  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;
  const timestampMatch = /^\*(.*)\*$/.exec((lines[index] ?? '').trim());
  let timestamp = '';
  if (timestampMatch) {
    timestamp = (timestampMatch[1] ?? '').trim();
    index += 1;
  }

  return { title, timestamp, entries: mergeTokens(tokenize(lines, index)) };
}
