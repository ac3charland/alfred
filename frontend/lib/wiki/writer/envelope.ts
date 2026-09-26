import { type CoreFrontmatter, renderWikiFile } from './frontmatter';

/**
 * Envelopes: the pure description of one send into the wiki — the files a source folder holds,
 * before it is given a folder name. `commitEnvelopes` chooses the name at commit time, against
 * what `inbox/` already holds.
 *
 * Two producers build envelopes. A Reader send holds the post's text as `source.md` plus the
 * picked "Novel ideas" bullets as `picks-<date>.md`; a knowledge dispatch holds one
 * `notes-<date>.md` in the owner's own words. Both are registry rows the wiki repo already
 * carries (`reader-post` and `idea`), so no wiki-side change is ever needed for a send.
 */

export interface EnvelopeFile {
  /** The file name inside the folder, e.g. `source.md` or `picks-2026-10-03.md`. */
  name: string;
  /** The whole file, frontmatter included. */
  content: string;
}

export interface Envelope {
  /** The source's title — the folder's slug, and the commit message for a single send. */
  title: string;
  /** The UTC `YYYY-MM-DD` of the send: the folder's date prefix and every file's `captured`. */
  captured: string;
  /** At least one file. */
  files: EnvelopeFile[];
}

/** The reader post fields a send reads — the only reader of `text` outside the Worker. */
export interface ReaderPostForWiki {
  id: string;
  title: string;
  author: string | null;
  canonical_url: string | null;
  /** The newsletter's arrival, the nearest thing the row has to a publish date. */
  received_at: string;
  /** The post body, or null / empty once the retention sweep has taken it. */
  text: string | null;
}

/** The Inbox item fields a knowledge dispatch reads. */
export interface KnowledgeItemForWiki {
  id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
}

/** `via` for a Reader send. */
export const READER_VIA = 'alfred-reader';
/** `via` for a knowledge dispatch. */
export const INBOX_VIA = 'alfred-inbox';

/** A URL only when it parses; the wiki's `source_url` is either a real URL or null. */
function parseableUrl(raw: string | null): string | null {
  return raw !== null && URL.canParse(raw) ? raw : null;
}

/** The UTC calendar date of an ISO timestamp. */
function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * A producer-scoped identity for a Reader post, so its sends stay one source even when the post
 * has no canonical URL (an email-only newsletter). Follows the wiki's `alfred:item:<uuid>`.
 */
export function readerPostExternalId(postId: string): string {
  return `alfred:reader-post:${postId}`;
}

/** The identity the wiki already reserves for a dispatched Inbox item. */
export function knowledgeItemExternalId(itemId: string): string {
  return `alfred:item:${itemId}`;
}

/**
 * A Reader send: `source.md` holding the post text verbatim (or a pointer with an empty body once
 * the text is swept), plus `picks-<captured>.md` listing the chosen bullets one per line.
 *
 * When the text is gone AND there is no URL to fetch it from, `source.md` is omitted: a pointer
 * with nothing to point at cannot be completed, and the ingest session marks the picks
 * uncheckable instead. Every other case writes `source.md` on every send — filing drops a copy
 * whose body matches, or is empty, so a second send of the same post costs nothing.
 *
 * A bullet's internal newlines are folded to spaces, because a list item is one line.
 */
export function readerEnvelope(
  post: ReaderPostForWiki,
  ideas: readonly string[],
  captured: string,
): Envelope {
  const text = post.text ?? '';
  const sourceUrl = parseableUrl(post.canonical_url);
  const core = {
    source_type: 'reader-post',
    title: post.title,
    author: post.author,
    source_url: sourceUrl,
    published: utcDate(post.received_at),
    captured,
    via: READER_VIA,
    external_id: readerPostExternalId(post.id),
  } as const;

  const files: EnvelopeFile[] = [];
  if (text !== '' || sourceUrl !== null) {
    const source: CoreFrontmatter = {
      ...core,
      origin: 'third-party',
      fidelity: text === '' ? 'pointer' : 'full-text',
    };
    files.push({ name: 'source.md', content: renderWikiFile(source, text) });
  }

  const picks: CoreFrontmatter = { ...core, origin: 'model-derived' };
  const bullets = ideas.map((idea) => `- ${idea.replaceAll(/\s*\n\s*/g, ' ').trim()}`).join('\n');
  files.push({ name: `picks-${captured}.md`, content: renderWikiFile(picks, bullets) });

  return { title: post.title, captured, files };
}

/**
 * A knowledge dispatch: one `notes-<captured>.md` in the owner's own words — the title, then a
 * blank line and the notes when there are any. A notes-only folder carries no `source.md` and
 * so no fidelity anywhere; the wiki reads that as `notes-only`.
 */
export function knowledgeEnvelope(item: KnowledgeItemForWiki, captured: string): Envelope {
  const notes: CoreFrontmatter = {
    source_type: 'idea',
    origin: 'mine',
    title: item.title,
    author: null,
    source_url: parseableUrl(item.source_url),
    published: null,
    captured,
    via: INBOX_VIA,
    external_id: knowledgeItemExternalId(item.id),
  };
  const trimmed = (item.notes ?? '').trim();
  const body = trimmed === '' ? item.title : `${item.title}\n\n${trimmed}`;
  return {
    title: item.title,
    captured,
    files: [{ name: `notes-${captured}.md`, content: renderWikiFile(notes, body) }],
  };
}
