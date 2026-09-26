/**
 * Folder naming for the source folders Alfred commits into the wiki repo's `inbox/`.
 *
 * Mirrors the wiki repo's `scripts/lib/paths.ts` (`slugify`, `folderName`, `uniqueFolderName`,
 * `todayUtc`) exactly, so a folder Alfred names is one the wiki's own `npm run add` would have
 * named. Kept as a copy rather than an import because the two repos share no code — if the
 * wiki's rule changes, this file changes with it.
 */

/** A slug is cut to this many characters, at a word boundary. */
const MAX_SLUG_LENGTH = 60;

/** The slug of a title that has no alphanumeric characters at all. */
const EMPTY_SLUG = 'untitled';

/**
 * The slug of a title: NFKD-folded to strip accents, lower-cased, every run of non-alphanumerics
 * turned into one `-`, leading and trailing dashes dropped, cut at a word boundary to at most 60
 * characters. A title with nothing left after folding becomes `untitled`.
 */
export function slugify(title: string): string {
  const folded = title
    .normalize('NFKD')
    // Combining marks (the accents NFKD split off their base letters) are dropped; anything
    // else that is not an ASCII letter or digit becomes a separator below.
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase();
  let slug = folded.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
  if (slug.length > MAX_SLUG_LENGTH) {
    // Cut at the last dash at or before the limit, so the slug never ends mid-word. A title whose
    // first word alone is longer than the limit has no boundary to cut at and is cut hard.
    const boundary = slug.lastIndexOf('-', MAX_SLUG_LENGTH);
    slug = boundary > 0 ? slug.slice(0, boundary) : slug.slice(0, MAX_SLUG_LENGTH);
  }
  return slug === '' ? EMPTY_SLUG : slug;
}

/** `<YYYY-MM-DD>-<slug>`: the captured date of the send, then the title's slug. */
export function folderName(captured: string, title: string): string {
  return `${captured}-${slugify(title)}`;
}

/**
 * The first of `name`, `name-2`, `name-3`, … not in `taken`. The wiki's rule for a folder name
 * already in `inbox/` — and, for Alfred, for two envelopes in one commit that slug alike.
 */
export function uniqueFolderName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name}-${String(suffix)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The UTC calendar date of `now` as `YYYY-MM-DD` — the wiki's `captured` stamp. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
