/**
 * Frontmatter serialization for the files Alfred commits into the wiki repo's `inbox/`.
 *
 * The wiki repo's own `scripts/lib/schema.ts` and `scripts/lib/frontmatter.ts` are the source of
 * truth for the field set and key order; this module mirrors them rather than importing them,
 * since the two repos share no code. The output does not need to be byte-identical to the wiki's
 * serializer: filing compares `source.md` by body only, and a dated file only ever collides with
 * Alfred's own earlier output for the same source.
 *
 * Every string value is written as a JSON-quoted scalar. A JSON string is always a valid YAML
 * double-quoted scalar, so titles holding colons, quotes, `#`, or newlines never need a YAML
 * library to escape them. `null` is written bare.
 */

/** Who wrote the words in a file. Mirrors the wiki registry's three origins. */
export type WikiOrigin = 'third-party' | 'mine' | 'model-derived';

/** How much of the source a file holds — only on files carrying the author's own text. */
export type WikiFidelity = 'full-text' | 'pointer';

/** The wiki's core frontmatter, in the key order its serializer writes. */
export interface CoreFrontmatter {
  source_type: string;
  origin: WikiOrigin;
  title: string;
  author: string | null;
  source_url: string | null;
  /** The newsletter's send date as a UTC `YYYY-MM-DD`, or null when nothing dates the source. */
  published: string | null;
  /** The UTC `YYYY-MM-DD` this file was produced. */
  captured: string;
  /** The producer: `alfred-reader` or `alfred-inbox`. */
  via: string;
  external_id: string | null;
  /** Present only on the author-text file (`source.md`). */
  fidelity?: WikiFidelity;
}

/** The key order the wiki writes, so a re-serialized file never carries a spurious diff. */
const KEY_ORDER: readonly (keyof CoreFrontmatter)[] = [
  'source_type',
  'origin',
  'title',
  'author',
  'source_url',
  'published',
  'captured',
  'via',
  'external_id',
  'fidelity',
];

/**
 * `JSON.stringify` only escapes U+0000–U+001F, `"` and `\` — U+007F (DEL) and the C1 controls
 * U+0080–U+009F come through raw, valid JSON but not valid inside a YAML double-quoted scalar
 * (YAML's printable set excludes them). U+0085 (NEL) is the one C1 code point YAML does allow
 * bare, so it is left alone.
 */
const YAML_UNSAFE_CONTROL = /[\u007F\u0080-\u0084\u0086-\u009F]/g;

/** One frontmatter line: a bare `null`, or a JSON-quoted string, valid as YAML too. */
function scalar(value: string | null): string {
  if (value === null) return 'null';
  return JSON.stringify(value).replaceAll(
    YAML_UNSAFE_CONTROL,
    // The match is always exactly one code point (the class holds only single-code-unit chars),
    // so `codePointAt(0)` never actually misses — `?? 0` only satisfies the return type.
    (char) => String.raw`\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The `---`-fenced block, ending in `---\n`. `fidelity` is written only when set — a notes-only
 * or picks file carries no author text and so no fidelity key at all.
 */
export function serializeFrontmatter(fields: CoreFrontmatter): string {
  const lines = KEY_ORDER.flatMap((key) => {
    const value = fields[key];
    return value === undefined ? [] : [`${key}: ${scalar(value)}`];
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * A whole file: the frontmatter, a blank line, then the body. An empty body ends the file at the
 * closing `---\n` with no blank line — the wiki's own pointer shape, and what its filing step
 * reads as "no body". A non-empty body is written verbatim and always ends in exactly one `\n`.
 */
export function renderWikiFile(fields: CoreFrontmatter, body: string): string {
  const frontmatter = serializeFrontmatter(fields);
  if (body === '') return frontmatter;
  return `${frontmatter}\n${body.replace(/\n*$/, '')}\n`;
}
