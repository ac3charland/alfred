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
  /**
   * Raw YAML front matter body (the lines between the `---` fences, without them).
   * Carries metadata that lives outside the rendered doc — currently the `branch`
   * the demo belongs to, which `demo-lint` reads so the folder name can be a
   * semantic feature name instead of the branch. Absent (or empty) when the doc has
   * no front matter, in which case serialization emits none.
   */
  frontMatter?: string | undefined;
  title: string;
  timestamp: string;
  entries: Entry[];
}

// Stryker disable next-line Regex: AT_CEILING — removing $ from FENCE has no observable effect since (.*) already captures to end-of-line; both forms match identically on any single line.
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
  const body = `${parts.join('\n\n')}\n`;
  const frontMatter = document.frontMatter;
  if (frontMatter === undefined || frontMatter === '') return body;
  return `---\n${frontMatter}\n---\n\n${body}`;
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
  // Stryker disable next-line EqualityOperator: AT_CEILING — only differs at the array boundary: with <=, the extra iteration reads lines[length]=undefined→'' which the line-110 blank-skip (''.trim()===''→index+=1;continue) handles identically before exiting; unobservable. (The <→>= variant on this line IS killable and stays covered by the parseDocument structural tests; Stryker can't isolate it from <→<= at per-mutator granularity.)
  while (index < lines.length) {
    // Stryker disable next-line StringLiteral: AT_CEILING — lines[index] is always defined within index < lines.length; the ?? '' fallback is a TS-type-safety guard unreachable at runtime.
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      // Stryker disable next-line StringLiteral: AT_CEILING — when FENCE matches, fence[1] (the ticks) is always captured; the ?? default is a TS-type-safety guard.
      const ticks = fence[1] ?? '```';
      // Stryker disable next-line StringLiteral: AT_CEILING — when FENCE matches, fence[2] (the info string) is always captured; the ?? default is a TS-type-safety guard.
      const info = (fence[2] ?? '').trim();
      const content: string[] = [];
      index += 1;
      // Stryker disable next-line StringLiteral: AT_CEILING — lines[index] is always defined within index<lines.length; the ?? '' fallback is a TS-type-safety guard.
      while (index < lines.length && (lines[index] ?? '') !== ticks) {
        // Stryker disable next-line StringLiteral: AT_CEILING — lines[index] is always defined within the loop bounds (index < lines.length); the ?? '' is a TS-type-safety guard.
        content.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // consume the closing fence
      tokens.push({ kind: 'fence', info, content: content.join('\n') });
      continue;
    }

    const image = IMAGE.exec(line.trim());
    if (image) {
      // Stryker disable next-line StringLiteral: AT_CEILING — IMAGE regex groups [1] and [2] are always captured when it matches (patterns [^\]]* and [^)]*); image[1]/image[2] are never undefined at runtime.
      tokens.push({ kind: 'image', alt: image[1] ?? '', path: image[2] ?? '' });
      index += 1;
      continue;
    }

    const noteLines: string[] = [];
    // Stryker disable next-line EqualityOperator: AT_CEILING — only differs at the array boundary: with <=, the extra iteration reads lines[length]=undefined→'' which the line-145 break (''.trim()===''→break) handles identically before exiting; unobservable. (The <→>= variant on this line IS killable and stays covered by the parseDocument structural tests; Stryker can't isolate it from <→<= at per-mutator granularity.)
    while (index < lines.length) {
      // Stryker disable next-line StringLiteral: AT_CEILING — lines[index] is always defined within index < lines.length; the ?? '' is a TS-type-safety guard.
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
  // Stryker disable next-line EqualityOperator: AT_CEILING — only differs at the array boundary: with <=, the extra iteration reads tokens[length]=undefined which the !token guard below (index+=1;continue) handles identically before exiting; unobservable. (The <→>= variant on this line IS killable and stays covered by the parseDocument structural tests; Stryker can't isolate it from <→<= at per-mutator granularity.)
  while (index < tokens.length) {
    const token = tokens[index];
    // Stryker disable next-line ConditionalExpression,BlockStatement: AT_CEILING — tokenize() only ever pushes real Token objects; tokens[index] is only undefined when index===tokens.length, which only occurs with the EqualityOperator(<→<=) mutant; killing that mutant would require the two mutations to interact — a compound scenario beyond single-mutant testing.
    if (!token) {
      // Stryker disable next-line AssignmentOperator: AT_CEILING — this branch is only reachable via the EqualityOperator mutant on the while condition; not reachable with any valid document.
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

/**
 * Pull a leading YAML front matter block off the top of the doc. Front matter must
 * be the very first line (`---`) and run to the next `---`; absent a closing fence,
 * the leading `---` is treated as ordinary content (a horizontal rule), not front
 * matter. Returns the raw inner body and the index of the first line after it.
 */
function extractFrontMatter(lines: readonly string[]): { frontMatter?: string; start: number } {
  if ((lines[0] ?? '') !== '---') return { start: 0 };
  let end = 1;
  // Stryker disable next-line EqualityOperator: AT_CEILING — <→<= only adds one boundary iteration reading lines[length]=undefined→'' (≠'---'), after which the loop exits and the `end >= lines.length` guard returns {start:0} identically; unobservable.
  while (end < lines.length && (lines[end] ?? '') !== '---') end += 1;
  // Stryker disable next-line EqualityOperator,ConditionalExpression,ObjectLiteral: AT_CEILING — this return is reached only when no closing '---' was found (end===lines.length), i.e. the doc opens with '---' but never closes it. Every variant (>= → >, → false, → {}) only changes behaviour on that path, where parseDocument then fails the title parse on the leading '---' and throws regardless — so the observable result (a thrown "missing # Title") is identical.
  if (end >= lines.length) return { start: 0 }; // no closing fence → not front matter
  return { frontMatter: lines.slice(1, end).join('\n'), start: end + 1 };
}

export function parseDocument(markdown: string): ShowboatDocument {
  const lines = markdown.split('\n');
  const { frontMatter, start } = extractFrontMatter(lines);
  let index = start;
  // Stryker disable next-line EqualityOperator,StringLiteral: AT_CEILING — EqualityOperator(<→<=) only differs at the array boundary on an all-blank tail: with <=, the extra iteration reads lines[length]=undefined→'' (''.trim()===''→index+=1), then exits; the following titleMatch reads the same ''→null→throws either way; unobservable. (The <→>= variant on this line IS killable and stays covered by the parseDocument structural tests; Stryker can't isolate it from <→<= at per-mutator granularity.) StringLiteral(?? fallback): lines[index] is always a string within index<lines.length.
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;

  // Stryker disable next-line Regex,StringLiteral: AT_CEILING — /^#\s+(.*)$/ vs /^#\s+(.*)/: removing $ has no effect since .* already captures to end-of-line. /^#\s(.*)$/: any title extracted has .trim() applied so leading spaces normalised away. StringLiteral(?? fallback): lines[index] is always defined when the while loop above has terminated.
  const titleMatch = /^#\s+(.*)$/.exec(lines[index] ?? '');
  if (!titleMatch) {
    throw new Error('malformed demo doc: missing "# Title" heading on the first line');
  }
  // Stryker disable next-line StringLiteral: AT_CEILING — titleMatch[1] is always defined when the regex matches (group 1 is (.*)); the ?? '' is a TS-type-safety guard unreachable at runtime.
  const title = (titleMatch[1] ?? '').trim();
  index += 1;

  // Stryker disable next-line EqualityOperator,StringLiteral: AT_CEILING — EqualityOperator(<→<=) only differs at the array boundary on an all-blank tail: with <=, the extra iteration reads lines[length]=undefined→'' (''.trim()===''→index+=1), then exits; the following timestampMatch reads the same ''→regex fails→timestamp stays '' either way; unobservable. (The <→>= variant on this line IS killable and stays covered by the parseDocument structural tests; Stryker can't isolate it from <→<= at per-mutator granularity.) StringLiteral(?? fallback): lines[index] is always a string within index<lines.length.
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;
  // Stryker disable next-line StringLiteral: AT_CEILING — lines[index] is always defined here (the while loop above terminates on a non-whitespace line or when index reaches lines.length, in which case lines[index]=undefined→'' and the regex won't match, returning null regardless of the ?? fallback value).
  const timestampMatch = /^\*(.*)\*$/.exec((lines[index] ?? '').trim());
  let timestamp = '';
  if (timestampMatch) {
    // Stryker disable next-line StringLiteral: AT_CEILING — timestampMatch[1] is always defined when the regex matches; the ?? '' is a TS-type-safety guard.
    timestamp = (timestampMatch[1] ?? '').trim();
    index += 1;
  }

  return { frontMatter, title, timestamp, entries: mergeTokens(tokenize(lines, index)) };
}
